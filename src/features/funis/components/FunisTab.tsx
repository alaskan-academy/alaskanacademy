import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import {
  ChevronDown, ChevronRight, ExternalLink, Plus, Pencil,
  Globe, ShoppingBag, FlaskConical,
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
      s.has(id) ? s.delete(id) : s.add(id);
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

  const projetoMap = Object.fromEntries(projetos.map(p => [p.id, p]));

  type Group = { projeto: Projeto | null; funis: Funil[] };
  const groups: Group[] = [];
  const seen = new Set<string | null>();

  // First pass: projetos with funis
  for (const funil of funis) {
    const pid = funil.oferta_id ?? null;
    if (!seen.has(pid)) {
      seen.add(pid);
      groups.push({
        projeto: pid ? (projetoMap[pid] ?? null) : null,
        funis: funis.filter(f => (f.oferta_id ?? null) === pid),
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
        <p className="text-sm text-muted-foreground">Nenhum funil cadastrado ainda.</p>
        <Button size="sm" onClick={() => openNew()}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Novo funil
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

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" className="h-9 gap-1.5" onClick={() => openNew()}>
          <Plus className="h-3.5 w-3.5" />
          Novo funil
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
                  {group.funis.length} funil{group.funis.length !== 1 ? 's' : ''}
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
                Funil
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
                const testesRodando    = funilTestes.filter(t => t.pipeline_status === 'rodando');
                const testesConcluidos = funilTestes.filter(t => t.pipeline_status === 'concluido');
                const testesAtivos = funilTestes.filter(t => t.pipeline_status !== 'concluido');
                const mySubofertas = funilSubofertas.filter(fs => fs.funil_id === funil.id);
                const isHighlighted = statusDisplay === 'em_teste';
                const isPausadoAnalise = statusDisplay === 'pausado_analise';

                return (
                  <div
                    key={funil.id}
                    className={cn(
                      'rounded-lg overflow-hidden transition-all',
                      isHighlighted
                        ? 'border-2 border-amber-500/60 bg-amber-500/5 shadow-[0_0_10px_2px_rgba(245,158,11,0.1)]'
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
                        isPausadoAnalise && 'text-orange-300',
                      )}>
                        {funil.nome}
                      </span>

                      {funil.metodo && (
                        <span className="text-xs text-muted-foreground hidden sm:block shrink-0">{funil.metodo}</span>
                      )}

                      {funil.preco != null && (
                        <span className="text-xs font-mono text-foreground hidden md:block shrink-0">
                          {formatCurrency(funil.preco)}
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

                        {(testesPlanejados.length > 0 || testesRodando.length > 0 || testesConcluidos.length > 0) && (
                          <div className="space-y-2.5">
                            {testesPlanejados.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                                  Planejados
                                </p>
                                <TesteRows testes={testesPlanejados} onOpen={openTeste} />
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
