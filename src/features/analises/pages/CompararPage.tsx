import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2 } from 'lucide-react';
import { AnalisesNav } from '../components/AnalisesNav';
import { CelulaTripla } from '../components/ListaMetricas';
import { BlocoMetricas, variacao } from '../metricas';
import {
  Janela, PERIODOS, PERSONALIZADO, janelaDeDias, diasDaJanela, formatarData,
} from '../periodo';

/**
 * Todos os REVs lado a lado — a tela do "qual funil eu corto".
 *
 * A rodada mostra um REV por vez, e está certo: analisar é entender um funil de
 * cada vez. Mas cortar é COMPARAR, e comparar percorrendo seis telas exige
 * guardar seis conjuntos de números na cabeça — que é exatamente como se decide
 * errado.
 *
 * O par (front, com upsell) fica lado a lado em cada linha porque é ele que
 * impede as duas leituras erradas de sempre: matar funil lucrativo porque o
 * front é fraco, e deixar front doente rodando porque o total fecha no azul.
 * Um funil de ROAS 1,00 com 10% de adesão põe mais dinheiro no bolso que um de
 * 1,40 com 2% — e ao mesmo tempo é o que mais precisa de conserto. As duas
 * coisas são verdade, e só se enxergam juntas.
 */

interface LinhaRev {
  funil_id: string;
  rev: string;
  projeto: string | null;
  metodo: string | null;
  atual: BlocoMetricas;
  anterior: BlocoMetricas;
}

type Ordem = 'lucro' | 'roas' | 'investimento' | 'adesao';

const ORDENS: Array<{ valor: Ordem; label: string }> = [
  { valor: 'lucro',        label: 'Maior lucro com upsell' },
  { valor: 'roas',         label: 'Menor ROAS do front' },
  { valor: 'investimento', label: 'Maior investimento' },
  { valor: 'adesao',       label: 'Maior adesão ao upsell' },
];

const num2 = (n: number) => n.toFixed(2);
const pct2 = (n: number) => `${n.toFixed(2)}%`;

function Delta({ valor, anterior, subirEhRuim = false }: {
  valor: number | null; anterior: number | null; subirEhRuim?: boolean;
}) {
  const v = variacao(valor, anterior);
  if (v.pct == null || v.direcao === 'igual') return null;
  const bom = (v.direcao === 'subiu') !== subirEhRuim;
  const Icone = v.direcao === 'subiu' ? ArrowUp : ArrowDown;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums',
      bom ? 'text-emerald-400' : 'text-red-400',
    )}>
      <Icone className="h-2.5 w-2.5" />
      {Math.abs(v.pct) >= 1000 && valor != null && anterior
        ? `${(valor / anterior).toFixed(0)}×`
        : `${Math.abs(v.pct).toFixed(0)}%`}
    </span>
  );
}

export default function CompararPage() {
  const [linhas, setLinhas] = useState<LinhaRev[]>([]);
  const [preset, setPreset] = useState<string>('14');
  const [janela, setJanela] = useState<Janela>(() => janelaDeDias(14));
  const [ordem, setOrdem]   = useState<Ordem>('lucro');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async (j: Janela) => {
    setCarregando(true);
    const { data, error } = await supabase.rpc('fn_comparar_revs', {
      p_inicio: j.inicio, p_fim: j.fim,
    });
    if (error) {
      toast({ title: 'Erro ao comparar', description: error.message, variant: 'destructive' });
    }
    setLinhas((data ?? []) as LinhaRev[]);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(janela); }, [carregar, janela]);

  function trocarPreset(v: string) {
    setPreset(v);
    if (v !== PERSONALIZADO) setJanela(janelaDeDias(Number(v)));
  }

  const ordenadas = useMemo(() => {
    const chave = (l: LinhaRev) => {
      switch (ordem) {
        case 'roas':         return l.atual.roas ?? Infinity;   // pior primeiro
        case 'investimento': return -l.atual.investimento;
        case 'adesao':       return -(l.atual.upsell_adesao_pct ?? 0);
        default:             return -l.atual.lucro_com_upsell;
      }
    };
    return [...linhas].sort((a, b) => chave(a) - chave(b));
  }, [linhas, ordem]);

  // O total da conta, para saber se a soma dos REVs fecha no azul.
  const totais = useMemo(() => linhas.reduce((t, l) => ({
    investimento: t.investimento + l.atual.investimento,
    lucroFront:   t.lucroFront + l.atual.lucro_liquido,
    lucroTotal:   t.lucroTotal + l.atual.lucro_com_upsell,
  }), { investimento: 0, lucroFront: 0, lucroTotal: 0 }), [linhas]);

  const dias = diasDaJanela(janela);
  const emRisco = linhas.filter(l => l.atual.front_se_paga === false).length;

  return (
    <DashboardLayout title="Análises" hideFilters>
      <AnalisesNav />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={preset} onValueChange={trocarPreset}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODOS.map(p => (
                <SelectItem key={p.dias} value={String(p.dias)}>{p.label}</SelectItem>
              ))}
              <SelectItem value={PERSONALIZADO}>Personalizado…</SelectItem>
            </SelectContent>
          </Select>

          {preset === PERSONALIZADO && (
            <div className="flex items-center gap-1">
              <Input
                type="date" className="h-9 w-[9.5rem] text-sm"
                value={janela.inicio} max={janela.fim}
                onChange={e => e.target.value && setJanela(j => ({ ...j, inicio: e.target.value }))}
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="date" className="h-9 w-[9.5rem] text-sm"
                value={janela.fim} min={janela.inicio}
                onChange={e => e.target.value && setJanela(j => ({ ...j, fim: e.target.value }))}
              />
            </div>
          )}

          <Select value={ordem} onValueChange={v => setOrdem(v as Ordem)}>
            <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORDENS.map(o => (
                <SelectItem key={o.valor} value={o.valor}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <span className="text-xs text-muted-foreground">
            {formatarData(janela.inicio)} a {formatarData(janela.fim)} ({dias} dias)
          </span>
        </div>

        {emRisco > 0 && (
          <p className="text-xs text-amber-400/90 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {emRisco === 1
                ? '1 REV não paga o próprio tráfego com o front'
                : `${emRisco} REVs não pagam o próprio tráfego com o front`}
              {' '}— o upsell é que sustenta. Total no azul ali não quer dizer página saudável.
            </span>
          </p>
        )}

        {carregando ? (
          <div className="flex items-center justify-center py-32">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : ordenadas.length === 0 ? (
          <div className="py-20 text-center space-y-2">
            <p className="text-sm text-muted-foreground">Nenhum REV ativo para comparar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm min-w-[52rem]">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left  font-medium px-3 py-1.5">REV</th>
                  <th className="text-right font-medium px-3 py-1.5 w-32">Investimento</th>
                  <th className="text-right font-medium px-3 py-1.5 w-28">ROAS front</th>
                  <th className="text-right font-medium px-3 py-1.5 w-32">Adesão ao up</th>
                  <th className="text-right font-medium px-3 py-1.5 w-28">ROAS total</th>
                  <th className="text-right font-medium px-3 py-1.5 w-36">Lucro c/ upsell</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map(l => {
                  const a = l.atual, ant = l.anterior;
                  const sustentado = a.front_se_paga === false;
                  return (
                    <tr key={l.funil_id} className="border-b border-border/40 last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {a.front_se_paga != null && (sustentado
                            ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                            : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/70" />)}
                          <span className="font-medium">{l.rev}</span>
                          {l.metodo && (
                            <span className="text-[9px] px-1 py-px rounded bg-secondary text-muted-foreground border border-border">
                              {l.metodo}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {l.projeto ?? 'sem projeto'} · {formatNumber(a.vendas)} vendas
                        </div>
                      </td>

                      <td className="px-3 py-2 text-right">
                        <CelulaTripla
                          principal={formatCurrency(a.investimento)}
                          base={<Delta valor={a.investimento} anterior={ant.investimento} subirEhRuim />}
                        />
                      </td>

                      {/* O par que decide fica junto: front à esquerda, total à
                          direita, com a adesão no meio explicando a travessia. */}
                      <td className={cn(
                        'px-3 py-2 text-right',
                        sustentado && 'bg-amber-500/5',
                      )}>
                        <CelulaTripla
                          principal={
                            <span className={cn(sustentado && 'text-amber-300')}>
                              {a.roas != null ? num2(a.roas) : '—'}
                            </span>
                          }
                          base={<Delta valor={a.roas} anterior={ant.roas} />}
                        />
                      </td>

                      <td className="px-3 py-2 text-right">
                        <CelulaTripla
                          topo={formatNumber(a.upsell_qtd)}
                          principal={a.upsell_adesao_pct != null ? pct2(a.upsell_adesao_pct) : '—'}
                          base={<Delta valor={a.upsell_adesao_pct} anterior={ant.upsell_adesao_pct} />}
                        />
                      </td>

                      <td className="px-3 py-2 text-right">
                        <CelulaTripla
                          principal={a.roas_com_upsell != null ? num2(a.roas_com_upsell) : '—'}
                          base={<Delta valor={a.roas_com_upsell} anterior={ant.roas_com_upsell} />}
                        />
                      </td>

                      <td className="px-3 py-2 text-right">
                        <CelulaTripla
                          destaque
                          principal={
                            <span className={a.lucro_com_upsell < 0 ? 'text-red-400' : 'text-emerald-400'}>
                              {formatCurrency(a.lucro_com_upsell)}
                            </span>
                          }
                          base={<>
                            só front: {formatCurrency(a.lucro_liquido)}
                          </>}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-secondary/30 text-sm">
                  <td className="px-3 py-2 font-semibold">Todos os REVs ativos</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatCurrency(totais.investimento)}
                  </td>
                  <td colSpan={3} />
                  <td className="px-3 py-2 text-right">
                    <CelulaTripla
                      destaque
                      principal={
                        <span className={totais.lucroTotal < 0 ? 'text-red-400' : 'text-emerald-400'}>
                          {formatCurrency(totais.lucroTotal)}
                        </span>
                      }
                      base={<>só front: {formatCurrency(totais.lucroFront)}</>}
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
