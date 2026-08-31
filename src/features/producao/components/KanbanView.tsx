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
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { Plus, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES, FASES_POR_TIPO, canMoveFaseOut } from './constants';
import { CriativoCard } from './CriativoCard';
import { CriativoDrawer } from './CriativoDrawer';
import { CriativoFormModal } from './CriativoFormModal';
import { MultiFilter } from './MultiFilter';

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
  const [filtroProjeto, setFiltroProjeto] = useState<string[]>([]);
  const [filtroTipo, setFiltroTipo]       = useState<string[]>([]);
  const [filtroResp, setFiltroResp]       = useState<string[]>([]);
  const [filtroAval, setFiltroAval]       = useState<string[]>([]);
  const [filtroFormato, setFiltroFormato] = useState<string[]>([]);
  const [filtroStatus, setFiltroStatus]   = useState<string[]>([]);
  const [busca, setBusca]                 = useState('');
  const [projetos, setProjetos]           = useState<{ id: string; nome: string }[]>([]);
  const [opAvaliacao, setOpAvaliacao]     = useState<string[]>([]);
  const [opFormato, setOpFormato]         = useState<string[]>([]);
  const [opStatus, setOpStatus]           = useState<string[]>([]);
  const [activeId, setActiveId]           = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const loadAux = useCallback(async () => {
    const [{ data: fs }, { data: ps }, { data: pr }, { data: opA }, { data: opF }, { data: opS }] = await Promise.all([
      supabase.from('funis').select('id,nome,produto,ativo').neq('ativo', false).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').eq('ativo', true).order('nome'),
      supabase.from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome'),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'avaliacao').order('ordem'),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'formato').order('ordem'),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'status_veiculacao').order('ordem'),
    ]);
    setFunis(fs ?? []);
    setPerfis(ps ?? []);
    setProjetos(pr ?? []);
    if (opA?.length) setOpAvaliacao(opA.map(d => d.valor as string));
    if (opF?.length) setOpFormato(opF.map(d => d.valor as string));
    if (opS?.length) setOpStatus(opS.map(d => d.valor as string));
  }, []);

  const projetosDaEmpresa = useProjetosDaEmpresa();

  const loadCriativos = useCallback(async () => {
    /* undefined = ainda nao sei de quem sao os projetos; consultar agora
       mostraria as duas empresas por um instante. */
    if (projetosDaEmpresa === undefined) return;
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
      .select('*, funil:funis(id,nome,produto), projeto:ofertas_editores!projeto_id(id,nome), responsavel:perfis!responsavel_id(id,nome), especialista:perfis!especialista_id(id,nome)')
      .order('data_prazo', { ascending: false, nullsFirst: false });

    if (responsavelFilter?.length) q = q.in('responsavel_id', responsavelFilter);
    /* Os dois convivem: a empresa restringe o universo, o filtro de projeto
       escolhe dentro dele. Dois `in` sobre a mesma coluna e intersecao. */
    if (projetosDaEmpresa) q = q.in('projeto_id', projetosDaEmpresa);
    if (filtroProjeto.length) q = q.in('projeto_id', filtroProjeto);
    if (filtroTipo.length)    q = q.in('tipo', filtroTipo);
    if (filtroResp.length)    q = q.in('responsavel_id', filtroResp);
    if (filtroAval.length)    q = q.in('avaliacao', filtroAval);
    if (filtroFormato.length) q = q.in('formato', filtroFormato);
    if (filtroStatus.length)  q = q.in('status_veiculacao', filtroStatus);

    const { data } = await q;
    setCriativos(data ?? []);
    setLoading(false);
  }, [nivel, setorId, userId, fixedResponsavelId, filtroProjeto, filtroTipo, filtroResp, filtroAval, filtroFormato, filtroStatus, projetosDaEmpresa]);

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

    // Valida link de vídeo editado ao sair da edição
    if (criativo.fase === 'edicao' && novaFase === 'revisao_edicao' && !criativo.video_editado_url) {
      toast({ title: 'Adicione o link do vídeo editado antes de enviar para revisão', variant: 'destructive' });
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

    /*
      Arrastar para "alteração" avisa o responsável — pelo gatilho em
      `producoes`, e não daqui. Uma regra escrita em três lugares nunca
      permaneceu igual nos três, e é por isso que ninguém sabia dizer se este
      aviso funcionava (nunca disparou uma vez sequer).
    */
  }, [criativos, nivel, userId, toast]);

  const activeCriativo = activeId ? criativos.find(c => c.id === activeId) : null;
  const buscaLower = busca.toLowerCase();
  const displayCriativos = buscaLower
    ? criativos.filter(c => c.nome.toLowerCase().includes(buscaLower))
    : criativos;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="h-8 pl-8 w-44 text-xs"
          />
        </div>
        {!fixedResponsavelId && (
          <>
            <MultiFilter
              label="Todos os projetos"
              options={projetos}
              value={filtroProjeto}
              onChange={setFiltroProjeto}
              width="w-44"
            />
            <MultiFilter
              label="Tipo"
              options={[
                { id: 'criativo', nome: 'Criativo' },
                { id: 'vsl',      nome: 'VSL' },
                { id: 'aula',     nome: 'Aula' },
              ]}
              value={filtroTipo}
              onChange={setFiltroTipo}
              width="w-32"
            />
            {nivel !== 'membro' && (
              <MultiFilter
                label="Responsável"
                options={perfis.map(p => ({ id: p.id, nome: p.nome }))}
                value={filtroResp}
                onChange={setFiltroResp}
                width="w-40"
              />
            )}
          </>
        )}
        {opAvaliacao.length > 0 && (
          <MultiFilter
            label="Avaliação"
            options={opAvaliacao.map(a => ({ id: a, nome: a }))}
            value={filtroAval}
            onChange={setFiltroAval}
            width="w-36"
          />
        )}
        {opFormato.length > 0 && (
          <MultiFilter
            label="Formato"
            options={opFormato.map(a => ({ id: a, nome: a }))}
            value={filtroFormato}
            onChange={setFiltroFormato}
            width="w-36"
          />
        )}
        {opStatus.length > 0 && (
          <MultiFilter
            label="Status"
            options={opStatus.map(a => ({ id: a, nome: a }))}
            value={filtroStatus}
            onChange={setFiltroStatus}
            width="w-36"
          />
        )}
        <div className="flex-1" />
        <Button size="sm" className="h-8" onClick={() => setShowModal(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Novo
        </Button>
      </div>

      {/* Board */}
      {loading && criativos.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />Carregando...
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto -mx-4 px-4 pb-1">
            <div className="flex gap-3 pb-4" style={{ minWidth: 'max-content' }}>
              {FASES.filter(f => !f.somente_socio || nivel === 'socio').map(fase => {
                const cards = displayCriativos.filter(c => c.fase === fase.key);
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
