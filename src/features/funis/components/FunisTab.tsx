import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import {
  ChevronDown, ChevronRight, ExternalLink, Plus, Pencil,
  Globe, ShoppingBag, FlaskConical, Video, AlertTriangle, Archive,
} from 'lucide-react';
import { FunilModal } from './FunilModal';
import { TesteModal } from './TesteModal';
import {
  Funil, Projeto, FunilSuboferta, Dominio, TesteFunil,
  getStatusDisplay, StatusDisplay,
} from '../types';

interface Props {
  funis: Funil[];
  projetos: Projeto[];
  funilSubofertas: FunilSuboferta[];
  dominios: Dominio[];
  testes: TesteFunil[];
  onReload: () => void;
}

const STATUS_CONFIG: Record<StatusDisplay, { label: string; cls: string }> = {
  planejado:      { label: 'Em planejamento',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  ativo:          { label: 'Ativo',            cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  em_teste:       { label: 'Em teste',         cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  pausado:        { label: 'Pausado',          cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  pausado_analise:{ label: 'Pausado p/ análise', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  arquivado:      { label: 'Arquivado',        cls: 'bg-muted text-muted-foreground' },
};

function StatusBadge({ status }: { status: StatusDisplay }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="flex items-center gap-1.5">
      {status === 'em_teste' && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
      )}
      {status === 'pausado_analise' && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
        </span>
      )}
      <Badge className={cn('text-xs font-semibold border-0', cfg.cls)}>{cfg.label}</Badge>
    </span>
  );
}

/**
 * O que o REV tem, além do cadastro: VSL, domínios, checkouts e vendas.
 *
 * Vem de `vw_mapa_revs`, a mesma view que a aba Mapa usa. Aqui entram so os
 * dois campos que a linha mostra -- VSL e vendas -- para o REV que vende 539
 * parar de ser visualmente identico ao que vende zero.
 */
interface DadosDoRev {
  id: string;
  vsl: string | null;
  vsl_duracao: number | null;
  dominios: string[] | null;
  checkouts: string[] | null;
  vendas: number;
  ultima_venda: string | null;
  metodo: string | null;
  url_page: string | null;
  busca: string;
}

/**
 * O que falta preencher neste REV, numa frase.
 *
 * Antes cada campo vazio ocupava a sua própria linha dizendo "sem VSL", "sem
 * domínio", "nenhum checkout", "sem página". Com 23 REVs isso somava ~90 "não
 * tem" na tela, e de longe parecia sistema quebrado em vez de trabalho
 * pendente. Uma frase só diz o mesmo e devolve o espaço para o que existe.
 */
function oQueFalta(
  d: DadosDoRev | undefined,
  temDominio: boolean,
  status: StatusDisplay,
): string | null {
  if (!d) return null;

  // Só avisa em REV que está NO AR.
  //
  // Num REV planejado, "faltam VSL, domínio e checkout" é a descrição de um REV
  // planejado — não é notícia. Mostrar em todos fazia 23 linhas repetirem a
  // mesma frase, 13 delas idênticas, e o aviso voltava a ser paisagem.
  //
  // Num REV ativo é outra coisa: significa que tem gente comprando e a gente
  // não consegue medir. Isso é problema, e é o que merece a tinta.
  if (status !== 'ativo' && status !== 'em_teste') return null;

  const faltas: string[] = [];
  if (!d.vsl) faltas.push('VSL');
  if (!temDominio) faltas.push('domínio');
  if (!d.checkouts?.length) faltas.push('checkout');
  if (faltas.length === 0) return null;
  if (faltas.length === 1) return `falta ${faltas[0]}`;
  return `faltam ${faltas.slice(0, -1).join(', ')} e ${faltas[faltas.length - 1]}`;
}

/**
 * O nome do REV diz um método e o campo `metodo` diz outro.
 *
 * Dois REVs se chamam "REV5 - VSL" e têm `metodo = 'TSL'`. Não dá para corrigir
 * automaticamente — não há como saber qual dos dois está certo —, mas dá para
 * parar de esconder: antes a contradição só aparecia para quem lesse as duas
 * coisas lado a lado e reparasse.
 */
function metodoContradizNome(rev: string, metodo: string | null): boolean {
  if (!metodo) return false;
  const nome = rev.toUpperCase();
  const m = metodo.toUpperCase();
  return (nome.includes('VSL') && m === 'TSL') || (nome.includes('TSL') && m === 'VSL');
}

const TIPO_BADGE: Record<string, { label: string; cls: string }> = {
  funil_novo: { label: 'Funil novo',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ab_interno: { label: 'A/B interno', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  ad:         { label: 'AD',          cls: 'bg-sky-500/15 text-sky-400' },
};

function TesteRows({ testes, onOpen, muted = false }: { testes: TesteFunil[]; onOpen: (t: TesteFunil, e: React.MouseEvent) => void; muted?: boolean }) {
  return (
    <div className="space-y-1">
      {testes.map(t => {
        const badge = TIPO_BADGE[t.tipo];
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            className={cn(
              'flex items-center gap-2 text-xs rounded px-1 -mx-1 py-0.5 cursor-pointer hover:bg-muted/50 transition-colors',
              muted && 'opacity-60',
            )}
            onClick={e => onOpen(t, e)}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen(t, e as unknown as React.MouseEvent)}
          >
            <FlaskConical className="h-3 w-3 text-amber-400 shrink-0" />
            <span className={cn(
              'flex-1 min-w-0 truncate',
              muted
                ? t.validado
                  ? 'text-emerald-400'
                  : 'text-red-400'
                : 'text-foreground',
            )}>{t.titulo}</span>
            {badge && (
              <Badge className={cn('text-[9px] border-0 px-1.5 py-0 shrink-0', badge.cls)}>
                {badge.label}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FunisTab({ funis, projetos, funilSubofertas, dominios, testes, onReload }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [verArquivados, setVerArquivados] = useState(false);
  const [dados, setDados] = useState<Record<string, DadosDoRev>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editFunil, setEditFunil] = useState<Funil | null>(null);
  const [modalKey, setModalKey] = useState(0);
  const [presetProjeto, setPresetProjeto] = useState('');
  const [testeModalOpen, setTesteModalOpen] = useState(false);
  const [editTeste, setEditTeste] = useState<TesteFunil | null>(null);
  const [testeModalKey, setTesteModalKey] = useState(0);

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function openNew(projetoId = '') {
    setEditFunil(null);
    setPresetProjeto(projetoId);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function openTeste(t: TesteFunil, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTeste(t);
    setTesteModalKey(k => k + 1);
    setTesteModalOpen(true);
  }

  function openEdit(funil: Funil, e: React.MouseEvent) {
    e.stopPropagation();
    setEditFunil(funil);
    setPresetProjeto('');
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  // Carrega VSL, domínios, checkouts e vendas de cada REV. Consulta separada de
  // `funis` porque agrega vendas: se entrasse no mesmo select da página, o
  // carregamento da tela inteira passaria a esperar por ela.
  const carregarDados = useCallback(async () => {
    const { data } = await supabase.from('vw_mapa_revs').select('*');
    const porId: Record<string, DadosDoRev> = {};
    for (const d of (data ?? []) as DadosDoRev[]) porId[d.id] = d;
    setDados(porId);
  }, []);

  useEffect(() => { carregarDados(); }, [carregarDados, funis]);

  const projetoMap = Object.fromEntries(projetos.map(p => [p.id, p]));

  /**
   * Arquivados saem dos grupos e vão para uma área própria no fim.
   *
   * Eles não desaparecem — um REV arquivado ainda carrega as vendas que fez, e
   * apagá-lo da tela apagaria o histórico junto. Mas misturado aos ativos ele
   * competia por atenção com o que está no ar, e num projeto com 5 REVs onde 3
   * estão arquivados a lista mentia sobre o tamanho da operação.
   */
  const arquivados = funis.filter(f => getStatusDisplay(f, testes) === 'arquivado');
  const emUso = funis.filter(f => getStatusDisplay(f, testes) !== 'arquivado');

  type Group = { projeto: Projeto | null; funis: Funil[] };
  const groups: Group[] = [];
  const seen = new Set<string | null>();

  // First pass: projetos with funis
  for (const funil of emUso) {
    const pid = funil.projeto_id ?? null;
    if (!seen.has(pid)) {
      seen.add(pid);
      groups.push({
        projeto: pid ? (projetoMap[pid] ?? null) : null,
        funis: emUso.filter(f => (f.projeto_id ?? null) === pid),
      });
    }
  }

  // Sort: groups with projeto first, then "Sem projeto"
  groups.sort((a, b) => {
    if (a.projeto && !b.projeto) return -1;
    if (!a.projeto && b.projeto) return 1;
    return (a.projeto?.nome ?? '').localeCompare(b.projeto?.nome ?? '');
  });

  if (funis.length === 0) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-muted-foreground">Nenhum REV cadastrado ainda.</p>
        <Button size="sm" onClick={() => openNew()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Novo REV
        </Button>
        <FunilModal
          key={modalKey}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); onReload(); }}
          funil={null}
          projetos={projetos}

          funilSubofertas={funilSubofertas}
          dominios={dominios}
        />
      </div>
    );
  }

  // Conta so REV no ar: e onde a VSL faltando impede de medir algo que ja esta
  // vendendo. Contar os planejados juntos daria um numero grande e inerte.
  const semVslCount = funis.filter(f => {
    const s = getStatusDisplay(f, testes);
    return !f.vsl_id && (s === 'ativo' || s === 'em_teste');
  }).length;

  return (
    <div className="space-y-6">
      {/* A busca por VSL/domínio/checkout mora na aba Mapa, não aqui.
          Cheguei a fundir as duas telas e ela não gostou — o agrupamento por
          projeto e a busca ampla são modos de olhar diferentes, e juntá-los
          tirou dela a escolha de qual usar. */}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {semVslCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/25">
            <AlertTriangle className="h-3.5 w-3.5" />
            {semVslCount} {semVslCount === 1 ? 'REV sem VSL' : 'REVs sem VSL'}
          </span>
        )}

        <Button size="sm" className="h-9 gap-1.5" onClick={() => openNew()}>
          <Plus className="h-3.5 w-3.5" />
          Novo REV
        </Button>
      </div>


      {groups.map(group => {
        const projetoId = group.projeto?.id ?? '__none__';
        const ativoCount = group.funis.filter(f => {
          const s = getStatusDisplay(f, testes);
          return s === 'ativo' || s === 'em_teste';
        }).length;

        return (
          <div key={projetoId}>
            {/* Projeto header */}
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold text-foreground truncate">
                  {group.projeto?.nome ?? 'Sem projeto'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {group.funis.length} REV{group.funis.length !== 1 ? 's' : ''}
                  {ativoCount > 0 && ` · ${ativoCount} ativo${ativoCount !== 1 ? 's' : ''}`}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => openNew(group.projeto?.id ?? '')}
              >
                <Plus className="h-3 w-3" />
                REV
              </Button>
            </div>

            <div className="space-y-2 pl-1">
              {group.funis.map(funil => {
                const isOpen = expanded.has(funil.id);
                const statusDisplay = getStatusDisplay(funil, testes);
                const funilDominios = dominios.filter(d => {
                  const ids = d.funil_ids?.length ? d.funil_ids : d.funil_id ? [d.funil_id] : [];
                  return ids.includes(funil.id);
                });
                const funilTestes = testes.filter(t => t.funil_id === funil.id || t.funil_ids?.includes(funil.id));
                const testesPlanejados  = funilTestes.filter(t => t.pipeline_status === 'planejado' || t.pipeline_status === 'produzindo');
                const testesPromtos     = funilTestes.filter(t => t.pipeline_status === 'pronto_para_teste');
                const testesRodando    = funilTestes.filter(t => t.pipeline_status === 'rodando');
                const testesConcluidos = funilTestes.filter(t => t.pipeline_status === 'concluido');
                const testesAtivos = funilTestes.filter(t => t.pipeline_status !== 'concluido');
                const hasTestePronto = testesPromtos.length > 0;
                const mySubofertas = funilSubofertas.filter(fs => fs.funil_id === funil.id);
                const d = dados[funil.id];
                const falta = oQueFalta(d, funilDominios.length > 0, statusDisplay);
                const isHighlighted = statusDisplay === 'em_teste';
                const isPausadoAnalise = statusDisplay === 'pausado_analise';

                return (
                  <div
                    key={funil.id}
                    className={cn(
                      'rounded-lg overflow-hidden transition-all',
                      isHighlighted
                        ? 'border-2 border-amber-500/60 bg-amber-500/5 shadow-[0_0_10px_2px_rgba(245,158,11,0.1)]'
                        : hasTestePronto
                          ? 'border-2 border-green-500/60 bg-green-500/5 shadow-[0_0_10px_2px_rgba(34,197,94,0.12)]'
                          : isPausadoAnalise
                            ? 'border-2 border-orange-500/70 bg-orange-500/5 shadow-[0_0_8px_2px_rgba(249,115,22,0.12)]'
                            : 'border border-border bg-card',
                    )}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => toggle(funil.id)}
                      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle(funil.id)}
                    >
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      }

                      <span className={cn(
                        'font-medium text-sm flex-1 min-w-0 truncate',
                        isHighlighted && 'text-amber-200',
                        !isHighlighted && hasTestePronto && 'text-green-300',
                        isPausadoAnalise && !isHighlighted && !hasTestePronto && 'text-orange-300',
                      )}>
                        {funil.nome}
                      </span>

                      {/* A VSL, que é a pergunta mais frequente sobre um REV.
                          Antes só aparecia abrindo o cadastro. */}
                      {d?.vsl && (
                        <span
                          title={d.vsl}
                          className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground shrink-0 max-w-[12rem]"
                        >
                          <Video className="h-3 w-3 shrink-0" />
                          <span className="truncate">{d.vsl}</span>
                        </span>
                      )}

                      {/* Vendas. Sem isto, um REV com 538 vendas era visualmente
                          idêntico a um com zero — que era o defeito da lista. */}
                      {d && d.vendas > 0 && (
                        <span className="text-xs tabular-nums shrink-0">
                          <span className="font-semibold">{formatNumber(d.vendas)}</span>
                          <span className="text-muted-foreground"> vendas</span>
                        </span>
                      )}

                      {/* O que falta, numa frase, em vez de um campo vazio por linha. */}
                      {falta && (
                        <span className="hidden md:block text-[11px] text-amber-400/80 shrink-0">
                          {falta}
                        </span>
                      )}

                      {metodoContradizNome(funil.nome, funil.metodo) && (
                        <span
                          title={`O nome diz uma coisa e o método diz "${funil.metodo}". Um dos dois está errado.`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0"
                        >
                          nome × {funil.metodo}
                        </span>
                      )}

                      <div className="flex items-center gap-2 shrink-0">
                        {funilDominios.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Globe className="h-3 w-3" />
                            {funilDominios.length}
                          </span>
                        )}
                        {testesAtivos.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-amber-400">
                            <FlaskConical className="h-3 w-3" />
                            {testesAtivos.length}
                          </span>
                        )}
                        <StatusBadge status={statusDisplay} />
                      </div>

                      <button
                        type="button"
                        onClick={e => openEdit(funil, e)}
                        className="ml-1 p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-border/60 pt-3 space-y-3">
                        {funil.link_checkout && (
                          <a
                            href={funil.link_checkout}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Link de checkout
                          </a>
                        )}

                        {mySubofertas.filter(fs => fs.tipo === 'checkout').length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                              Preços e Checkout
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {mySubofertas.filter(fs => fs.tipo === 'checkout').map(fs => (
                                <Badge
                                  key={fs.id}
                                  className="text-[10px] font-medium border-0 gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                >
                                  {fs.nome ?? '—'}
                                  {fs.preco != null && (
                                    <span className="opacity-60 font-mono">{formatCurrency(fs.preco)}</span>
                                  )}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {mySubofertas.filter(fs => fs.tipo === 'orderbump' || fs.tipo === 'upsell').length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                              Order Bumps & Upsells
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {mySubofertas.filter(fs => fs.tipo === 'orderbump' || fs.tipo === 'upsell').map(fs => (
                                <Badge
                                  key={fs.id}
                                  className={cn(
                                    'text-[10px] font-medium border-0 gap-1',
                                    fs.tipo === 'upsell'
                                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                                  )}
                                >
                                  {fs.tipo === 'upsell' ? '↑' : '●'} {fs.nome ?? '—'}
                                  {fs.preco != null && (
                                    <span className="opacity-60 font-mono">{formatCurrency(fs.preco)}</span>
                                  )}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {funilDominios.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                              Domínios
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {funilDominios.map(d => (
                                <span
                                  key={d.id}
                                  className={cn(
                                    'text-xs px-2 py-0.5 rounded-full border font-mono',
                                    d.ativo
                                      ? 'border-border text-foreground'
                                      : 'border-border/40 text-muted-foreground line-through',
                                  )}
                                >
                                  {d.nome}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {(testesPlanejados.length > 0 || testesPromtos.length > 0 || testesRodando.length > 0 || testesConcluidos.length > 0) && (
                          <div className="space-y-2.5">
                            {testesPlanejados.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                  Planejados
                                </p>
                                <TesteRows testes={testesPlanejados} onOpen={openTeste} />
                              </div>
                            )}
                            {testesPromtos.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-green-500 uppercase tracking-wide mb-1.5">
                                  Pronto para teste
                                </p>
                                <TesteRows testes={testesPromtos} onOpen={openTeste} />
                              </div>
                            )}
                            {testesRodando.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-1.5">
                                  Em andamento
                                </p>
                                <TesteRows testes={testesRodando} onOpen={openTeste} />
                              </div>
                            )}
                            {testesConcluidos.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide mb-1.5">
                                  Concluídos
                                </p>
                                <TesteRows testes={testesConcluidos} onOpen={openTeste} muted />
                              </div>
                            )}
                          </div>
                        )}

                        {funil.notas && (
                          <p className="text-xs text-muted-foreground italic">{funil.notas}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Arquivados, fora dos projetos e fechados por padrão.
          Continuam acessíveis porque um REV arquivado ainda carrega as vendas
          que fez — sumir com ele da tela sumiria com o histórico junto. */}
      {arquivados.length > 0 && (
        <div className="pt-2 border-t border-border/60">
          <button
            type="button"
            onClick={() => setVerArquivados(v => !v)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {verArquivados
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />}
            <Archive className="h-3.5 w-3.5" />
            {arquivados.length} REV{arquivados.length !== 1 ? 's' : ''} arquivado{arquivados.length !== 1 ? 's' : ''}
          </button>

          {verArquivados && (
            <div className="mt-2 space-y-1 pl-1">
              {arquivados.map(funil => {
                const proj = funil.projeto_id ? projetoMap[funil.projeto_id] : null;
                const d = dados[funil.id];
                return (
                  <div
                    key={funil.id}
                    className="flex items-center gap-3 px-4 py-2 rounded-lg border border-border/50 bg-card/40 text-sm"
                  >
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {proj?.nome ?? 'sem projeto'}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-muted-foreground">{funil.nome}</span>
                    {d && d.vendas > 0 && (
                      <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                        {formatNumber(d.vendas)} vendas
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={e => openEdit(funil, e)}
                      className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <FunilModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); onReload(); }}
        funil={editFunil}
        projetos={projetos}
        funilSubofertas={funilSubofertas}
        dominios={dominios}
      />

      <TesteModal
        key={`t-${testeModalKey}`}
        open={testeModalOpen}
        onClose={() => setTesteModalOpen(false)}
        onSaved={() => { setTesteModalOpen(false); onReload(); }}
        teste={editTeste}
        funis={funis}
        projetos={projetos}
      />
    </div>
  );
}
