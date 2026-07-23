import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES_MAP, TIPO_COR } from './constants';
import { CriativoDrawer } from './CriativoDrawer';

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  fixedField?: 'responsavel_id' | 'copy_id' | 'gestor_id';
  fixedValue?: string;
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function HojeView({ nivel, setorId: _setorId, userId, fixedField, fixedValue }: Props) {
  const [criativos, setCriativos] = useState<Criativo[]>([]);
  const [funis, setFunis]         = useState<Funil[]>([]);
  const [perfis, setPerfis]       = useState<Perfil[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const today = toYMD(new Date());

  const load = useCallback(async () => {
    setLoading(true);

    const sel = [
      '*',
      'funil:funis(id,nome,produto)',
      'projeto:ofertas_editores!projeto_id(id,nome)',
      'responsavel:perfis!responsavel_id(id,nome)',
    ].join(',');

    const buildQ = () => {
      let q = supabase.from('producoes').select(sel);
      if (fixedField && fixedValue) q = q.eq(fixedField, fixedValue);
      else if (nivel === 'membro') q = q.eq('responsavel_id', userId);
      return q;
    };

    // Tasks due today (single-day and period-end)
    const q1 = buildQ().eq('data_prazo', today);
    // Tasks spanning through today but not ending today
    const q2 = buildQ().lte('data_inicio', today).gt('data_prazo', today);

    const [{ data: d1 }, { data: d2 }, { data: fs }, { data: ps }] = await Promise.all([
      q1,
      q2,
      supabase.from('funis').select('id,nome,produto,ativo').neq('ativo', false).order('nome'),
      supabase.from('perfis').select('id,nome,is_admin').eq('ativo', true).order('nome'),
    ]);

    const seen = new Set<string>();
    const merged: Criativo[] = [];
    for (const c of [...(d1 ?? []), ...(d2 ?? [])]) {
      if (!seen.has(c.id)) { seen.add(c.id); merged.push(c as Criativo); }
    }
    merged.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true, sensitivity: 'base' }));

    setCriativos(merged);
    setFunis(fs ?? []);
    setPerfis(ps ?? []);
    setLoading(false);
  }, [nivel, userId, today, fixedField, fixedValue]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />Carregando...
      </div>
    );
  }

  if (criativos.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Nenhum item para hoje ({today}).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground mb-3">
        {criativos.length} item{criativos.length !== 1 ? 's' : ''} para hoje · {
          new Date(today + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
        }
      </p>

      {criativos.map(c => {
        const fase    = FASES_MAP[c.fase] ?? c.fase;
        const funil   = c.funil?.nome ?? c.funil_video ?? null;
        const projeto = c.projeto?.nome ?? null;
        const editor  = c.responsavel?.nome ?? c.editor_nome_historico;
        const tipoCor = TIPO_COR[c.tipo] ?? 'bg-primary/10 text-primary border-primary/20';
        const isSpan  = c.data_inicio && c.data_prazo && c.data_inicio !== c.data_prazo;
        const isPast  = (c.data_prazo ?? '') < today;
        const isLate  = isPast && c.fase !== 'postado' && c.fase !== 'aprovado';
        const cor     = isLate ? 'bg-red-500/20 text-red-300 border-red-500/30' : tipoCor;

        return (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={cn(
              'w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-md border transition-opacity hover:opacity-75',
              cor,
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{c.nome}</span>
                {isSpan && (
                  <span className="text-[10px] opacity-60 shrink-0">
                    {c.data_inicio} → {c.data_prazo}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] opacity-70 flex-wrap">
                <span>{fase}</span>
                {funil   && <><span className="opacity-40">·</span><span className="truncate">{funil}</span></>}
                {projeto && <><span className="opacity-40">·</span><span className="truncate">{projeto}</span></>}
                {editor  && <><span className="opacity-40">·</span><span className="truncate">{editor}</span></>}
              </div>
            </div>
          </button>
        );
      })}

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={load}
        nivel={nivel}
        userId={userId}
        funis={funis}
        perfis={perfis}
      />
    </div>
  );
}
