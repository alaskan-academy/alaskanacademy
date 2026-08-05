import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Plus, Pencil, CheckCircle2, Clock, FlaskConical } from 'lucide-react';
import { TesteModal } from './TesteModal';
import { TesteFunil, Funil, Projeto } from '../types';

interface Props {
  testes: TesteFunil[];
  funis: Funil[];
  projetos: Projeto[];
  onReload: () => void;
}

const TIPO_CONFIG = {
  funil_novo: { label: 'Funil novo',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ab_interno: { label: 'A/B interno', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
};

const VENCEDOR_LABEL: Record<string, string> = {
  a:            'Variante A',
  b:            'Variante B',
  inconclusivo: 'Inconclusivo',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function TestesTab({ testes, funis, projetos, onReload }: Props) {
  const [filterFunil, setFilterFunil] = useState('todos');
  const [filterTipo, setFilterTipo]   = useState('todos');
  const [filterStatus, setFilterStatus] = useState('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTeste, setEditTeste] = useState<TesteFunil | null>(null);
  const [modalKey, setModalKey] = useState(0);

  const funilMap = Object.fromEntries(funis.map(f => [f.id, f]));
  const projetoMap = Object.fromEntries(projetos.map(p => [p.id, p]));

  const filtered = testes.filter(t => {
    if (filterFunil !== 'todos' && t.funil_id !== filterFunil) return false;
    if (filterTipo !== 'todos' && t.tipo !== filterTipo) return false;
    if (filterStatus === 'andamento' && t.data_fim) return false;
    if (filterStatus === 'concluido' && !t.data_fim) return false;
    return true;
  });

  // Sort: em andamento first, then by created_at desc
  const sorted = [...filtered].sort((a, b) => {
    const aAtivo = !a.data_fim;
    const bAtivo = !b.data_fim;
    if (aAtivo && !bAtivo) return -1;
    if (!aAtivo && bAtivo) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  function openNew() {
    setEditTeste(null);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function openEdit(t: TesteFunil, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTeste(t);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  const emAndamentoCount = testes.filter(t => !t.data_fim).length;

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
            {funis.map(f => (
              <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="h-9 text-sm w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="funil_novo">Funil novo</SelectItem>
            <SelectItem value="ab_interno">A/B interno</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-9 text-sm w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="andamento">Em andamento</SelectItem>
            <SelectItem value="concluido">Concluídos</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {sorted.length} teste{sorted.length !== 1 ? 's' : ''}
          {emAndamentoCount > 0 && ` · ${emAndamentoCount} em andamento`}
        </span>
        <div className="flex-1" />
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          Registrar teste
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Nenhum teste encontrado.</div>
      ) : (
        <div className="space-y-3">
          {sorted.map(t => {
            const funil = funilMap[t.funil_id];
            const projeto = funil?.oferta_id ? projetoMap[funil.oferta_id] : null;
            const emAndamento = !t.data_fim;
            const tipoCfg = TIPO_CONFIG[t.tipo];

            return (
              <div
                key={t.id}
                className={cn(
                  'rounded-lg border bg-card p-4 space-y-3',
                  emAndamento ? 'border-amber-500/40' : 'border-border',
                )}
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge className={cn('text-[10px] border-0 font-medium', tipoCfg.cls)}>
                        <FlaskConical className="h-2.5 w-2.5 mr-1" />
                        {tipoCfg.label}
                      </Badge>
                      {emAndamento ? (
                        <Badge className="text-[10px] border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          <Clock className="h-2.5 w-2.5 mr-1" />
                          Em andamento
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] border-0 bg-muted text-muted-foreground">
                          Concluído
                        </Badge>
                      )}
                      {t.validado && (
                        <Badge className="text-[10px] border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                          Validado
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground">{t.titulo}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                      {funil && <span>{funil.nome}</span>}
                      {projeto && <><span>·</span><span>{projeto.nome}</span></>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={e => openEdit(t, e)}
                    className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Variantes */}
                {(t.variante_a || t.variante_b) && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className={cn(
                      'rounded p-2.5 border text-xs',
                      t.vencedor === 'a'
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'border-border bg-muted/30',
                    )}>
                      <p className="font-semibold text-muted-foreground mb-1">Variante A {t.vencedor === 'a' && '🏆'}</p>
                      <p className="text-foreground leading-snug">{t.variante_a ?? '—'}</p>
                      {t.resultado_a && (
                        <p className="mt-1 font-mono font-medium text-foreground">{t.resultado_a}</p>
                      )}
                    </div>
                    <div className={cn(
                      'rounded p-2.5 border text-xs',
                      t.vencedor === 'b'
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'border-border bg-muted/30',
                    )}>
                      <p className="font-semibold text-muted-foreground mb-1">Variante B {t.vencedor === 'b' && '🏆'}</p>
                      <p className="text-foreground leading-snug">{t.variante_b ?? '—'}</p>
                      {t.resultado_b && (
                        <p className="mt-1 font-mono font-medium text-foreground">{t.resultado_b}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border/60">
                  {t.metrica && <span>Métrica: <span className="text-foreground">{t.metrica}</span></span>}
                  {t.vencedor && t.vencedor !== 'inconclusivo' && (
                    <span>Vencedor: <span className="text-emerald-400 font-medium">{VENCEDOR_LABEL[t.vencedor]}</span></span>
                  )}
                  {t.vencedor === 'inconclusivo' && (
                    <span className="text-muted-foreground">Inconclusivo</span>
                  )}
                  <div className="flex-1" />
                  <span>
                    {fmtDate(t.data_inicio)}
                    {t.data_fim && ` → ${fmtDate(t.data_fim)}`}
                    {emAndamento && !t.data_inicio && 'Sem data'}
                  </span>
                </div>

                {t.notas && (
                  <p className="text-xs text-muted-foreground italic border-t border-border/60 pt-2">{t.notas}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <TesteModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); onReload(); }}
        teste={editTeste}
        funis={funis}
      />
    </div>
  );
}
