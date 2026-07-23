import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES, FASES_POR_TIPO, canMoveFaseOut } from './constants';
import { CriativoCard } from './CriativoCard';
import { CriativoDrawer } from './CriativoDrawer';
import { CriativoFormModal } from './CriativoFormModal';

// ---------- sub-components ----------

function DraggableCard({ criativo, onClick }: { criativo: Criativo; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: criativo.id,
    data: { criativo },
  });

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: CSS.Transform.toString(transform) } : undefined}
      {...attributes}
      {...listeners}
      className={cn('touch-none select-none', isDragging && 'opacity-40')}
    >
      <CriativoCard criativo={criativo} onClick={onClick} />
    </div>
  );
}

function DroppableColumn({ faseKey, children }: { faseKey: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: faseKey });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'space-y-2 min-h-[60px] rounded-md transition-colors duration-150',
        isOver && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
      )}
    >
      {children}
    </div>
  );
}

// ---------- main component ----------

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  fixedResponsavelId?: string;
}

export function KanbanView({ nivel, setorId, userId, fixedResponsavelId }: Props) {
  const { toast } = useToast();
  const [criativos, setCriativos]         = useState<Criativo[]>([]);
  const [funis, setFunis]                 = useState<Funil[]>([]);
  const [perfis, setPerfis]               = useState<Perfil[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [showModal, setShowModal]         = useState(false);
  const [filtroProjeto, setFiltroProjeto] = useState('');
  const [filtroTipo, setFiltroTipo]       = useState('');
  const [filtroResp, setFiltroResp]       = useState('');
  const [projetos, setProjetos]           = useState<{ id: string; nome: string }[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const loadAux = useCallback(async () => {
    const [{ data: fs }, { data: ps }, { data: pr }] = await Promise.all([
      supabase.from('funis').select('id,nome,produto,ativo').neq('ativo', false).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').eq('ativo', true).order('nome'),
      supabase.from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome'),
    ]);
    setFunis(fs ?? []);
    setPerfis(ps ?? []);
    setProjetos(pr ?? []);
  }, []);

  const loadCriativos = useCallback(async () => {
    setLoading(true);

    let responsavelFilter: string[] | null = null;

    if (fixedResponsavelId) {
      responsavelFilter = [fixedResponsavelId];
    } else if (nivel === 'socio') {
      responsavelFilter = null;
    } else if (setorId) {
      const { data: sp } = await supabase
        .from('perfis').select('id').eq('setor_id', setorId);
      responsavelFilter = sp?.map(p => p.id) ?? [userId];
      if (!responsavelFilter.includes(userId)) responsavelFilter.push(userId);
    } else {
      responsavelFilter = [userId];
    }

    let q = supabase
      .from('producoes')
      .select('*, funil:funis(id,nome,produto), projeto:ofertas_editores!projeto_id(id,nome), responsavel:perfis!responsavel_id(id,nome)')
      .order('data_prazo', { ascending: false, nullsFirst: false });

    if (responsavelFilter?.length) q = q.in('responsavel_id', responsavelFilter);
    if (filtroProjeto) q = q.eq('projeto_id', filtroProjeto);
    if (filtroTipo)    q = q.eq('tipo', filtroTipo);
    if (filtroResp)    q = q.eq('responsavel_id', filtroResp);

    const { data } = await q;
    setCriativos(data ?? []);
    setLoading(false);
  }, [nivel, setorId, userId, fixedResponsavelId, filtroProjeto, filtroTipo, filtroResp]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const criativoId = active.id as string;
    const novaFase   = over.id as string;

    const criativo = criativos.find(c => c.id === criativoId);
    if (!criativo || criativo.fase === novaFase) return;

    // Valida fase para o tipo
    const validFases = FASES_POR_TIPO[criativo.tipo];
    if (validFases && !validFases.includes(novaFase)) {
      toast({ title: `Fase inválida para este tipo de criativo`, variant: 'destructive' });
      return;
    }

    // Valida permissão para sair da fase atual
    if (!canMoveFaseOut(criativo.fase, nivel)) {
      toast({ title: 'Esta fase requer aprovação de um administrador', variant: 'destructive' });
      return;
    }

    // Atualização otimista
    setCriativos(prev => prev.map(c => c.id === criativoId ? { ...c, fase: novaFase } : c));

    const { error } = await supabase
      .from('producoes')
      .update({ fase: novaFase })
      .eq('id', criativoId);

    if (error) {
      toast({ title: 'Erro ao mover card', variant: 'destructive' });
      setCriativos(prev => prev.map(c => c.id === criativoId ? { ...c, fase: criativo.fase } : c));
      return;
    }

    await supabase.from('criativo_historico').insert({
      criativo_id:    criativoId,
      usuario_id:     userId,
      tipo_alteracao: 'fase',
      campo_alterado: 'fase',
      valor_anterior: criativo.fase,
      valor_novo:     novaFase,
    });

    if (novaFase === 'aprovado' && criativo.responsavel_id && criativo.responsavel_id !== userId) {
      await supabase.from('notificacoes').insert({
        usuario_id:      criativo.responsavel_id,
        tipo:            'criativo_aprovado',
        mensagem:        `"${criativo.nome}" foi aprovado.`,
        referencia_id:   criativoId,
        referencia_tipo: 'criativo',
      });
    }
  }, [criativos, nivel, userId, toast]);

  const activeCriativo = activeId ? criativos.find(c => c.id === activeId) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {!fixedResponsavelId && (
          <>
            <Select value={filtroProjeto || '_'} onValueChange={v => setFiltroProjeto(v === '_' ? '' : v)}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Todos os projetos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Todos os projetos</SelectItem>
                {projetos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filtroTipo || '_'} onValueChange={v => setFiltroTipo(v === '_' ? '' : v)}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Todos</SelectItem>
                <SelectItem value="criativo">Criativo</SelectItem>
                <SelectItem value="vsl">VSL</SelectItem>
                <SelectItem value="aula">Aula</SelectItem>
              </SelectContent>
            </Select>

            {nivel !== 'membro' && (
              <Select value={filtroResp || '_'} onValueChange={v => setFiltroResp(v === '_' ? '' : v)}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">Todos</SelectItem>
                  {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </>
        )}
        <div className="flex-1" />
        <Button size="sm" className="h-8" onClick={() => setShowModal(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Novo
        </Button>
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />Carregando...
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto -mx-4 px-4 pb-1">
            <div className="flex gap-3 pb-4" style={{ minWidth: 'max-content' }}>
              {FASES.map(fase => {
                const cards = criativos.filter(c => c.fase === fase.key);
                return (
                  <div key={fase.key} className="w-52 flex-none">
                    <div className={cn(
                      'flex items-center justify-between mb-2 px-0.5',
                      fase.revisao ? 'text-amber-400' : 'text-muted-foreground',
                    )}>
                      <span className="text-[11px] font-semibold uppercase tracking-wide truncate">
                        {fase.label}
                      </span>
                      <span className="text-[11px] font-medium ml-1 shrink-0">{cards.length}</span>
                    </div>

                    <DroppableColumn faseKey={fase.key}>
                      {cards.length === 0 ? (
                        <div className="border border-dashed border-border/40 rounded-md h-14 flex items-center justify-center">
                          <span className="text-[10px] text-muted-foreground/30">Vazio</span>
                        </div>
                      ) : (
                        cards.map(c => (
                          <DraggableCard key={c.id} criativo={c} onClick={() => setSelectedId(c.id)} />
                        ))
                      )}
                    </DroppableColumn>
                  </div>
                );
              })}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCriativo && (
              <div className="w-52 rotate-1 shadow-2xl opacity-95 pointer-events-none">
                <CriativoCard criativo={activeCriativo} onClick={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={loadCriativos}
        nivel={nivel}
        userId={userId}
        funis={funis}
        perfis={perfis}
      />

      {showModal && (
        <CriativoFormModal
          open={showModal}
          onClose={() => setShowModal(false)}
          onCreated={loadCriativos}
          userId={userId}
          funis={funis}
          perfis={perfis}
        />
      )}
    </div>
  );
}
