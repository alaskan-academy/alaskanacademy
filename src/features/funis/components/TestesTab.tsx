import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Plus, Pencil, ChevronLeft, ChevronRight, ExternalLink, FlaskConical } from 'lucide-react';
import { TesteModal } from './TesteModal';
import { TesteFunil, Funil, Projeto, PerfilSimples } from '../types';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

interface Props {
  testes: TesteFunil[];
  funis: Funil[];
  projetos: Projeto[];
  perfis: PerfilSimples[];
  onReload: () => void;
}

const TIPO_CONFIG = {
  funil_novo: { label: 'Funil novo',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ab_interno: { label: 'A/B interno', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  ad:         { label: 'AD',          cls: 'bg-sky-500/15 text-sky-400' },
};

function diasRodando(d: string | null) {
  if (!d) return null;
  const diff = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86_400_000);
  if (diff === 0) return 'iniciou hoje';
  if (diff === 1) return '1 dia rodando';
  return `${diff} dias rodando`;
}

export function TestesTab({ testes, funis, projetos, perfis, onReload }: Props) {
  const perfilMap = Object.fromEntries(perfis.map(p => [p.id, p.nome]));
  const funilMap  = Object.fromEntries(funis.map(f => [f.id, f]));

  const [filterFunil, setFilterFunil] = useState('todos');
  const [filterTipo, setFilterTipo]   = useState('todos');
  const [modalOpen, setModalOpen]     = useState(false);
  const [editTeste, setEditTeste]     = useState<TesteFunil | null>(null);
  const [modalKey, setModalKey]       = useState(0);
  const [moving, setMoving]           = useState<string | null>(null);

  const rodando = testes
    .filter(t => t.pipeline_status === 'rodando')
    .filter(t => filterFunil === 'todos' || t.funil_id === filterFunil)
    .filter(t => filterTipo  === 'todos' || t.tipo     === filterTipo)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  async function mover(t: TesteFunil, status: 'produzindo' | 'concluido') {
    setMoving(t.id);
    const { error } = await supabase
      .from('testes_funis')
      .update({ pipeline_status: status })
      .eq('id', t.id);
    setMoving(null);
    if (error) toast({ title: 'Erro ao mover', description: error.message, variant: 'destructive' });
    else onReload();
  }

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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterFunil} onValueChange={setFilterFunil}>
          <SelectTrigger className="h-9 text-sm w-48"><SelectValue placeholder="Funil" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os funis</SelectItem>
            {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="h-9 text-sm w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="funil_novo">Funil novo</SelectItem>
            <SelectItem value="ab_interno">A/B interno</SelectItem>
            <SelectItem value="ad">AD</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {rodando.length} rodando
        </span>
        <div className="flex-1" />
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          Novo teste
        </Button>
      </div>

      {rodando.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Nenhum teste rodando no momento.
        </div>
      ) : (
        <div className="space-y-2">
          {rodando.map(t => {
            const funil   = t.funil_id ? funilMap[t.funil_id] : null;
            const tipoCfg = TIPO_CONFIG[t.tipo];
            const isMoving = moving === t.id;

            return (
              <div
                key={t.id}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-3"
              >
                {/* Tipo badge */}
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0', tipoCfg.cls)}>
                  <FlaskConical className="h-2.5 w-2.5 inline mr-0.5" />
                  {tipoCfg.label}
                </span>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.titulo}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    {funil && <span className="truncate">{funil.nome}</span>}
                    {t.data_inicio && (
                      <>
                        <span>·</span>
                        <span>{diasRodando(t.data_inicio)}</span>
                      </>
                    )}
                    {t.criado_por && perfilMap[t.criado_por] && (
                      <>
                        <span>·</span>
                        <span>{perfilMap[t.criado_por]}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* AD link */}
                {t.link_ad && (
                  <a
                    href={t.link_ad}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-muted-foreground hover:text-primary shrink-0"
                    title="Ver anúncio"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={isMoving}
                    onClick={() => mover(t, 'produzindo')}
                    className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    title="Voltar para Produzindo"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={isMoving}
                    onClick={() => mover(t, 'concluido')}
                    className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    title="Mover para Concluído"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={e => openEdit(t, e)}
                    className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                    title="Editar"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
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
        presetPipelineStatus="rodando"
      />
    </div>
  );
}
