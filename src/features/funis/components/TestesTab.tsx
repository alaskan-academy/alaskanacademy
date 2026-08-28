import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Plus, Pencil, ChevronLeft, ChevronRight, ExternalLink,
  Lightbulb, Hammer, Rocket, FlaskConical, CheckCircle2, XCircle, MinusCircle, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { TesteModal } from './TesteModal';
import { MultiFilter } from './MultiFilter';
import { TesteFunil, Funil, Projeto, PerfilSimples, PipelineStatus, CategoriaTest } from '../types';
import { semVeredito, rotuloDias, iceScore, hojeLocal } from '../testes';

/**
 * Todos os testes, do plano ao veredito, numa tela só.
 *
 * Eram três: Esteira (planejado/produzindo/pronto), Testes (rodando) e
 * Concluídos — 994 linhas para o MESMO objeto em fases diferentes do mesmo
 * ciclo. Cada uma reimplementava os mesmos filtros de projeto e funil, e as três
 * discordavam em detalhes.
 *
 * O custo real de separar não era o código repetido: era o ciclo não fechar.
 * Um teste que passa para "rodando" sai da tela onde foi planejado, e quem o
 * planejou não volta para ver no que deu. Hoje 10 dos 13 testes concluídos estão
 * sem vencedor preenchido, e 4 estão rodando sem data de fim. Com tudo na mesma
 * tela, o teste esquecido fica visível ao lado dos outros.
 *
 * Por isso o aviso de teste parado existe: é o único elemento aqui que não
 * estava em nenhuma das três telas, e é o que ataca o defeito.
 */

// ── Colunas ──────────────────────────────────────────────────────────────────

const COLUNAS: {
  key: PipelineStatus;
  label: string;
  Icon: React.ElementType;
  headerCls: string;
  borderCls: string;
  bgCls: string;
}[] = [
  { key: 'planejado',         label: 'Planejado',         Icon: Lightbulb,     headerCls: 'text-blue-400',    borderCls: 'border-blue-500/25',    bgCls: 'bg-blue-500/5' },
  { key: 'produzindo',        label: 'Produzindo',        Icon: Hammer,        headerCls: 'text-purple-400',  borderCls: 'border-purple-500/25',  bgCls: 'bg-purple-500/5' },
  { key: 'pronto_para_teste', label: 'Pronto para teste', Icon: Rocket,        headerCls: 'text-teal-400',    borderCls: 'border-teal-500/25',    bgCls: 'bg-teal-500/5' },
  { key: 'rodando',           label: 'Rodando',           Icon: FlaskConical,  headerCls: 'text-amber-400',   borderCls: 'border-amber-500/30',   bgCls: 'bg-amber-500/5' },
  { key: 'concluido',         label: 'Concluído',         Icon: CheckCircle2,  headerCls: 'text-emerald-400', borderCls: 'border-emerald-500/25', bgCls: 'bg-emerald-500/5' },
];

const ORDEM: PipelineStatus[] = COLUNAS.map(c => c.key);

const TIPO_CFG = {
  funil_novo: { label: 'Funil novo',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ab_interno: { label: 'A/B interno', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  ad:         { label: 'AD',          cls: 'bg-sky-500/15 text-sky-400' },
};

const CATEGORIA_CFG: Record<CategoriaTest, { label: string; cls: string }> = {
  ad:       { label: 'AD',       cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  pagina:   { label: 'Página',   cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  oferta:   { label: 'Oferta',   cls: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  upsell:   { label: 'Upsell',   cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  ticket:   { label: 'Ticket',   cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  whatsapp: { label: 'WhatsApp', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  outro:    { label: 'Outro',    cls: 'bg-muted text-muted-foreground border-border' },
};

const VENCEDOR_LABEL: Record<string, string> = { a: 'Variante A', b: 'Variante B' };

/**
 * Quantos concluidos mostrar antes de cortar.
 *
 * So esta coluna precisa de teto: as outras quatro sao trabalho em aberto e nao
 * crescem sem limite. Concluidos acumulam para sempre.
 */
const TETO_CONCLUIDOS = 15;

/**
 * Os dois lados de um teste do VTurb, e o veredito em um clique.
 *
 * É aqui que o ciclo fecha. Dez dos treze testes concluídos estão sem vencedor
 * porque julgar exigia abrir o VTurb, achar o teste, copiar os números e voltar.
 * Com os números na frente, decidir é um clique.
 *
 * O `Δ` mostra a diferença, mas NÃO chama de vencedor: "3,28% × 1,71%" com duas
 * semanas de dados é sugestivo, não conclusivo, e um rótulo automático de
 * vencedor viraria decisão sem ninguém ter decidido. Quem decide é ela.
 */
function ComparacaoVturb({ teste, onVeredito }: {
  teste: TesteFunil;
  onVeredito: (v: 'a' | 'b' | 'inconclusivo') => void;
}) {
  const lados = teste.metricas_vturb?.lados ?? [];
  if (lados.length < 2) return null;

  const [a, b] = lados;
  const melhor = (a.taxa_conversao ?? 0) >= (b.taxa_conversao ?? 0) ? 0 : 1;
  const delta = Math.abs((a.taxa_conversao ?? 0) - (b.taxa_conversao ?? 0));

  // Amostras muito desiguais não são teste A/B honesto: um dos lados pode estar
  // recebendo tráfego de outra origem. Vale avisar antes de alguém comparar.
  const desbalanceado = a.views > 0 && b.views > 0
    && Math.max(a.views, b.views) / Math.min(a.views, b.views) >= 3;

  return (
    <div className="mt-1 rounded border border-border/60 bg-muted/20 p-1.5 space-y-1">
      {lados.slice(0, 2).map((l, i) => (
        <div key={l.player_id} className="flex items-baseline gap-1.5 text-[10px]">
          <span className={cn(
            'font-semibold w-3 shrink-0',
            i === melhor ? 'text-emerald-400' : 'text-muted-foreground',
          )}>
            {i === 0 ? 'A' : 'B'}
          </span>
          <span className="truncate flex-1 text-muted-foreground" title={l.vsl}>{l.vsl}</span>
          <span className={cn('tabular-nums font-medium', i === melhor && 'text-emerald-400')}>
            {l.taxa_conversao ?? '—'}%
          </span>
          <span className="tabular-nums text-muted-foreground/70">
            {l.conversoes}/{l.views}
          </span>
        </div>
      ))}

      {desbalanceado && (
        <p className="text-[10px] text-amber-400/90">
          Amostras muito desiguais — comparar com cuidado.
        </p>
      )}

      {teste.vencedor ? (
        <p className="text-[10px] text-emerald-400">
          {teste.vencedor === 'inconclusivo'
            ? 'Marcado como inconclusivo'
            : `Vencedora: variante ${teste.vencedor.toUpperCase()}`}
        </p>
      ) : (
        <div className="flex items-center gap-1 pt-0.5">
          <span className="text-[10px] text-muted-foreground/70 mr-auto">
            Δ {delta.toFixed(2)}pp · quem venceu?
          </span>
          {(['a', 'b'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => onVeredito(v)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            >
              {v.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onVeredito('inconclusivo')}
            className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            nenhuma
          </button>
        </div>
      )}
    </div>
  );
}

function IceBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const { label, cls } =
    score >= 9 ? { label: `🔥 ${score}`, cls: 'text-red-400 bg-red-500/10 border-red-500/20' } :
    score >= 6 ? { label: `⚡ ${score}`, cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' } :
    score >= 4 ? { label: `· ${score}`,  cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' } :
                 { label: `· ${score}`,  cls: 'text-muted-foreground bg-muted/40 border-border' };
  return <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0', cls)}>{label}</span>;
}

// ── Componente ───────────────────────────────────────────────────────────────

interface Props {
  testes: TesteFunil[];
  funis: Funil[];
  projetos: Projeto[];
  perfis: PerfilSimples[];
  onReload: () => void;
}

export function TestesTab({ testes, funis, projetos, perfis, onReload }: Props) {
  const perfilMap  = useMemo(() => Object.fromEntries(perfis.map(p => [p.id, p.nome])), [perfis]);
  const funilMap   = useMemo(() => Object.fromEntries(funis.map(f => [f.id, f])), [funis]);
  const projetoMap = useMemo(() => Object.fromEntries(projetos.map(p => [p.id, p])), [projetos]);

  const [filtroProjetos, setFiltroProjetos]   = useState<string[]>([]);
  const [filtroFunis, setFiltroFunis]         = useState<string[]>([]);
  const [filtroCategoria, setFiltroCategoria] = useState('todos');
  const [filtroTipo, setFiltroTipo]           = useState('todos');
  const [soParados, setSoParados]             = useState(false);

  const [modalOpen, setModalOpen]     = useState(false);
  const [editTeste, setEditTeste]     = useState<TesteFunil | null>(null);
  const [presetStatus, setPresetStatus] = useState<PipelineStatus>('planejado');
  const [modalKey, setModalKey]       = useState(0);
  const [movendo, setMovendo]         = useState<string | null>(null);
  const [verTodosConcluidos, setVerTodosConcluidos] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [expandidas, setExpandidas] = useState<Set<PipelineStatus>>(new Set());

  /*
    `?teste=<id>` abre o card direto.

    É por aqui que o Radar traz alguém para cá: lá o teste de funil é só um
    espelho, e "edite lá" sem um caminho é um recado que obriga a pessoa a
    procurar o card num quadro de 44.

    `jaAbriu` existe porque `testes` muda de identidade a cada recarga da
    página: sem ele, salvar reabriria o modal que acabou de fechar, para sempre.
  */
  const [params, setParams] = useSearchParams();
  const pedido = params.get('teste');
  const jaAbriu = useRef<string | null>(null);

  useEffect(() => {
    if (!pedido || jaAbriu.current === pedido) return;
    jaAbriu.current = pedido;
    const t = testes.find(x => x.id === pedido);
    if (!t) {
      /*
        Não achou: limpa o endereço e deixa a pessoa no quadro.

        Aqui NÃO cabe um toast, e isso foi medido: um toast disparado no
        primeiro efeito depois de carregar a página não aparece — o mesmo toast
        atrasado em 1,5s aparece. O `Toaster` lê `memoryState` ao montar e só
        se inscreve depois, então perde o que foi despachado antes. Vale para o
        app inteiro, não só para aqui.

        De todo jeito, com o espelho seguindo `arquivado` e `pipeline_status`,
        o link do Radar só aponta para teste que está no quadro. Sobrar aqui
        significa endereço velho ou digitado na mão.
      */
      const p = new URLSearchParams(params);
      p.delete('teste');
      setParams(p, { replace: true });
      return;
    }
    setEditTeste(t);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }, [pedido, testes, params, setParams]);

  /* Fechar limpa o `?teste=`, senão a aba reabre o modal ao ser revisitada. */
  function fecharModal() {
    setModalOpen(false);
    if (params.get('teste')) {
      const p = new URLSearchParams(params);
      p.delete('teste');
      setParams(p, { replace: true });
      jaAbriu.current = null;
    }
  }

  const funisDisponiveis = filtroProjetos.length === 0
    ? funis
    : funis.filter(f => f.projeto_id && filtroProjetos.includes(f.projeto_id));

  function mudarProjetos(ids: string[]) {
    setFiltroProjetos(ids);
    // Um funil selecionado que não pertence a nenhum projeto do novo filtro
    // deixaria a tela vazia sem explicar por quê. Some junto.
    if (ids.length > 0) {
      const validos = funis.filter(f => f.projeto_id && ids.includes(f.projeto_id)).map(f => f.id);
      setFiltroFunis(prev => prev.filter(id => validos.includes(id)));
    } else {
      setFiltroFunis([]);
    }
  }

  /** Um teste pode citar vários funis; `funil_ids` é a lista, `funil_id` o legado. */
  function funisDoTeste(t: TesteFunil): Funil[] {
    const ids = t.funil_ids?.length ? t.funil_ids : t.funil_id ? [t.funil_id] : [];
    return ids.map(id => funilMap[id]).filter(Boolean);
  }

  const filtrados = useMemo(() => testes.filter(t => {
    if (filtroTipo !== 'todos' && t.tipo !== filtroTipo) return false;
    if (filtroCategoria !== 'todos' && t.categoria !== filtroCategoria) return false;
    if (soParados && !semVeredito(t)) return false;
    if (filtroProjetos.length > 0) {
      const ligados = funisDoTeste(t);
      if (!ligados.some(f => f.projeto_id && filtroProjetos.includes(f.projeto_id))) return false;
    }
    if (filtroFunis.length > 0) {
      if (!filtroFunis.some(id => t.funil_id === id || t.funil_ids?.includes(id))) return false;
    }
    return true;
    // `semVeredito` e `funisDoTeste` só leem props já listadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [testes, filtroTipo, filtroCategoria, filtroProjetos, filtroFunis, soParados, funilMap]);

  const parados = useMemo(() => testes.filter(semVeredito).length, [testes]);

  async function mover(t: TesteFunil, dir: 1 | -1) {
    const idx = ORDEM.indexOf(t.pipeline_status ?? 'planejado');
    const proximo = ORDEM[idx + dir];
    if (!proximo) return;

    setMovendo(t.id);
    const patch: Record<string, unknown> = { pipeline_status: proximo };
    // Sem data_inicio o cartão nunca conta dias, e o aviso de teste parado nunca
    // dispara — que é justamente o defeito que esta tela existe para atacar.
    if (proximo === 'rodando' && !t.data_inicio) {
      patch.data_inicio = hojeLocal();
    }
    const { error } = await supabase.from('testes_funis').update(patch).eq('id', t.id);
    setMovendo(null);
    if (error) toast({ title: 'Erro ao mover', description: error.message, variant: 'destructive' });
    else onReload();
  }

  /** Registra o veredito direto do cartão, sem abrir o modal. */
  async function definirVencedor(t: TesteFunil, v: 'a' | 'b' | 'inconclusivo') {
    const patch: Record<string, unknown> = {
      vencedor: v,
      // "Inconclusivo" não é vitória: validar aqui faria um teste sem resultado
      // parecer aprovado nas contagens.
      validado: v !== 'inconclusivo',
      pipeline_status: 'concluido',
      data_fim: hojeLocal(),
    };
    const { error } = await supabase.from('testes_funis').update(patch).eq('id', t.id);
    if (error) toast({ title: 'Erro ao registrar', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Veredito registrado' }); onReload(); }
  }

  /** Busca os testes A/B do VTurb e atualiza os números dos que já existem. */
  async function sincronizarVturb() {
    setSincronizando(true);
    const { data, error } = await supabase.functions.invoke('vturb', {
      body: { acao: 'sincronizar_testes' },
    });
    setSincronizando(false);

    if (error) {
      toast({ title: 'Erro ao falar com o VTurb', description: error.message, variant: 'destructive' });
      return;
    }
    if (data?.erro) {
      toast({ title: 'VTurb', description: data.erro, variant: 'destructive' });
      return;
    }

    const d = data?.dados ?? {};
    toast({
      title: `${d.gravados ?? 0} de ${d.testes_no_vturb ?? 0} testes atualizados`,
      // Zero vínculos é o estado normal enquanto nenhum REV tiver VSL — a
      // mensagem precisa explicar, senão parece que a sincronização falhou.
      description: d.ligados_a_um_rev
        ? `${d.ligados_a_um_rev} ligados a um REV.`
        : 'Nenhum ligado a um REV ainda: escolha a VSL dos REVs para que eles se encontrem.',
    });
    onReload();
  }

  async function ativarFunil(funilId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const { error } = await supabase.from('funis').update({ status: 'ativo' }).eq('id', funilId);
    if (error) toast({ title: 'Erro ao ativar funil', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Funil ativado' }); onReload(); }
  }

  function abrirNovo(status: PipelineStatus) {
    setEditTeste(null);
    setPresetStatus(status);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function abrirEdicao(t: TesteFunil, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTeste(t);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Filtros — um só, para as cinco fases. Antes eram três cópias. */}
      <div className="flex flex-wrap items-center gap-2">
        <MultiFilter
          placeholder="Todos os projetos"
          options={projetos.map(p => ({ id: p.id, label: p.nome }))}
          value={filtroProjetos}
          onChange={mudarProjetos}
          width="w-44"
        />
        <MultiFilter
          placeholder="Todos os REVs"
          options={funisDisponiveis.map(f => {
            const proj = f.projeto_id ? projetoMap[f.projeto_id] : null;
            return { id: f.id, label: f.nome, sublabel: filtroProjetos.length !== 1 && proj ? proj.nome : undefined };
          })}
          value={filtroFunis}
          onChange={setFiltroFunis}
          width="w-52"
        />
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="h-9 text-sm w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="funil_novo">Funil novo</SelectItem>
            <SelectItem value="ab_interno">A/B interno</SelectItem>
            <SelectItem value="ad">AD</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
          <SelectTrigger className="h-9 text-sm w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as áreas</SelectItem>
            {Object.entries(CATEGORIA_CFG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {parados > 0 && (
          <button
            type="button"
            onClick={() => setSoParados(v => !v)}
            className={cn(
              'h-9 px-2.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors',
              soParados
                ? 'bg-red-500/15 text-red-400 border-red-500/40'
                : 'bg-red-500/5 text-red-400/80 border-red-500/20 hover:bg-red-500/10',
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {parados} sem veredito
          </button>
        )}

        <div className="flex-1" />
        <Button

          size="sm" variant="outline" className="h-9 gap-1.5"

          onClick={sincronizarVturb} disabled={sincronizando}

        >

          <RefreshCw className={cn('h-3.5 w-3.5', sincronizando && 'animate-spin')} />

          {sincronizando ? 'Buscando…' : 'Testes do VTurb'}

        </Button>

        <Button size="sm" className="h-9 gap-1.5" onClick={() => abrirNovo('planejado')}>
          <Plus className="h-3.5 w-3.5" />
          Novo teste
        </Button>
      </div>

      {/* O quadro rola na horizontal dentro do próprio contêiner: cinco colunas
          não cabem num laptop, e a página nunca deve rolar de lado. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {COLUNAS.map(col => {
            let cartoes = filtrados
              .filter(t => (t.pipeline_status ?? 'planejado') === col.key);

            // Concluídos crescem para sempre; o resto é trabalho em aberto e
            // não cresce. Só esta coluna precisa de teto.
            cartoes = col.key === 'concluido'
              ? cartoes.sort((a, b) => (b.data_fim ?? b.created_at).localeCompare(a.data_fim ?? a.created_at))
              : cartoes.sort((a, b) => (iceScore(b.impacto, b.dificuldade) ?? 0) - (iceScore(a.impacto, a.dificuldade) ?? 0));

            const total = cartoes.length;
            // Corta so quando esconder vale a pena. Com 13 concluidos, um botao
            // "ver os outros 1" custa mais atencao do que a rolagem que evita.
            const cortou = col.key === 'concluido' && !verTodosConcluidos && total > TETO_CONCLUIDOS * 1.5;
            if (cortou) cartoes = cartoes.slice(0, TETO_CONCLUIDOS);

            // Uma coluna sem cartão nenhum gastava os mesmos 288px de uma com
            // 20, e por causa disso o quadro media 1.488px e a coluna
            // "Concluído" ficava cortada mesmo numa janela de 1.440. Vazia, ela
            // encolhe para uma faixa com o nome na vertical; clicar expande.
            const encolhida = total === 0 && !expandidas.has(col.key);

            if (encolhida) {
              return (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => setExpandidas(prev => new Set(prev).add(col.key))}
                  title={`${col.label} — vazia. Clique para expandir.`}
                  className={cn(
                    'w-10 shrink-0 rounded-lg border flex flex-col items-center gap-2 py-3 transition-colors hover:bg-muted/30',
                    col.borderCls, col.bgCls,
                  )}
                >
                  <col.Icon className={cn('h-3.5 w-3.5 shrink-0', col.headerCls)} />
                  <span
                    className={cn('text-[10px] font-semibold whitespace-nowrap', col.headerCls)}
                    style={{ writingMode: 'vertical-rl' }}
                  >
                    {col.label}
                  </span>
                </button>
              );
            }

            return (
              <div key={col.key} className="w-64 shrink-0">
                <div className={cn('flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold', col.headerCls)}>
                  <col.Icon className="h-3.5 w-3.5" />
                  {col.label}
                  <span className="ml-auto tabular-nums text-muted-foreground font-normal">{total}</span>
                </div>

                <div className={cn('rounded-lg border p-2 space-y-2 min-h-24', col.borderCls, col.bgCls)}>
                  {total === 0 ? (
                    <p className="py-6 text-center text-[11px] text-muted-foreground/60 italic">
                      {soParados ? 'nada parado aqui' : 'vazio'}
                    </p>
                  ) : cartoes.map(t => {
                    const revs     = funisDoTeste(t);
                    const projs    = [...new Set(revs.map(f => f.projeto_id).filter(Boolean))]
                                      .map(id => projetoMap[id!]).filter(Boolean);
                    const tipoCfg  = TIPO_CFG[t.tipo];
                    const catCfg   = t.categoria ? CATEGORIA_CFG[t.categoria] : null;
                    const parado   = semVeredito(t);
                    const mexendo  = movendo === t.id;
                    const idx      = ORDEM.indexOf(t.pipeline_status ?? 'planejado');

                    const ResultIcon = t.validado ? CheckCircle2
                                     : t.vencedor === 'inconclusivo' ? MinusCircle
                                     : XCircle;

                    return (
                      <div
                        key={t.id}
                        className={cn(
                          'rounded-md border bg-card p-2.5 space-y-1.5',
                          parado ? 'border-red-500/40 ring-1 ring-red-500/20' : 'border-border/60',
                        )}
                      >
                        <div className="flex items-start gap-1.5">
                          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0', tipoCfg.cls)}>
                            {tipoCfg.label}
                          </span>
                          {catCfg && (
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', catCfg.cls)}>
                              {catCfg.label}
                            </span>
                          )}
                          <div className="flex-1" />
                          {col.key !== 'concluido' && <IceBadge score={iceScore(t.impacto, t.dificuldade)} />}
                        </div>

                        {projs.length > 0 && (
                          <p className="text-[10px] font-semibold text-foreground/70 truncate">
                            {projs.map(p => p.nome).join(', ')}
                          </p>
                        )}

                        <p className="text-sm font-medium leading-snug">{t.titulo}</p>

                        {revs.length > 0 && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {revs.map(f => f.nome).join(', ')}
                          </p>
                        )}

                        {/* Rodando: o tempo é a informação. */}
                        {col.key === 'rodando' && t.data_inicio && (
                          <p className={cn('text-[11px]', parado ? 'text-red-400 font-medium' : 'text-muted-foreground')}>
                            {parado && <AlertTriangle className="h-3 w-3 inline mr-1 -mt-0.5" />}
                            {rotuloDias(t.data_inicio)}
                            {parado && ' · sem veredito'}
                          </p>
                        )}

                        {/* Os números dos dois lados, para o veredito sair daqui
                            mesmo. Aparece em rodando e em concluído: um teste
                            rodando já mostra para onde está indo. */}
                        {t.metricas_vturb && (col.key === 'rodando' || col.key === 'concluido') && (
                          <ComparacaoVturb teste={t} onVeredito={v => definirVencedor(t, v)} />
                        )}

                        {/* Concluído: o veredito é a informação. */}
                        {col.key === 'concluido' && !t.metricas_vturb && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <ResultIcon className={cn(
                              'h-3.5 w-3.5 shrink-0',
                              t.validado ? 'text-emerald-400'
                                : t.vencedor === 'inconclusivo' ? 'text-muted-foreground'
                                : 'text-red-400',
                            )} />
                            <span className="text-muted-foreground truncate">
                              {t.vencedor === 'inconclusivo' ? 'Inconclusivo'
                                : t.vencedor ? `Venceu: ${VENCEDOR_LABEL[t.vencedor]}`
                                : 'Sem vencedor registrado'}
                            </span>
                          </div>
                        )}

                        {t.criado_por && perfilMap[t.criado_por] && (
                          <p className="text-[10px] text-muted-foreground/70">{perfilMap[t.criado_por]}</p>
                        )}

                        <div className="flex items-center gap-0.5 pt-0.5">
                          <button
                            type="button"
                            disabled={mexendo || idx === 0}
                            onClick={() => mover(t, -1)}
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
                            title="Voltar uma fase"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={mexendo || idx === ORDEM.length - 1}
                            onClick={() => mover(t, 1)}
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
                            title="Avançar uma fase"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={e => abrirEdicao(t, e)}
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                            title="Editar"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          {t.link_ad && (
                            <a
                              href={t.link_ad}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-primary transition-colors"
                              title="Ver anúncio"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <div className="flex-1" />
                          {t.tipo === 'funil_novo' && t.validado && t.funil_id && (
                            <button
                              type="button"
                              onClick={e => ativarFunil(t.funil_id!, e)}
                              className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            >
                              Ativar REV
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {cortou && (
                    <button
                      type="button"
                      onClick={() => setVerTodosConcluidos(true)}
                      className="w-full py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ver os outros {total - TETO_CONCLUIDOS}
                    </button>
                  )}

                  {col.key !== 'concluido' && (
                    <button
                      type="button"
                      onClick={() => abrirNovo(col.key)}
                      className="w-full py-1.5 rounded text-[11px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/40 transition-colors"
                    >
                      + teste
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TesteModal
        key={modalKey}
        open={modalOpen}
        onClose={fecharModal}
        onSaved={() => { fecharModal(); onReload(); }}
        teste={editTeste}
        funis={funis}
        projetos={projetos}
        presetPipelineStatus={presetStatus}
      />
    </div>
  );
}
