import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES } from './constants';
import { CriativoCard } from './CriativoCard';
import { CriativoDrawer } from './CriativoDrawer';
import { CriativoFormModal } from './CriativoFormModal';

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  fixedResponsavelId?: string;
}

export function KanbanView({ nivel, setorId, userId, fixedResponsavelId }: Props) {
  const [criativos, setCriativos]         = useState<Criativo[]>([]);
  const [funis, setFunis]                 = useState<Funil[]>([]);
  const [perfis, setPerfis]               = useState<Perfil[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [showModal, setShowModal]         = useState(false);
  const [filtroFunil, setFiltroFunil]     = useState('');
  const [filtroTipo, setFiltroTipo]       = useState('');
  const [filtroResp, setFiltroResp]       = useState('');

  const loadAux = useCallback(async () => {
    const [{ data: fs }, { data: ps }] = await Promise.all([
      supabase.from('funis').select('id,nome,produto,ativo').eq('ativo', true).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').order('nome'),
    ]);
    setFunis(fs ?? []);
    setPerfis(ps ?? []);
  }, []);

  const loadCriativos = useCallback(async () => {
    setLoading(true);

    let responsavelFilter: string[] | null = null;

    if (fixedResponsavelId) {
      responsavelFilter = [fixedResponsavelId];
    } else if (nivel === 'socio') {
      responsavelFilter = null; // vê tudo
    } else if (setorId) {
      const { data: sp } = await supabase
        .from('perfis').select('id').eq('setor_id', setorId);
      responsavelFilter = sp?.map(p => p.id) ?? [userId];
      if (!responsavelFilter.includes(userId)) responsavelFilter.push(userId);
    } else {
      responsavelFilter = [userId];
    }

    let q = supabase
      .from('criativos')
      .select('*, funil:funis(id,nome,produto), responsavel:perfis!responsavel_id(id,nome)')
      .order('criado_em', { ascending: false });

    if (responsavelFilter?.length) q = q.in('responsavel_id', responsavelFilter);
    if (filtroFunil) q = q.eq('funil_id', filtroFunil);
    if (filtroTipo)  q = q.eq('tipo', filtroTipo);
    if (filtroResp)  q = q.eq('responsavel_id', filtroResp);

    const { data } = await q;
    setCriativos(data ?? []);
    setLoading(false);
  }, [nivel, setorId, userId, fixedResponsavelId, filtroFunil, filtroTipo, filtroResp]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const canCreate = true;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {!fixedResponsavelId && (
          <>
            <Select value={filtroFunil || '_'} onValueChange={v => setFiltroFunil(v === '_' ? '' : v)}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Todos os funis" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Todos os funis</SelectItem>
                {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
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
        {canCreate && (
          <Button size="sm" className="h-8" onClick={() => setShowModal(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Novo
          </Button>
        )}
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />Carregando...
        </div>
      ) : (
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

                  <div className="space-y-2 min-h-[60px]">
                    {cards.length === 0 ? (
                      <div className="border border-dashed border-border/40 rounded-md h-14 flex items-center justify-center">
                        <span className="text-[10px] text-muted-foreground/30">Vazio</span>
                      </div>
                    ) : (
                      cards.map(c => (
                        <CriativoCard key={c.id} criativo={c} onClick={() => setSelectedId(c.id)} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
