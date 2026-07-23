import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
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
  const [filtroTipo, setFiltroTipo]   = useState('');
  const [filtroFase, setFiltroFase]   = useState('');
  const [filtroResp, setFiltroResp]   = useState('');
  const [filtroAval, setFiltroAval]   = useState('');

  const loadAux = useCallback(async () => {
    const [{ data: ps }, { data: perf }, { data: fs }, { data: op }] = await Promise.all([
      supabase.from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').order('nome'),
      supabase.from('funis').select('id,nome,produto,ativo').neq('ativo', false).order('nome'),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'avaliacao').order('ordem'),
    ]);
    setProjetos(ps ?? []);
    setPerfis((perf ?? []) as Perfil[]);
    setFunis((fs ?? []) as Funil[]);
    if (op && op.length > 0) setOpAvaliacao(op.map(d => d.valor as string));
    else setOpAvaliacao(['Sem dados', 'Validado', 'Não validado']);
  }, []);

  const loadCriativos = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('producoes')
      .select('id,nome,tipo,fase,avaliacao,projeto_id,funil_id,funil_video,responsavel:perfis!responsavel_id(nome),funil:funis!funil_id(nome)')
      .order('nome');

    if (filtroTipo) q = q.eq('tipo', filtroTipo);
    if (filtroFase) q = q.eq('fase', filtroFase);
    if (filtroResp) q = q.eq('responsavel_id', filtroResp);
    if (filtroAval) q = q.eq('avaliacao', filtroAval);

    const { data } = await q;
    setCriativos((data ?? []) as CriativoRow[]);
    setLoading(false);
  }, [filtroTipo, filtroFase, filtroResp, filtroAval]);

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
    })).filter(s => s.items.length > 0),
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

        <Select value={filtroAval || '_'} onValueChange={v => setFiltroAval(v === '_' ? '' : v)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Avaliação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Todas</SelectItem>
            {opAvaliacao.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
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
