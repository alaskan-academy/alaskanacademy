import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { FASES_MAP, FASES } from './constants';
import type { ProducaoNivel, Perfil } from './types';

interface CriativoRow {
  id: string;
  nome: string;
  tipo: string;
  fase: string;
  projeto_id: string | null;
  funil_id: string | null;
  funil_video: string | null;
  responsavel: { nome: string } | null;
  funil: { nome: string } | null;
}

interface Projeto {
  id: string;
  nome: string;
}

interface Props {
  nivel: ProducaoNivel;
}

export function PorProjetoView({ nivel: _nivel }: Props) {
  const [projetos, setProjetos]   = useState<Projeto[]>([]);
  const [criativos, setCriativos] = useState<CriativoRow[]>([]);
  const [perfis, setPerfis]       = useState<Perfil[]>([]);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroFase, setFiltroFase] = useState('');
  const [filtroResp, setFiltroResp] = useState('');

  const loadAux = useCallback(async () => {
    const [{ data: ps }, { data: perf }] = await Promise.all([
      supabase.from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').order('nome'),
    ]);
    setProjetos(ps ?? []);
    setPerfis(perf ?? []);
  }, []);

  const loadCriativos = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('criativos')
      .select('id,nome,tipo,fase,projeto_id,funil_id,funil_video,responsavel:perfis!responsavel_id(nome),funil:funis!funil_id(nome)')
      .order('nome');

    if (filtroTipo) q = q.eq('tipo', filtroTipo);
    if (filtroFase) q = q.eq('fase', filtroFase);
    if (filtroResp) q = q.eq('responsavel_id', filtroResp);

    const { data } = await q;
    setCriativos((data ?? []) as CriativoRow[]);
    setLoading(false);
  }, [filtroTipo, filtroFase, filtroResp]);

  useEffect(() => { loadAux(); }, [loadAux]);
  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const semProjeto = criativos.filter(c => !c.projeto_id);

  const sections: { key: string; label: string; items: CriativoRow[] }[] = [
    ...projetos.map(p => ({
      key:   p.id,
      label: p.nome,
      items: criativos.filter(c => c.projeto_id === p.id),
    })).filter(s => s.items.length > 0),
    ...(semProjeto.length > 0 ? [{ key: '__sem_projeto__', label: 'Sem projeto', items: semProjeto }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filtroTipo || '_'} onValueChange={v => setFiltroTipo(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todos</SelectItem>
            <SelectItem value="criativo">Criativo</SelectItem>
            <SelectItem value="vsl">VSL</SelectItem>
            <SelectItem value="aula">Aula</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filtroFase || '_'} onValueChange={v => setFiltroFase(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Fase" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todas as fases</SelectItem>
            {FASES.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filtroResp || '_'} onValueChange={v => setFiltroResp(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todos</SelectItem>
            {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Sections */}
      {loading ? (
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
                    {section.items.map(c => {
                      const funil = c.funil?.nome ?? c.funil_video ?? null;
                      return (
                        <div
                          key={c.id}
                          className={cn(
                            'flex items-center gap-3 px-4 py-2 border-b border-border/30 last:border-0',
                            'hover:bg-muted/20 transition-colors',
                          )}
                        >
                          <span className="flex-1 text-sm text-foreground truncate">{c.nome}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0">{FASES_MAP[c.fase] ?? c.fase}</span>
                          {funil && (
                            <span className="text-[11px] text-muted-foreground/70 shrink-0 truncate max-w-[120px]">{funil}</span>
                          )}
                          {c.responsavel && (
                            <span className="text-[11px] text-muted-foreground/70 shrink-0">{c.responsavel.nome}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
