import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { hoje, emDias, deYmd } from '@/lib/datas';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, Inbox, Send, X, Clock } from 'lucide-react';
import { FilaParaTestar } from './FilaParaTestar';
import { EsteiraPorDia } from './EsteiraPorDia';
import { CardDaFila, DIAS_PARA_ESQUECIDO, rotuloDeDias } from './tipos';
import { useFases, rotuloDaFase } from '../../useFases';

/**
 * O painel do Gestor de Tráfego.
 *
 * Substitui, para este setor, o "Meu Painel" genérico — que mostrava as fases
 * do setor filtradas por `gestor_id = eu`. Isso não funcionava: só 1 dos 69
 * cards em `esteira_teste` tem `gestor_id` preenchido, então o painel dele
 * estava praticamente vazio, e a fila de aprovados nem aparecia porque
 * `aprovado` estava sem setor dono.
 *
 * Duas perguntas, duas seções:
 *   1. o que está pronto para testar — árvore projeto → funil → tipo, sem data
 *   2. o que está na esteira de teste — por dia, para ler a demanda da semana
 */
export function PainelGestorView({ userId }: { userId: string }) {
  const { fases } = useFases();
  const [cards, setCards] = useState<CardDaFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [data, setData] = useState<string>(hoje());
  const [enviando, setEnviando] = useState(false);
  const [calendarioAberto, setCalendarioAberto] = useState(false);

  /*
    Recarregar NÃO apaga a tela.

    Antes, `carregar` ligava `carregando` e o componente inteiro virava uma
    linha de "Carregando a fila…". Ao fechar o drawer isso zerava a altura da
    página e o navegador jogava o scroll para o topo — depois de abrir um card
    lá embaixo, voltava-se para o começo da árvore.

    O `carregando` agora só vale na PRIMEIRA carga, quando não há nada para
    preservar.
  */
  const carregar = useCallback(async () => {
    setErro(null);
    const { data: linhas, error } = await supabase
      .from('vw_gestor_fila')
      .select('*')
      .order('projeto', { ascending: true })
      .order('ad_num', { ascending: false });
    if (error) { setErro(error.message); setCarregando(false); return; }
    setCards((linhas ?? []) as unknown as CardDaFila[]);
    setSelecionados(new Set());
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  /*
    Abrir o card sem sair da tela.

    A `ProducaoPage` já monta o `CriativoDrawer` quando existe `?criativo=<id>`
    na URL — é assim que a notificação abre um card. Reusar isso em vez de
    montar um segundo drawer aqui evita duas telas de detalhe do mesmo card,
    que divergiriam; e de quebra o endereço fica compartilhável.
  */
  const [params, setParams] = useSearchParams();
  const abrirCard = useCallback((id: string) => {
    const p = new URLSearchParams(params);
    p.set('criativo', id);
    setParams(p);
  }, [params, setParams]);

  /*
    Quando o drawer fecha, a fila recarrega: lá dentro dá para mudar a fase, e
    sem isto o card continuaria na árvore como se nada tivesse acontecido.
  */
  const cardAberto = params.get('criativo');
  const tinhaAberto = useRef<string | null>(null);
  useEffect(() => {
    if (tinhaAberto.current && !cardAberto) void carregar();
    tinhaAberto.current = cardAberto;
  }, [cardAberto, carregar]);

  /*
    Projeto inativo não aparece de cara.

    Ele é metade do volume e nada dele é trabalho: dos 80 cards em esteira de
    teste, 44 são do Jabones Artesanales 360 — parado desde outubro de 2025 — e
    5 da Cosmética Natural. Misturados com os ativos, faziam a tela dizer "80
    cards na esteira" quando o que existe de verdade é um terço disso.

    (Aqueles 80 eram registros do tempo do Notion, onde `esteira_teste`
    significava o que `postado` significa hoje; já foram migrados. O número
    acima é o que a tela mostrava antes disso.)

    A aba existe para eles não sumirem: continuam a um clique, com a contagem
    visível, porque some da tela não é o mesmo que deixar de existir.
  */
  const [verInativos, setVerInativos] = useState(false);

  const doEscopo = useCallback(
    (c: CardDaFila) => c.projeto_ativo !== verInativos, [verInativos]);

  const fila    = useMemo(() => cards.filter(c => c.fase === 'aprovado' && doEscopo(c)), [cards, doEscopo]);
  const emTeste = useMemo(() => cards.filter(c => c.fase === 'esteira_teste' && doEscopo(c)), [cards, doEscopo]);

  const inativos = useMemo(() => cards.filter(c => !c.projeto_ativo).length, [cards]);

  const esquecidos = useMemo(
    () => fila.filter(c => (c.dias_na_fase ?? 0) >= DIAS_PARA_ESQUECIDO),
    [fila]);

  const alternar = useCallback((id: string) => {
    setSelecionados(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const alternarVarios = useCallback((ids: string[], marcar: boolean) => {
    setSelecionados(s => {
      const n = new Set(s);
      for (const i of ids) { if (marcar) n.add(i); else n.delete(i); }
      return n;
    });
  }, []);

  const adsSelecionados = useMemo(() => {
    const s = new Set<string>();
    for (const c of fila) {
      if (selecionados.has(c.id)) s.add(`${c.ad_num ?? 'x'}|${c.tipo_teste ?? ''}`);
    }
    return s.size;
  }, [fila, selecionados]);

  async function enviar() {
    if (selecionados.size === 0) return;
    setEnviando(true);
    const { data: n, error } = await supabase.rpc('fn_enviar_para_esteira', {
      p_ids: Array.from(selecionados),
      p_data: data,
      p_usuario: userId,
    });
    setEnviando(false);
    if (error) {
      toast({ title: 'Não foi possível enviar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: `${n} ${n === 1 ? 'card enviado' : 'cards enviados'} para a esteira`,
      description: `Teste marcado para ${deYmd(data).toLocaleDateString('pt-BR')}.`,
    });
    void carregar();
  }

  if (carregando) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Carregando a fila…</p>;
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center text-sm">
        Não foi possível carregar: {erro}
        <button onClick={() => void carregar()} className="ml-2 underline underline-offset-2">
          tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-20">
      {/* A aba dos inativos: eles saem da frente sem sair de existência. */}
      {inativos > 0 && (
        <div className="flex w-fit overflow-hidden rounded-md border border-border">
          {([[false, 'Projetos ativos'], [true, `Inativos (${inativos})`]] as [boolean, string][])
            .map(([v, rot]) => (
              <button key={rot} onClick={() => setVerInativos(v)}
                      className={cn('px-3 py-1.5 text-xs transition-colors',
                        verInativos === v ? 'bg-primary text-primary-foreground'
                                          : 'bg-secondary text-muted-foreground hover:text-foreground')}>
                {rot}
              </button>
            ))}
        </div>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <Inbox className="h-4 w-4 shrink-0 translate-y-0.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Prontos para testar</h2>
          <span className="text-[11px] text-muted-foreground">
            {fila.length} cards aprovados · agrupados por projeto, funil e tipo
          </span>
        </div>

        {/*
          Os esquecidos ganham linha própria. Há 33 cards aprovados há cerca de
          um ANO nesta fila — se aparecerem misturados com os de ontem, a fila
          volta a ser o que era: uma lista onde as coisas somem.
        */}
        {esquecidos.length > 0 && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              <span className="font-medium">{esquecidos.length} cards</span> estão aprovados há mais de{' '}
              {DIAS_PARA_ESQUECIDO} dias — o mais antigo{' '}
              {rotuloDeDias(Math.max(...esquecidos.map(c => c.dias_na_fase ?? 0)))}. Eles aparecem na
              árvore com o relógio ao lado; vale decidir se ainda vão para teste ou se saem da fila.
            </p>
          </div>
        )}

        <FilaParaTestar cards={fila} selecionados={selecionados}
                        onToggle={alternar} onToggleVarios={alternarVarios}
                        onAbrirCard={abrirCard} />
      </section>

      <section>
        {/*
          O nome sai de `producao_fases`, e não escrito aqui.

          Eu tinha posto "Em teste", e a fase se chama "Esteira de Teste" — dois
          nomes para a mesma coisa fizeram ela perguntar se a seção mostrava
          outra coisa. Lendo o rótulo da tabela, renomear a fase renomeia a
          seção junto, e a dúvida não volta.
        */}
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <CalendarDays className="h-4 w-4 shrink-0 translate-y-0.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            {rotuloDaFase(fases, 'esteira_teste')}, por dia
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {emTeste.length} {emTeste.length === 1 ? 'card' : 'cards'}
          </span>
        </div>
        <EsteiraPorDia cards={emTeste} onAbrirCard={abrirCard} />
      </section>

      {/*
        A barra só existe quando há seleção, e fica fixa no rodapé: a árvore é
        longa, e um botão no topo obrigaria a rolar de volta depois de marcar o
        que está lá embaixo.
      */}
      {selecionados.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-xl md:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <button onClick={() => setSelecionados(new Set())}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    aria-label="Limpar seleção">
              <X className="h-3.5 w-3.5" />
            </button>

            <span className="text-xs text-foreground">
              <span className="font-medium">{adsSelecionados} {adsSelecionados === 1 ? 'AD' : 'ADs'}</span>
              <span className="text-muted-foreground"> · {selecionados.size} cards</span>
            </span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>testar em</span>
                <Popover open={calendarioAberto} onOpenChange={setCalendarioAberto}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-normal">
                      <CalendarDays className="h-3 w-3" />
                      {deYmd(data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar mode="single" locale={ptBR} selected={deYmd(data)}
                              onSelect={d => { if (d) { setData(paraYmdLocal(d)); setCalendarioAberto(false); } }} />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Atalhos para os dois casos que são quase toda a operação */}
              <div className="flex overflow-hidden rounded-md border border-border">
                {([['hoje', hoje()], ['amanhã', emDias(1)], ['segunda', proximaSegunda()]] as [string, string][])
                  .map(([rot, ymd]) => (
                    <button key={rot} onClick={() => setData(ymd)}
                            className={cn('px-2 py-1 text-[11px] transition-colors',
                              data === ymd ? 'bg-primary text-primary-foreground'
                                           : 'bg-secondary text-muted-foreground hover:text-foreground')}>
                      {rot}
                    </button>
                  ))}
              </div>

              <Button size="sm" className="h-8 gap-1.5 text-xs"
                      disabled={enviando} onClick={() => void enviar()}>
                <Send className="h-3 w-3" />
                {enviando ? 'Enviando…' : 'Enviar para a esteira'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Local, nunca `toISOString` — às 21h ele devolveria o dia seguinte. */
function paraYmdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A próxima segunda, porque a esteira costuma ser planejada por semana. */
function proximaSegunda(): string {
  const d = new Date();
  const faltam = (8 - d.getDay()) % 7 || 7;
  return emDias(faltam);
}
