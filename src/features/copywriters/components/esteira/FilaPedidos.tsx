import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Check, Inbox, Flame, X, ExternalLink, ChevronRight, Sparkles } from 'lucide-react';
import { CriativoDrawer } from '@/features/producao/components/CriativoDrawer';
import type { ProducaoNivel } from '@/features/producao/components/types';
import { formatNumber } from '@/lib/formatters';
import { aoClicarSemArrastar } from '@/lib/clique';
import { Pedido, rotuloDoAdHook, rotuloDeDias, URGENCIA_LABEL, urgenciaPeso } from './tipos';

const URGENCIA_COR: Record<string, string> = {
  alta:  'bg-red-500/15 text-red-400',
  media: 'bg-amber-500/15 text-amber-400',
  baixa: 'bg-secondary text-muted-foreground',
};

/**
 * A fila de pedidos de variação, como o Copy precisa ler.
 *
 * Ordenada por URGÊNCIA, com a verba desempatando dentro de cada faixa: alta
 * antes de média, e entre duas altas ganha a que tem mais dinheiro em cima.
 *
 * A versão anterior ordenava só por verba, com o argumento de que um "alta" num
 * AD que quase não gastou não vale um "média" no que sustenta a conta. O
 * argumento continua valendo, e é por isso que a verba não saiu da conta — ela
 * só deixou de mandar sozinha. Quem marca "alta" sabe de algo que o gasto dos
 * últimos 30 dias não conta: criativo saturado, promessa que não pode mais ir
 * ao ar, concorrente copiando.
 *
 * O fechamento é manual, por decisão. Então duas coisas seguram a fila de
 * apodrecer: cada pedido mostra há quantos dias está aberto, e quando já surgiu
 * uma variação daquele AD depois do pedido, a linha avisa. Avisa, não fecha.
 */
export function FilaPedidos({ onMudou }: { onMudou?: () => void }) {
  const { user, perfil } = useAuth();
  /* O mesmo calculo que a Esteira ja faz para o drawer dela: a permissao
     dentro do card e por cargo, e escrever "copy" aqui inventaria um nivel que
     o tipo nao conhece. */
  const nivel: ProducaoNivel = perfil?.is_admin ? 'socio'
    : perfil?.cargo?.pode_aprovar ? 'head' : 'membro';
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [verFechados, setVerFechados] = useState(false);
  const [fechando, setFechando]   = useState<Pedido | null>(null);
  /* O pedido inteiro, e o card do AD que motivou o pedido. Os dois abrem
     SOBRE a Esteira: sair da tela para conferir e ter que voltar é o que fazia
     a fila ser lida de olho. */
  const [vendoPedido, setVendoPedido] = useState<Pedido | null>(null);
  const [adAberto, setAdAberto]       = useState<string | null>(null);
  const [verTodos, setVerTodos]       = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase
      .from('vw_pedidos_variacao')
      .select('*')
      .order('inv_30d', { ascending: false, nullsFirst: false })
      .order('criado_em', { ascending: true });
    if (error) { setErro(error.message); setCarregando(false); return; }
    setPedidos((data ?? []) as unknown as Pedido[]);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /*
    A ordem da fila: URGÊNCIA primeiro, verba como desempate.

    Ela era só por verba, e o comentário deste arquivo defendia isso — "um
    pedido alta num AD que quase não recebeu verba não vale um média no que
    sustenta a conta". O argumento continua de pé, e é por isso que a verba não
    saiu: ela decide DENTRO de cada urgência. O que mudou foi quem manda: quem
    marcou "alta" sabe de algo que o gasto dos últimos 30 dias não conta —
    criativo saturado, promessa que não pode mais ir ao ar, concorrente copiando.

    A ordenação é aqui e não no `.order()` do Postgres porque 'alta', 'media' e
    'baixa' em ordem alfabética dariam alta, baixa, média — a urgência do meio
    no fim da fila.
  */
  const abertos = useMemo(() => pedidos
    .filter(p => p.status === 'aberto')
    .sort((a, b) => urgenciaPeso(b.urgencia) - urgenciaPeso(a.urgencia)
                 || (b.inv_30d ?? 0) - (a.inv_30d ?? 0)), [pedidos]);
  const fechados = useMemo(() => pedidos.filter(p => p.status !== 'aberto'), [pedidos]);

  /*
    Quanta verba está esperando variação.

    Um pedido sozinho não diz se a fila é urgente; a soma diz. É o argumento
    para o Copy pegar a fila hoje em vez de amanhã.
  */
  const verbaNaFila = useMemo(
    () => abertos.reduce((s, p) => s + (p.inv_30d ?? 0), 0), [abertos]);

  /*
    A fila mostra os primeiros e guarda o resto atrás de um clique.

    Ela é ordenada por urgência e verba, então o começo é sempre o que importa;
    despejar quarenta pedidos de uma vez transforma a Esteira num rolo em que o
    "alta" de R$ 3 mil e o "baixa" de R$ 12 têm o mesmo peso na tela.
  */
  const LIMITE = 6;
  const visiveis = verTodos ? abertos : abertos.slice(0, LIMITE);
  const ocultos  = abertos.length - visiveis.length;
  const verbaOculta = abertos.slice(visiveis.length).reduce((s, p) => s + (p.inv_30d ?? 0), 0);

  /*
    A coluna de resultado, que a segunda armadilha do CLAUDE.md exige: sem ela
    ninguém volta para a fila, e a fila vira ficção. Mediana e não média porque
    um pedido esquecido por seis meses distorce a média inteira.
  */
  const medianaDias = useMemo(() => {
    const ds = fechados
      .filter(p => p.status === 'atendido' && p.atendido_em)
      .map(p => Math.round(
        (new Date(p.atendido_em!).getTime() - new Date(p.criado_em).getTime()) / 86400000));
    if (ds.length === 0) return null;
    ds.sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)];
  }, [fechados]);

  if (carregando) {
    return <div className="h-20 animate-pulse rounded-lg border border-border bg-card" />;
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center text-sm text-destructive-foreground">
        Não foi possível carregar os pedidos: {erro}
        <button onClick={() => void carregar()} className="ml-2 underline underline-offset-2">tentar de novo</button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {/*
        O cabeçalho carrega o destaque do bloco inteiro.

        A fila é a única parte da Esteira que pede AÇÃO — o resto é diagnóstico
        e consulta. Ela tinha o mesmo cabeçalho de 12px cinza dos outros dois, e
        por isso "tudo parecia a mesma coisa": nada na tela dizia por onde
        começar.
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3.5 py-3">
        <Inbox className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold text-foreground">
          Pedidos de variação
        </span>
        {abertos.length > 0 && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {abertos.length === 1 ? '1 aberto' : `${abertos.length} abertos`}
          </span>
        )}
        {verbaNaFila > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {formatCurrency(verbaNaFila)} de verba esperando variação
          </span>
        )}
        {/* Com treze pedidos na tela, dizer a ordem evita procurar um critério
            que não está escrito em lugar nenhum. */}
        {abertos.length > 1 && (
          <span className="text-[11px] text-muted-foreground/60">
            da mais urgente para a menos
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground/70">
          {fechados.length > 0 && (
            <>
              <span>
                {fechados.filter(p => p.status === 'atendido').length} atendidos
                {medianaDias != null && ` · mediana de ${medianaDias} ${medianaDias === 1 ? 'dia' : 'dias'}`}
              </span>
              <button onClick={() => setVerFechados(v => !v)}
                      className="underline-offset-2 hover:underline">
                {verFechados ? 'esconder' : 'ver'}
              </button>
            </>
          )}
        </span>
      </div>

      {abertos.length === 0 && !verFechados ? (
        <p className="px-3.5 py-6 text-center text-xs text-muted-foreground/60">
          Nenhum pedido aberto. Quem avalia um criativo em Produção pode pedir uma variação a partir dele.
        </p>
      ) : (
        <div className="divide-y divide-border/40">
          {visiveis.map(p => (
            <LinhaPedido key={p.id} p={p}
                         onVerPedido={() => setVendoPedido(p)}
                         onAbrirAd={() => setAdAberto(p.producao_id)} />
          ))}

          {ocultos > 0 && (
            <button
              type="button"
              onClick={() => setVerTodos(true)}
              className="w-full px-3.5 py-2.5 text-center text-xs text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              ver os outros {ocultos} {ocultos === 1 ? 'pedido' : 'pedidos'}
              {verbaOculta > 0 && ` · ${formatCurrency(verbaOculta)} de verba`}
            </button>
          )}
          {verTodos && abertos.length > LIMITE && (
            <button
              type="button"
              onClick={() => setVerTodos(false)}
              className="w-full px-3.5 py-2.5 text-center text-xs text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              ver menos
            </button>
          )}

          {verFechados && fechados.map(p => (
            <LinhaPedido key={p.id} p={p}
                         onVerPedido={() => setVendoPedido(p)}
                         onAbrirAd={() => setAdAberto(p.producao_id)} />
          ))}
        </div>
      )}

      {fechando && (
        <ModalFechar
          pedido={fechando}
          perfilId={user?.id ?? null}
          onClose={() => setFechando(null)}
          onSalvo={() => { setFechando(null); void carregar(); onMudou?.(); }}
        />
      )}

      {vendoPedido && (
        <ModalPedido pedido={vendoPedido}
                     onClose={() => setVendoPedido(null)}
                     onAbrirAd={() => { setAdAberto(vendoPedido.producao_id); setVendoPedido(null); }}
                     onFechar={() => { setFechando(vendoPedido); setVendoPedido(null); }} />
      )}

      {/*
        O card do AD original, montado aqui.

        `funis` e `perfis` vazios pelo mesmo motivo que na Esteira e em
        Criativos Meta: fora da Produção não há de onde tirá-los, e o drawer só
        os usa no seletor de funil e nas menções. O Copy abre para LER o que foi
        feito, não para reatribuir.
      */}
      {adAberto && (
        <CriativoDrawer
          criativoId={adAberto}
          onClose={() => setAdAberto(null)}
          onUpdate={() => void carregar()}
          nivel={nivel}
          userId={user?.id ?? ''}
          funis={[]}
          perfis={[]}
        />
      )}
    </div>
  );
}

/**
 * A solicitação inteira, como ela foi escrita.
 *
 * A fila mostra o resumo; aqui está tudo que quem pediu digitou — o porquê, o
 * que melhorar, a urgência e o tipo sugerido — mais o contexto que o pedido
 * carrega sozinho: verba, ROAS e avaliação do AD.
 *
 * Existe porque o Copy precisa das duas leituras em momentos diferentes:
 * varrendo a fila ele escolhe QUAL pegar; sentado para escrever, ele precisa do
 * texto inteiro sem a fila em volta.
 */
function ModalPedido({ pedido, onClose, onAbrirAd, onFechar }: {
  pedido: Pedido; onClose: () => void; onAbrirAd: () => void; onFechar: () => void;
}) {
  const p = pedido;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            Variação pedida para {p.ad_num != null ? rotuloDoAdHook(p.ad_num, p.hook) : p.criativo}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">{p.projeto ?? '—'}</span>
            {p.funil && (
              <span className="rounded bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">{p.funil}</span>
            )}
            <span className={cn('rounded px-1.5 py-px text-[10px]', URGENCIA_COR[p.urgencia])}>
              {URGENCIA_LABEL[p.urgencia]}
            </span>
            {p.tipo_sugerido && (
              <span className="rounded bg-blue-500/15 px-1.5 py-px text-[10px] text-blue-400">
                sugerido: {p.tipo_sugerido}
              </span>
            )}
          </div>

          {/* O contexto do AD: é o que separa "varie este" de "varie aquele". */}
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
            <Numero rotulo="Verba 30d" valor={p.inv_30d != null ? formatCurrency(p.inv_30d) : '—'} />
            <Numero rotulo="ROAS 30d"  valor={p.roas_30d != null ? `${formatNumber(p.roas_30d)}x` : '—'} />
            <Numero rotulo="Avaliação" valor={p.avaliacao ?? '—'} />
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Por que vale a pena variar</p>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{p.por_que}</p>
          </div>

          {p.o_que_melhorar && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">O que melhorar</p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{p.o_que_melhorar}</p>
            </div>
          )}

          {p.status === 'aberto' && p.ja_tem_variacao && (
            <p className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-300/90">
              Já existe uma variação deste AD criada depois do pedido — talvez ele já esteja atendido.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground/70">
            {p.solicitado_por_nome ? `Pedido por ${p.solicitado_por_nome}` : 'Pedido'}
            {' · '}{p.status === 'aberto' ? `aberto ${rotuloDeDias(p.dias_aberto)}` : p.status}
            {p.ultimo_dia_com_gasto && ` · último dia com verba em ${new Date(p.ultimo_dia_com_gasto + 'T00:00:00').toLocaleDateString('pt-BR')}`}
          </p>
        </div>

        {/*
          As ações grandes vivem aqui, não na linha da fila.

          Na linha elas eram dois botões de 10px que se perdiam no meio dos
          números — pequenos demais para acertar e discretos demais para achar.
          E multiplicados por vinte pedidos seriam quarenta botões numa tela em
          que nenhum deles é a ação principal.
        */}
        <DialogFooter className="gap-2 sm:gap-2">
          {p.status === 'aberto' && (
            <Button variant="ghost" size="sm" className="mr-auto" onClick={onFechar}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Fechar pedido
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>Voltar</Button>
          <Button size="sm" onClick={onAbrirAd}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Abrir o AD original
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="bg-card px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{valor}</p>
    </div>
  );
}

/**
 * Um pedido na fila: duas linhas, e a linha inteira é o botão.
 *
 * Ela tinha três linhas de texto de 10px e dois botões minúsculos no rodapé —
 * tudo com o mesmo peso, nada dizendo onde clicar. Agora:
 *
 *   · o nome do AD e os números crescem, o resto encolhe — hierarquia de
 *     tamanho é o que faz uma lista ser varrida em vez de lida;
 *   · verba e ROAS ficam numa coluna à direita, alinhados entre as linhas,
 *     porque número em coluna se compara e número no meio da frase não;
 *   · clicar em qualquer lugar abre o pedido inteiro, e clicar no nome do AD
 *     abre o card de produção. Dois alvos grandes em vez de dois botões de
 *     10px.
 *
 * O clique passa por `aoClicarSemArrastar` para que selecionar e copiar o
 * texto do pedido continue possível — o mesmo defeito que Vendas, UTM e
 * Financeiro tinham.
 */
function LinhaPedido({ p, onVerPedido, onAbrirAd }: {
  p: Pedido;
  onVerPedido: () => void;
  onAbrirAd: () => void;
}) {
  const aberto = p.status === 'aberto';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={aoClicarSemArrastar(onVerPedido)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onVerPedido(); }
      }}
      title="Ver o pedido inteiro"
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors',
        'hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none',
        !aberto && 'opacity-60',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* O nome do AD é a porta do card de produção. */}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onAbrirAd(); }}
            title="Abrir o card do AD original"
            className="text-sm font-semibold tabular-nums text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
          >
            {p.ad_num != null ? rotuloDoAdHook(p.ad_num, p.hook) : p.criativo}
          </button>
          <span className="truncate text-xs text-muted-foreground">{p.projeto ?? '—'}</span>

          {p.funil && (
            <span className="rounded bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">{p.funil}</span>
          )}

          {/* A urgência manda na ordem; a verba, na coluna à direita, desempata
              dentro de cada faixa. */}
          <span className={cn('rounded px-1.5 py-px text-[10px]', URGENCIA_COR[p.urgencia])}>
            {p.urgencia === 'alta' && <Flame className="mr-0.5 inline h-2.5 w-2.5" />}
            {URGENCIA_LABEL[p.urgencia]}
          </span>

          {p.tipo_sugerido && (
            <span className="rounded bg-blue-500/15 px-1.5 py-px text-[10px] text-blue-400">
              {p.tipo_sugerido}
            </span>
          )}

          {/*
            O fechamento é manual, então este selo é o que impede a fila de
            virar ficção: já apareceu uma variação deste AD depois do pedido.
            Era uma tarja de largura inteira que roubava uma linha de cada
            pedido; vira selo aqui e frase inteira dentro do pedido.
          */}
          {aberto && p.ja_tem_variacao && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] text-emerald-400">
              <Sparkles className="mr-0.5 inline h-2.5 w-2.5" />já tem variação
            </span>
          )}

          {!aberto && (
            <span className="text-[10px] text-muted-foreground/60">
              {p.status === 'atendido'
                ? `atendido${p.card_que_atendeu ? ` por ${p.card_que_atendeu}` : ''}`
                : 'descartado'}
            </span>
          )}
        </div>

        <p className="mt-1 truncate text-xs leading-relaxed text-muted-foreground" title={p.por_que}>
          {p.por_que}
        </p>
      </div>

      {/*
        Os números que decidem, numa coluna de largura fixa.

        A fila usava a verba só para ORDENAR e não a mostrava — "o valor em si
        não vai para a tela" era a regra antiga, e ela escondia justamente o que
        explica por que aquele pedido está no topo. Variar um AD de R$ 3 mil com
        ROAS 1,8 é outra tarefa que variar um de R$ 80 que nunca girou.
      */}
      <div className="w-28 shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-foreground">
          {p.inv_30d != null && p.inv_30d > 0 ? formatCurrency(p.inv_30d) : '—'}
        </p>
        <p className="text-[11px] tabular-nums text-muted-foreground/70">
          {p.roas_30d != null ? `${formatNumber(p.roas_30d)}x` : 'sem ROAS'}
          {aberto && ` · ${rotuloDeDias(p.dias_aberto)}`}
        </p>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
    </div>
  );
}

interface Candidato { id: string; nome: string; fase: string; tipo_teste: string | null }

function ModalFechar({ pedido, perfilId, onClose, onSalvo }: {
  pedido: Pedido; perfilId: string | null; onClose: () => void; onSalvo: () => void;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [cardId, setCardId] = useState<string>('_');
  const [nota, setNota] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    /*
      Os candidatos a "quem atendeu": cards de variação do MESMO projeto e do
      mesmo número de AD, criados depois do pedido. Escolher da lista em vez de
      digitar evita o `ad_code` de texto livre que já nos custou o vínculo do
      CopyTrack.
    */
    if (pedido.ad_num == null) { setCandidatos([]); return; }
    void (async () => {
      const { data } = await supabase
        .from('producoes')
        .select('id,nome,fase,tipo_teste,projeto_id,criado_em')
        .eq('tipo', 'criativo')
        .eq('projeto_id', pedido.projeto_id ?? '')
        .gt('criado_em', pedido.criado_em)
        .order('criado_em', { ascending: false })
        .limit(200);
      const so = (data ?? []).filter(c =>
        ['Vertical', 'Horizontal', 'Formato', 'Corpo'].includes((c as Candidato).tipo_teste ?? ''));
      setCandidatos(so as unknown as Candidato[]);
    })();
  }, [pedido]);

  async function salvar(status: 'atendido' | 'descartado') {
    setSalvando(true);
    const { error } = await supabase.from('pedidos_variacao').update({
      status,
      atendido_por: perfilId,
      atendido_em: new Date().toISOString(),
      atendido_por_producao_id: cardId === '_' ? null : cardId,
      nota_fechamento: nota.trim() || null,
    }).eq('id', pedido.id);
    setSalvando(false);
    if (error) { toast({ title: 'Não foi possível fechar o pedido', description: error.message, variant: 'destructive' }); return; }
    toast({ title: status === 'atendido' ? 'Pedido marcado como atendido' : 'Pedido descartado' });
    onSalvo();
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Fechar o pedido de {pedido.ad_num != null ? rotuloDoAdHook(pedido.ad_num, pedido.hook) : pedido.criativo}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Qual card atendeu</Label>
            <Select value={cardId} onValueChange={setCardId}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Não vincular a um card</SelectItem>
                {candidatos.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} {c.tipo_teste ? `· ${c.tipo_teste}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {candidatos.length === 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                Nenhuma variação deste projeto criada depois do pedido.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Nota (opcional)</Label>
            <Textarea className="mt-1 resize-none text-xs" rows={2}
                      value={nota} onChange={e => setNota(e.target.value)}
                      placeholder="Por que está sendo fechado" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" disabled={salvando}
                  onClick={() => void salvar('descartado')}>
            <X className="mr-1 h-3 w-3" /> Descartar
          </Button>
          <Button size="sm" disabled={salvando} onClick={() => void salvar('atendido')}>
            <Check className="mr-1 h-3 w-3" /> Marcar atendido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
