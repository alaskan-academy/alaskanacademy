import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  Plus, Pencil, ChevronRight, ChevronLeft, ExternalLink,
  Lightbulb, Hammer, BarChart2, CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { TesteModal } from './TesteModal';
import {
  TesteFunil, Funil, Projeto,
  PipelineStatus, CategoriaTest, ImpactoTest, DificuldadeTest,
} from '../types';

type TipoFilter = 'todos' | 'ab_interno' | 'funil_novo' | 'ad';

interface Props {
  testes: TesteFunil[];
  funis: Funil[];
  projetos: Projeto[];
  onReload: () => void;
}

// ── Pipeline columns ────────────────────────────────────────────────────────

const COLUMNS: {
  key: PipelineStatus;
  label: string;
  Icon: React.ElementType;
  headerCls: string;
  borderCls: string;
  bgCls: string;
}[] = [
  { key: 'planejado',  label: 'Planejado',  Icon: Lightbulb,    headerCls: 'text-blue-400',   borderCls: 'border-blue-500/25',   bgCls: 'bg-blue-500/5'   },
  { key: 'produzindo', label: 'Produzindo', Icon: Hammer,       headerCls: 'text-purple-400', borderCls: 'border-purple-500/25', bgCls: 'bg-purple-500/5' },
  { key: 'rodando',    label: 'Rodando',    Icon: BarChart2,    headerCls: 'text-amber-400',  borderCls: 'border-amber-500/25',  bgCls: 'bg-amber-500/5'  },
  { key: 'concluido',  label: 'Concluído',  Icon: CheckCircle2, headerCls: 'text-emerald-400',borderCls: 'border-emerald-500/25',bgCls: 'bg-emerald-500/5'},
];

const PIPELINE_ORDER: PipelineStatus[] = ['planejado', 'produzindo', 'rodando', 'concluido'];

// ── Categoria config ─────────────────────────────────────────────────────────

const CATEGORIA_CFG: Record<CategoriaTest, { label: string; cls: string }> = {
  ad:       { label: 'AD',       cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  pagina:   { label: 'Página',   cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  oferta:   { label: 'Oferta',   cls: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  upsell:   { label: 'Upsell',   cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  ticket:   { label: 'Ticket',   cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  whatsapp: { label: 'WhatsApp', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  outro:    { label: 'Outro',    cls: 'bg-muted text-muted-foreground border-border' },
};

// ── ICE score ─────────────────────────────────────────────────────────────────

function iceScore(impacto: ImpactoTest | null, dificuldade: DificuldadeTest | null): number | null {
  if (!impacto || !dificuldade) return null;
  const imp = { alto: 3, medio: 2, baixo: 1 }[impacto];
  const fac = { facil: 3, media: 2, dificil: 1 }[dificuldade];
  return imp * fac;
}

function IceBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const { label, cls } =
    score >= 9 ? { label: `🔥 ${score}`, cls: 'text-red-400 bg-red-500/10 border-red-500/20' } :
    score >= 6 ? { label: `⚡ ${score}`, cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' } :
    score >= 4 ? { label: `· ${score}`,  cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' } :
                 { label: `· ${score}`,  cls: 'text-muted-foreground bg-muted/40 border-border' };
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', cls)}>
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EsteiraTab({ testes, funis, projetos, onReload }: Props) {
  const [filterFunil, setFilterFunil]         = useState('todos');
  const [filterCategoria, setFilterCategoria] = useState('todos');
  const [filterTipo, setFilterTipo]           = useState<TipoFilter>('todos');
  const [modalOpen, setModalOpen]           = useState(false);
  const [editTeste, setEditTeste]           = useState<TesteFunil | null>(null);
  const [presetFunilId, setPresetFunilId]   = useState('');
  const [presetStatus, setPresetStatus]     = useState<PipelineStatus>('planejado');
  const [modalKey, setModalKey]             = useState(0);
  const [moving, setMoving]                 = useState<string | null>(null);

  const funilMap = Object.fromEntries(funis.map(f => [f.id, f]));

  const filtered = testes.filter(t => {
    if (filterFunil !== 'todos' && t.funil_id !== filterFunil) return false;
    if (filterCategoria !== 'todos' && t.categoria !== filterCategoria) return false;
    if (filterTipo !== 'todos' && t.tipo !== filterTipo) return false;
    return true;
  });

  async function moveCard(teste: TesteFunil, dir: 1 | -1) {
    const idx = PIPELINE_ORDER.indexOf(teste.pipeline_status ?? 'planejado');
    const next = PIPELINE_ORDER[idx + dir];
    if (!next) return;
    setMoving(teste.id);
    const { error } = await supabase
      .from('testes_funis')
      .update({ pipeline_status: next })
      .eq('id', teste.id);
    setMoving(null);
    if (error) toast({ title: 'Erro ao mover', description: error.message, variant: 'destructive' });
    else onReload();
  }

  function openNew(status: PipelineStatus = 'planejado', funilId = '') {
    setEditTeste(null);
    setPresetStatus(status);
    setPresetFunilId(funilId);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function openEdit(t: TesteFunil, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTeste(t);
    setPresetFunilId('');
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  const totalAtivos = testes.filter(t => t.pipeline_status !== 'concluido').length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterFunil} onValueChange={setFilterFunil}>
          <SelectTrigger className="h-9 text-sm w-48">
            <SelectValue placeholder="Funil" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os funis</SelectItem>
            {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterCategoria} onValueChange={setFilterCategoria}>
          <SelectTrigger className="h-9 text-sm w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as categorias</SelectItem>
            {(Object.entries(CATEGORIA_CFG) as [CategoriaTest, typeof CATEGORIA_CFG[CategoriaTest]][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterTipo} onValueChange={v => setFilterTipo(v as TipoFilter)}>
          <SelectTrigger className="h-9 text-sm w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="ab_interno">A/B interno</SelectItem>
            <SelectItem value="funil_novo">Funil novo</SelectItem>
            <SelectItem value="ad">AD</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {totalAtivos} em andamento · {testes.filter(t => t.pipeline_status === 'concluido').length} concluídos
        </span>

        <div className="flex-1" />

        <Button size="sm" className="h-9 gap-1.5" onClick={() => openNew()}>
          <Plus className="h-3.5 w-3.5" />
          Novo teste
        </Button>
      </div>

      {/* Kanban board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {COLUMNS.map((col, colIdx) => {
          const cards = filtered.filter(t => (t.pipeline_status ?? 'planejado') === col.key);
          const ColIcon = col.Icon;

          return (
            <div
              key={col.key}
              className={cn('rounded-xl border p-3 space-y-2 min-h-[200px]', col.borderCls, col.bgCls)}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3">
                <ColIcon className={cn('h-3.5 w-3.5 shrink-0', col.headerCls)} />
                <span className={cn('text-xs font-semibold uppercase tracking-wider', col.headerCls)}>
                  {col.label}
                </span>
                <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              {cards.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-muted-foreground/50">
                  Nenhum teste aqui
                </div>
              ) : (
                cards.map(t => {
                  const funil = t.funil_id ? funilMap[t.funil_id] : null;
                  const score = iceScore(t.impacto, t.dificuldade);
                  const catCfg = t.categoria ? CATEGORIA_CFG[t.categoria] : null;
                  const isMoving = moving === t.id;
                  const canGoBack = colIdx > 0;
                  const canGoNext = colIdx < COLUMNS.length - 1;

                  return (
                    <div
                      key={t.id}
                      className="bg-card border border-border/70 rounded-lg p-3 space-y-2 hover:border-border transition-colors"
                    >
                      {/* Top row: badges */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {t.tipo === 'ad' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-sky-500/15 text-sky-400 border-sky-500/30">
                            AD
                          </span>
                        )}
                        {catCfg && t.tipo !== 'ad' && (
                          <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', catCfg.cls)}>
                            {catCfg.label}
                          </span>
                        )}
                        <IceBadge score={score} />
                        {t.link_ad && (
                          <a
                            href={t.link_ad}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="ml-auto text-muted-foreground hover:text-primary"
                            title="Ver anúncio"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>

                      {/* Title */}
                      <p className="text-sm font-medium leading-snug line-clamp-2">{t.titulo}</p>

                      {/* Funil + KPI */}
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {funil && <span className="truncate">{funil.nome}</span>}
                        {t.kpi && (
                          <>
                            <span className="shrink-0">·</span>
                            <span className="shrink-0 font-medium text-foreground/70">{t.kpi}</span>
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 pt-0.5 border-t border-border/50">
                        <button
                          type="button"
                          disabled={!canGoBack || isMoving}
                          onClick={() => moveCard(t, -1)}
                          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Voltar etapa"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          disabled={!canGoNext || isMoving}
                          onClick={() => moveCard(t, 1)}
                          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title="Avançar etapa"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>

                        <div className="flex-1" />

                        <button
                          type="button"
                          onClick={e => openEdit(t, e)}
                          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                          title="Editar"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Add button at column bottom */}
              <button
                type="button"
                onClick={() => openNew(col.key)}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md border border-dashed border-border/50 text-[11px] text-muted-foreground/60 hover:text-muted-foreground hover:border-border transition-colors"
              >
                <Plus className="h-3 w-3" />
                Adicionar
              </button>
            </div>
          );
        })}
      </div>

      <TesteModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); onReload(); }}
        teste={editTeste}
        funis={funis}
        presetFunilId={presetFunilId}
        presetPipelineStatus={presetStatus}
      />
    </div>
  );
}
