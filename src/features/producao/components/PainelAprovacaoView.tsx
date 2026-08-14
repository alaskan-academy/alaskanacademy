import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, CornerDownLeft, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Criativo, ProducaoNivel } from './types';
import { FASES_MAP, getAdjacentFases } from './constants';
import { CriativoDrawer } from './CriativoDrawer';

interface SetorInfo { id: string; nome: string }

interface Props {
  nivel: ProducaoNivel;
  setor: SetorInfo | null;
  userId: string;
}

// Fases que um head de cada setor pode aprovar
const FASES_APROVACAO: Record<string, string[]> = {
  'Editor':             ['revisao_edicao'],
  'Copy':               ['revisao_copy'],
  'Gestor de Tráfego':  ['revisao_edicao', 'revisao_copy'],
};

// Fases de aprovação para sócios (veem tudo)
const TODAS_FASES_REVISAO = ['revisao_copy', 'revisao_edicao'];

export function PainelAprovacaoView({ nivel, setor, userId }: Props) {
  const [criativos, setCriativos] = useState<Criativo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [devolvendoId, setDevolvendoId] = useState<string | null>(null);
  const [notaDevolucao, setNotaDevolucao] = useState('');
  const [saving, setSaving] = useState(false);

  const fasesVisiveis: string[] = nivel === 'socio'
    ? TODAS_FASES_REVISAO
    : (FASES_APROVACAO[setor?.nome ?? ''] ?? TODAS_FASES_REVISAO);

  const loadCriativos = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('producoes')
      .select('*, funil:funis(id,nome,produto), responsavel:perfis!responsavel_id(id,nome), copy:perfis!copy_id(id,nome), gestor:perfis!gestor_id(id,nome)')
      .in('fase', fasesVisiveis)
      .order('data_prazo', { ascending: true, nullsFirst: false });
    setCriativos(data ?? []);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nivel, setor?.nome]);

  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const handleAprovar = async (c: Criativo) => {
    let { next } = getAdjacentFases(c.tipo, c.fase);
    // 'alteracao' é atingida apenas via devolução; aprovação pula direto para a fase seguinte
    if (next === 'alteracao') {
      next = getAdjacentFases(c.tipo, 'alteracao').next;
    }
    if (!next) return;
    setSaving(true);
    await supabase.from('producoes').update({ fase: next, atualizado_em: new Date().toISOString() }).eq('id', c.id);
    await supabase.from('criativo_historico').insert({
      criativo_id:    c.id,
      usuario_id:     userId,
      tipo_alteracao: 'fase',
      campo_alterado: 'fase',
      valor_anterior: c.fase,
      valor_novo:     next,
    });
    await supabase.from('criativo_comentarios').insert({
      criativo_id: c.id,
      autor_id: userId,
      texto: `Aprovado → ${FASES_MAP[next] ?? next}`,
      tipo: 'sistema',
    });
    setSaving(false);
    loadCriativos();
  };

  const handleDevolver = async (c: Criativo) => {
    if (!notaDevolucao.trim()) return;
    setSaving(true);
    await supabase.from('producoes').update({ fase: 'alteracao', atualizado_em: new Date().toISOString() }).eq('id', c.id);
    await supabase.from('criativo_historico').insert({
      criativo_id:    c.id,
      usuario_id:     userId,
      tipo_alteracao: 'fase',
      campo_alterado: 'fase',
      valor_anterior: c.fase,
      valor_novo:     'alteracao',
    });
    await supabase.from('criativo_comentarios').insert({
      criativo_id: c.id,
      autor_id: userId,
      texto: notaDevolucao.trim(),
      tipo: 'devolucao',
    });
    setSaving(false);
    setDevolvendoId(null);
    setNotaDevolucao('');
    loadCriativos();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }

  if (!criativos.length) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Nenhum item aguardando aprovação.
      </div>
    );
  }

  // Agrupa por fase
  const porFase = fasesVisiveis.reduce<Record<string, Criativo[]>>((acc, fase) => {
    acc[fase] = criativos.filter(c => c.fase === fase);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      {fasesVisiveis.map(fase => {
        const items = porFase[fase] ?? [];
        if (!items.length) return null;

        // Agrupa por funil dentro da fase
        const funilOrder: string[] = [];
        const porFunil: Record<string, Criativo[]> = {};
        for (const c of items) {
          const key = c.funil?.nome ?? '— Sem funil —';
          if (!porFunil[key]) { porFunil[key] = []; funilOrder.push(key); }
          porFunil[key].push(c);
        }

        return (
          <div key={fase}>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {FASES_MAP[fase] ?? fase} — {items.length}
            </h3>
            {funilOrder.map(funilNome => (
              <div key={funilNome} className="mb-4">
                {funilOrder.length > 1 && (
                  <p className="text-[11px] font-medium text-muted-foreground/60 mb-2 px-1 uppercase tracking-wider">
                    {funilNome}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {porFunil[funilNome].map(c => (
                    <div key={c.id} className="border border-border rounded-lg p-3 bg-card">
                      {/* Card principal */}
                      <div className="flex items-start gap-3">
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => setSelectedId(c.id)}
                        >
                          <p className="text-sm font-medium truncate">{c.nome}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                            {c.funil && <span>{c.funil.nome}</span>}
                            {c.funil && c.responsavel && <span>·</span>}
                            {c.responsavel && <span>Editor: {c.responsavel.nome}</span>}
                            {c.copy && <><span>·</span><span>Copy: {c.copy.nome}</span></>}
                            {c.data_prazo && (
                              <><span>·</span><span>Prazo: {new Date(c.data_prazo + 'T00:00:00').toLocaleDateString('pt-BR')}</span></>
                            )}
                          </div>
                        </div>

                        {/* Ações */}
                        {devolvendoId !== c.id && (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => { setDevolvendoId(c.id); setNotaDevolucao(''); }}
                            >
                              <CornerDownLeft className="h-3.5 w-3.5" />
                              Devolver
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={saving}
                              onClick={() => handleAprovar(c)}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Aprovar
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Formulário de devolução */}
                      {devolvendoId === c.id && (
                        <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
                          <p className="text-xs text-muted-foreground">Nota obrigatória para devolução:</p>
                          <textarea
                            autoFocus
                            rows={2}
                            value={notaDevolucao}
                            onChange={e => setNotaDevolucao(e.target.value)}
                            placeholder="Descreva o que precisa ser ajustado..."
                            className={cn(
                              'w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none',
                              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                            )}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => { setDevolvendoId(null); setNotaDevolucao(''); }}
                            >
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs gap-1"
                              disabled={!notaDevolucao.trim() || saving}
                              onClick={() => handleDevolver(c)}
                            >
                              <CornerDownLeft className="h-3.5 w-3.5" />
                              Devolver com nota
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={loadCriativos}
        nivel={nivel}
        userId={userId}
        funis={[]}
        perfis={[]}
      />
    </div>
  );
}
