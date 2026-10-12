import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Loader2, Target, AlertTriangle, Check } from 'lucide-react';

/*
  As metas do ano, e o que o painel já consegue medir sozinho.

  A tabela reproduz de propósito a forma do "Plano de crescimento Out/26 a
  Jul/27": um indicador por linha, um prazo por coluna. É o formato que ela já
  lê na Weekly; inventar outro aqui só obrigaria a traduzir de cabeça.

  A única diferença é a primeira coluna. No documento ela se chama "Hoje" e é
  um número digitado que envelhece no instante seguinte. Aqui ela é medida ao
  vivo — e foi medindo que apareceram três erros no plano: a base com WhatsApp
  estava em 25% e já era 99,1%; as assinaturas ativas estavam em ~190 e eram
  90; e a "recompra em 90 dias" de 11% era, na verdade, a recompra de todo o
  histórico (na janela de 90 dias são 7,1%).

  Por isso o `valor_base` do plano aparece embaixo do medido quando os dois
  discordam: a diferença entre o que se acreditava e o que é não é ruído a
  esconder, é a informação mais útil da tela.
*/

type Unidade = 'moeda' | 'percentual' | 'numero' | 'multiplicador';
type Direcao = 'piso' | 'teto';

/** Uma meta: um alvo para um indicador, com prazo. */
interface Meta {
  id: string;
  kpi: string;
  prazo: string;
  valor_alvo: number;
  valor_base: number | null;
  observacao: string | null;
  metas_kpi: {
    nome: string;
    unidade: Unidade;
    direcao: Direcao;
    automatico: boolean;
    observacao: string | null;
    ordem: number;
  } | null;
}

/** Uma linha da tabela: o indicador e seus alvos, um por prazo. */
interface Linha {
  kpi: string;
  nome: string;
  unidade: Unidade;
  direcao: Direcao;
  automatico: boolean;
  nota: string | null;
  ordem: number;
  base: number | null;
  porPrazo: Map<string, Meta>;
}

function formatar(valor: number | null | undefined, unidade: Unidade) {
  if (valor === null || valor === undefined) return '—';
  switch (unidade) {
    case 'moeda':         return formatCurrency(valor);
    case 'percentual':    return `${valor.toFixed(1).replace('.', ',')}%`;
    case 'multiplicador': return `${valor.toFixed(2).replace('.', ',')}x`;
    default:              return formatNumber(valor);
  }
}

/** Alcançada é `>=` quando a meta é piso e `<=` quando é teto. */
function atingiu(medido: number, alvo: number, direcao: Direcao) {
  return direcao === 'piso' ? medido >= alvo : medido <= alvo;
}

const ROTULO_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-12-31" → "dez/26". Sem `new Date`, que na virada do fuso volta um mês. */
function rotuloDoPrazo(prazo: string) {
  const [ano, mes] = prazo.split('-');
  return `${ROTULO_MES[Number(mes) - 1]}/${ano.slice(2)}`;
}

export default function MetasPage() {
  const { empresaId } = useFilters();

  const [linhas, setLinhas]   = useState<Linha[]>([]);
  const [prazos, setPrazos]   = useState<string[]>([]);
  const [medido, setMedido]   = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);

    const [metas, medicao] = await Promise.all([
      supabase
        .from('metas')
        .select('id, kpi, prazo, valor_alvo, valor_base, observacao, metas_kpi(nome, unidade, direcao, automatico, observacao, ordem)')
        .order('prazo'),
      supabase.rpc('fn_metas_medir', { p_empresa: empresaId }),
    ]);

    /*
      Erro visível em vez de tela com zeros. Zero e "não consegui ler" são
      coisas diferentes, e confundi-los é a origem conhecida de metade dos
      defeitos deste painel.
    */
    if (metas.error) {
      setErro(metas.error.message);
      setLoading(false);
      return;
    }

    const porKpi = new Map<string, Linha>();
    const vistos = new Set<string>();

    for (const m of (metas.data ?? []) as unknown as Meta[]) {
      const k = m.metas_kpi;
      if (!k) continue;
      vistos.add(m.prazo);
      if (!porKpi.has(m.kpi)) {
        porKpi.set(m.kpi, {
          kpi: m.kpi, nome: k.nome, unidade: k.unidade, direcao: k.direcao,
          automatico: k.automatico, nota: k.observacao, ordem: k.ordem,
          base: m.valor_base, porPrazo: new Map(),
        });
      }
      porKpi.get(m.kpi)!.porPrazo.set(m.prazo, m);
    }

    const medidas: Record<string, number> = {};
    // A medição pode falhar sozinha sem derrubar a tela: sem ela a coluna
    // "Agora" fica vazia, mas os alvos continuam legíveis.
    for (const r of (medicao.data ?? []) as { kpi: string; valor: number | null }[]) {
      if (r.valor !== null) medidas[r.kpi] = Number(r.valor);
    }

    setLinhas([...porKpi.values()].sort((a, b) => a.ordem - b.ordem));
    setPrazos([...vistos].sort());
    setMedido(medidas);
    setLoading(false);
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <DashboardLayout title="Metas" hideFilters>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Plano de crescimento <b className="text-foreground">Out/26 a Jul/27</b>. A coluna{' '}
          <b className="text-foreground">Agora</b> é medida no banco a cada abertura; os prazos
          são os alvos escritos no plano. Indicador marcado como manual ainda não tem fonte
          automática — o motivo está no título de cada um.
        </p>

        {erro && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Não consegui ler as metas: {erro}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando metas…
          </div>
        ) : linhas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Target className="h-5 w-5" />
            Nenhuma meta cadastrada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Indicador</th>
                  <th className="px-4 py-3 text-right font-medium">Agora</th>
                  {prazos.map(p => (
                    <th key={p} className="px-4 py-3 text-right font-medium">{rotuloDoPrazo(p)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => {
                  const agora = medido[l.kpi];
                  const temMedida = agora !== undefined;
                  /* O plano dizia uma coisa e a medição diz outra: mostrar as
                     duas. Só quando divergem de verdade — 1% de diferença é
                     arredondamento, não descoberta. */
                  const divergeDoPlano =
                    temMedida && l.base !== null && l.base !== 0 &&
                    Math.abs(agora - l.base) / Math.abs(l.base) > 0.05;

                  return (
                    <tr key={l.kpi} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3">
                        <span className="text-foreground" title={l.nota ?? undefined}>{l.nome}</span>
                        {!l.automatico && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            manual
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums">
                        {temMedida ? (
                          <>
                            <b className="text-foreground">{formatar(agora, l.unidade)}</b>
                            {divergeDoPlano && (
                              <div className="text-[11px] text-muted-foreground">
                                o plano dizia {formatar(l.base, l.unidade)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {prazos.map(p => {
                        const meta = l.porPrazo.get(p);
                        if (!meta) return <td key={p} className="px-4 py-3 text-right text-muted-foreground">—</td>;

                        const ok      = temMedida && atingiu(agora, meta.valor_alvo, l.direcao);
                        const vencida = p < hoje && !ok;

                        return (
                          <td key={p} className="px-4 py-3 text-right tabular-nums">
                            <span className={cn(
                              'inline-flex items-center gap-1',
                              ok && 'text-emerald-400',
                              vencida && 'text-amber-400',
                              !ok && !vencida && 'text-foreground',
                            )}>
                              {ok && <Check className="h-3.5 w-3.5" />}
                              {/* Prazo vencido vira alerta e a meta FICA ABERTA:
                                  decisão dela, e o oposto de sumir da tela. */}
                              {vencida && <AlertTriangle className="h-3.5 w-3.5" />}
                              {formatar(meta.valor_alvo, l.unidade)}
                            </span>
                            {temMedida && !ok && meta.valor_alvo !== 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                {Math.round((agora / meta.valor_alvo) * 100)}% do alvo
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
