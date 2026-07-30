import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { MultiFilter } from './MultiFilter';
import { supabase } from '@/lib/supabase';
import { fetchFunis, fetchPerfis, fetchProjetos } from '@/lib/dataCache';
import { cn } from '@/lib/utils';
import { FASES_MAP, FASES } from './constants';
import { CriativoDrawer } from './CriativoDrawer';
import type { ProducaoNivel, Perfil, Funil } from './types';

interface CriativoRow {
  id: string;
  nome: string;
  tipo: string;
  fase: string;
  avaliacao: string | null;
  projeto_id: string | null;
  funil_ids: string[];
  funil_video: string | null;
  responsavel: { nome: string } | null;
}

interface Projeto {
  id: string;
  nome: string;
}

interface Props {
  nivel: ProducaoNivel;
  userId: string;
}

export function PorProjetoView({ nivel, userId }: Props) {
  const [projetos, setProjetos]   = useState<Projeto[]>([]);
  const [criativos, setCriativos] = useState<CriativoRow[]>([]);
  const [perfis, setPerfis]       = useState<Perfil[]>([]);
  const [funis, setFunis]         = useState<Funil[]>([]);
  const [opAvaliacao, setOpAvaliacao] = useState<string[]>([]);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [busca, setBusca]             = useState('');
  const [filtroTipo, setFiltroTipo]   = useState<string[]>([]);
  const [filtroFase, setFiltroFase]   = useState<string[]>([]);
  const [filtroResp, setFiltroResp]   = useState<string[]>([]);
  const [filtroAval, setFiltroAval]   = useState<string[]>([]);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const loadAux = useCallback(async () => {
    const [ps, perf, fs, { data: op }] = await Promise.all([
      fetchProjetos(),
      fetchPerfis(),
      fetchFunis(),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'avaliacao').order('ordem'),
    ]);
    setProjetos(ps);
    setPerfis(perf as Perfil[]);
    setFunis(fs as Funil[]);
    if (op && op.length > 0) setOpAvaliacao(op.map(d => d.valor as string));
    else setOpAvaliacao(['Sem dados', 'Validado', 'Não validado']);
  }, []);

  const loadCriativos = useCallback(async () => {
    setLoading(true);
    const PAGE = 1000;
    let all: CriativoRow[] = [];
    let from = 0;
    while (true) {
      let q = supabase
        .from('producoes')
        .select('id,nome,tipo,fase,avaliacao,projeto_id,funil_ids,funil_video,responsavel:perfis!responsavel_id(nome)')
        .order('nome')
        .range(from, from + PAGE - 1);
      if (!mostrarInativos) q = q.not('fase', 'in', '(arquivado,bloqueado)');
      if (filtroTipo.length) q = q.in('tipo', filtroTipo);
      if (filtroFase.length) q = q.in('fase', filtroFase);
      if (filtroResp.length) q = q.in('responsavel_id', filtroResp);
      if (filtroAval.length) q = q.in('avaliacao', filtroAval);
      const { data } = await q;
      if (!data || data.length === 0) break;
      all = all.concat(data as CriativoRow[]);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setCriativos(all);
    setLoading(false);
  }, [filtroTipo, filtroFase, filtroResp, filtroAval, mostrarInativos]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const buscaLower = busca.toLowerCase();
  const filtered = buscaLower
    ? criativos.filter(c => c.nome.toLowerCase().includes(buscaLower))
    : criativos;

  const semProjeto = filtered.filter(c => !c.projeto_id);

  const sections: { key: string; label: string; items: CriativoRow[] }[] = [
    ...projetos.map(p => ({
      key:   p.id,
      label: p.nome,
      items: filtered.filter(c => c.projeto_id === p.id),
    })),
    ...(semProjeto.length > 0 ? [{ key: '__sem_projeto__', label: 'Sem projeto', items: semProjeto }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="h-8 pl-8 w-44 text-xs"
          />
        </div>

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
        <MultiFilter
          label="Fase"
          options={FASES.map(f => ({ id: f.key, nome: f.label }))}
          value={filtroFase}
          onChange={setFiltroFase}
          width="w-36"
        />
        <MultiFilter
          label="Responsável"
          options={perfis.map(p => ({ id: p.id, nome: p.nome }))}
          value={filtroResp}
          onChange={setFiltroResp}
          width="w-40"
        />
        <MultiFilter
          label="Avaliação"
          options={opAvaliacao.map(a => ({ id: a, nome: a }))}
          value={filtroAval}
          onChange={setFiltroAval}
          width="w-36"
        />

        <button
          onClick={() => setMostrarInativos(v => !v)}
          className={cn(
            'h-8 px-3 rounded-md border text-xs transition-colors',
            mostrarInativos
              ? 'bg-muted border-border text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          {mostrarInativos ? 'Ocultar arquivados' : 'Ver arquivados'}
        </button>
      </div>

      {/* Sections */}
      {loading && criativos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : sections.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nenhum item encontrado.</p>
      ) : (
        <div className="space-y-2">
          {sections.map(section => {
            const isExpanded = expanded === section.key;
            return (
              <div key={section.key} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : section.key)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown  className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="text-sm font-medium text-foreground flex-1">{section.label}</span>
                  <span className="text-xs text-muted-foreground">{section.items.length} item{section.items.length !== 1 ? 's' : ''}</span>
                </button>

                {isExpanded && (
                  <div className="border-t border-border">
                    {section.items.length === 0 && (
                      <p className="text-xs text-muted-foreground py-3 px-4 italic">Nenhum item vinculado a este projeto.</p>
                    )}
                    {section.items.map(c => {
                      const funisNomes = funis.filter(f => (c.funil_ids ?? []).includes(f.id)).map(f => f.nome);
                      const funil = funisNomes.length > 0 ? funisNomes.join(', ') : (c.funil_video ?? null);
                      return (
                        <button
                          key={c.id}
                          onClick={() => setSelectedId(c.id)}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2 border-b border-border/30 last:border-0 text-left',
                            'hover:bg-muted/30 active:bg-muted/50 transition-colors cursor-pointer',
                          )}
                        >
                          <span className="flex-1 text-sm text-foreground truncate">{c.nome}</span>
                          {c.avaliacao && (
                            <span className="text-[11px] text-muted-foreground/70 shrink-0">{c.avaliacao}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground shrink-0">{FASES_MAP[c.fase] ?? c.fase}</span>
                          {funil && (
                            <span className="text-[11px] text-muted-foreground/70 shrink-0 truncate max-w-[120px]">{funil}</span>
                          )}
                          {c.responsavel && (
                            <span className="text-[11px] text-muted-foreground/70 shrink-0">{c.responsavel.nome}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
    </div>
  );
}
