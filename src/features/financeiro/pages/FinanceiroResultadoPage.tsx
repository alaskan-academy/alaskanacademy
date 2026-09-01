/**
 * Resultado do mês — a tela que absorveu o Fechamento.
 *
 * O Fechamento respondia "quanto entrou e saiu da conta". Isso continua aqui,
 * mas embaixo, como conciliação: chamar o repasse da Payt de "receita bruta do
 * mês" era prometer uma coisa e entregar outra, porque o dinheiro que cai na
 * conta em setembro é venda de agosto.
 *
 * A conta de verdade está em `../lib/resultado.ts`, com os motivos. Esta
 * arquivo é só a apresentação — e a regra da apresentação é uma só: **cada
 * linha diz de onde veio**. Foi a mistura MUDA de bases que fez a tela antiga
 * mostrar 57,1% de margem contra 3,2% no extrato.
 */
import { paraYmd } from '@/lib/datas';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { AvisoRevisao } from '@/features/financeiro/components/AvisoRevisao';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { Download, Info } from 'lucide-react';
import { ehCustoOperacional, CAT_ANUNCIOS, CAT_IMPOSTOS } from '@/features/financeiro/constants';
import {
  agruparCaixa, montarResultado, janelaDeMeses, mesAnterior,
  type Caixa, type Competencia, type LinhaTransacao, type Resultado,
} from '@/features/financeiro/lib/resultado';

// ─── helpers ─────────────────────────────────────────────────────────────────

const MESES_HISTORICO = 6;
/** Um a mais que o histórico: a alíquota presumida olha o mês ANTERIOR ao mais
 *  antigo da janela, e sem ele o mês da ponta ficaria sem base. */
const MESES_BUSCA = MESES_HISTORICO + 3;

function rotuloMes(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}
function primeiroDia(mes: string) { return `${mes}-01`; }
function ultimoDia(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return paraYmd(new Date(y, m, 0));
}

// ─── component ───────────────────────────────────────────────────────────────

export default function FinanceiroResultadoPage() {
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<Resultado[]>([]);
  const [custosCat, setCustosCat] = useState<{ categoria: string; total: number }[]>([]);
  /** Só para o aviso de mês sem dado do Meta poder dizer QUANTO está faltando. */
  const [anunciosNoExtrato, setAnunciosNoExtrato] = useState(0);

  const { empresaId } = useFilters();
  const mesAlvo = `${ano}-${String(mes).padStart(2, '0')}`;

  const load = useCallback(async () => {
    setLoading(true);
    const janela = janelaDeMeses(mesAlvo, MESES_BUSCA);
    const inicio = primeiroDia(janela[0]);
    const fim = ultimoDia(mesAlvo);

    let qFat = supabase
      .from('vw_faturamento_liquido')
      .select('data,faturamento_bruto,taxa_plataforma,reembolsos,investimento_meta,imposto_meta_ads')
      .gte('data', inicio).lte('data', fim);
    let qTrans = supabase
      .from('transacoes').select('data,valor,categoria')
      .gte('data', inicio).lte('data', fim);
    if (empresaId) {
      qFat = qFat.eq('empresa_id', empresaId);
      qTrans = qTrans.eq('empresa_id', empresaId);
    }

    const [fat, trans] = await Promise.all([qFat, qTrans]);
    if (fat.error || trans.error) {
      toast({ title: 'Erro ao carregar dados', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const competencia = new Map<string, Competencia>();
    for (const r of fat.data ?? []) {
      const k = String(r.data).slice(0, 7);
      const c = competencia.get(k) ?? {
        fatBruto: 0, taxaPayt: 0, reembolsos: 0, investMeta: 0, impostoMeta: 0,
      };
      c.fatBruto += Number(r.faturamento_bruto ?? 0);
      c.taxaPayt += Number(r.taxa_plataforma ?? 0);
      c.reembolsos += Number(r.reembolsos ?? 0);
      c.investMeta += Number(r.investimento_meta ?? 0);
      c.impostoMeta += Number(r.imposto_meta_ads ?? 0);
      competencia.set(k, c);
    }

    const transacoes = (trans.data ?? []) as LinhaTransacao[];
    const caixa: Map<string, Caixa> = agruparCaixa(transacoes);

    const doHistorico = janelaDeMeses(mesAlvo, MESES_HISTORICO);
    setLinhas(doHistorico.map(m => montarResultado(m, competencia, caixa, janela)));
    setAnunciosNoExtrato(caixa.get(mesAlvo)?.anunciosPagos ?? 0);

    /* Custos por categoria — as MESMAS exclusões da cascata, senão o gráfico
       diz uma coisa e o total diz outra na mesma tela. Já aconteceu: a versão
       antiga somava toda saída no gráfico e "Reserva de Caixa" aparecia como
       custo. */
    const catMap = new Map<string, number>();
    for (const t of transacoes) {
      if (t.data.slice(0, 7) !== mesAlvo) continue;
      if (!ehCustoOperacional(t)) continue;
      if (!t.categoria || t.categoria === CAT_ANUNCIOS || t.categoria === CAT_IMPOSTOS) continue;
      catMap.set(t.categoria, (catMap.get(t.categoria) ?? 0) + Math.abs(Number(t.valor)));
    }
    setCustosCat(
      Array.from(catMap, ([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total).slice(0, 10),
    );
    setLoading(false);
  }, [mesAlvo, empresaId]);

  useEffect(() => { load(); }, [load]);

  const atual = linhas.find(l => l.mes === mesAlvo) ?? null;
  /* O mês corrente é parcial dos DOIS lados, e é assimétrico: a receita entra
     dia a dia, mas o imposto presumido chega inteiro no dia 1 — ele é sobre o
     mês anterior, que já fechou. Sem dizer isso, o dia 1 de setembro parece
     catástrofe. */
  const emAndamento = mesAlvo === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const mesOpts = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'long' }),
  })), []);
  const anoOpts = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  function exportar() {
    if (!linhas.length) return;
    const cab = ['Mês', 'Faturamento bruto', 'Taxa Payt', 'Reembolsos',
      'Investimento Meta', 'Imposto Meta', 'Simples', 'Simples presumido',
      'Custos pagos', 'Resultado', 'Margem %'];
    const corpo = linhas.map(l => [
      l.mes, l.fatBruto, l.taxaPayt, l.reembolsos, l.investMeta, l.impostoMeta,
      l.simples.valor, l.simples.presumido ? 'sim' : 'não',
      l.custosPagos, l.resultado, l.margem.toFixed(2),
    ]);
    const csv = [cab, ...corpo].map(r => r.join(';')).join('\n');
    /* O BOM vai como escape: escrito como caractere, o eslint o acusa de
       espaco irregular — e ele existe para o Excel abrir o CSV em UTF-8. */
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `resultado-${mesAlvo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── render ───────────────────────────────────────────────────────────────

  /** Uma linha da cascata. `fonte` não é enfeite: é o que torna a mistura
   *  legível, e a falta dela foi o defeito da tela antiga. */
  const Linha = ({ rotulo, valor, fonte, nota, negativo, total }: {
    rotulo: string; valor: number; fonte?: string; nota?: React.ReactNode;
    negativo?: boolean; total?: boolean;
  }) => (
    <div className={cn(
      'flex items-baseline justify-between gap-4 py-2.5',
      total ? 'border-t-2 border-border mt-1 pt-3' : 'border-b border-border/40',
    )}>
      <div className="min-w-0">
        <p className={cn('text-sm', total && 'font-semibold')}>
          {negativo && <span className="text-muted-foreground mr-1">−</span>}
          {rotulo}
        </p>
        {(fonte || nota) && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
            {fonte && <span className="uppercase tracking-wide">{fonte}</span>}
            {fonte && nota && <span className="mx-1.5">·</span>}
            {nota}
          </p>
        )}
      </div>
      <p className={cn(
        'tabular-nums whitespace-nowrap shrink-0',
        total ? 'text-xl font-bold' : 'text-sm',
        total && valor < 0 && 'text-destructive',
        total && valor > 0 && 'text-green-400',
      )}>{formatCurrency(valor)}</p>
    </div>
  );

  return (
    <DashboardLayout title="Financeiro" hideFilters hideTitle>
      <FinanceiroNav />
      <AvisoRevisao inicio={primeiroDia(mesAlvo)} fim={ultimoDia(mesAlvo)} modo="inclui" />

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Select value={String(mes)} onValueChange={v => setMes(Number(v))}>
          <SelectTrigger className="w-[150px] capitalize"><SelectValue /></SelectTrigger>
          <SelectContent>
            {mesOpts.map(m => (
              <SelectItem key={m.value} value={String(m.value)} className="capitalize">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(ano)} onValueChange={v => setAno(Number(v))}>
          <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {anoOpts.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportar} disabled={!linhas.length || loading}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!loading && !atual && (
        <p className="text-sm text-muted-foreground py-12 text-center">
          Sem movimento neste mês.
        </p>
      )}

      {!loading && atual && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            {/* ── a cascata ── */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Resultado do mês
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {atual.semDadosDeAnuncio ? 'margem indisponível' : `margem ${atual.margem.toFixed(1)}%`}
                  {emAndamento && ' · mês em andamento'}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
                Cada linha vem da fonte que sabe aquilo. Venda e anúncio pelo que
                aconteceu no mês; imposto e custo pelo que saiu da conta.
              </p>

              <Linha rotulo="Faturamento bruto" valor={atual.fatBruto} fonte="Payt"
                     nota="vendas aprovadas no mês" />
              <Linha rotulo="Taxa da Payt" valor={atual.taxaPayt} fonte="Payt"
                     nota={atual.fatBruto > 0
                       ? `${((atual.taxaPayt / atual.fatBruto) * 100).toFixed(2)}% efetivo`
                       : undefined} negativo />
              <Linha rotulo="Reembolsos" valor={atual.reembolsos} fonte="Payt" negativo />
              <Linha rotulo="Investimento em anúncios" valor={atual.investMeta} fonte="Meta"
                     nota={atual.semDadosDeAnuncio
                       ? <span className="text-destructive">sem dados do Meta neste mês — falta aqui</span>
                       : 'o cartão mistura meses; aqui é o gasto do mês'} negativo />
              <Linha rotulo="Imposto sobre o anúncio" valor={atual.impostoMeta} fonte="Meta × alíquota"
                     nota="só existe dentro da fatura do cartão" negativo />
              <Linha
                rotulo="Impostos"
                valor={atual.simples.valor}
                fonte={atual.simples.presumido ? 'presumido' : 'extrato'}
                negativo
                nota={atual.simples.presumido
                  ? (atual.simples.pct === null
                      ? 'ainda não pago e sem base para estimar'
                      : <>ainda não pago · {atual.simples.pct.toFixed(2)}% sobre {rotuloMes(mesAnterior(mesAlvo))},
                         média de {atual.simples.baseMeses.map(rotuloMes).join(' e ')}</>)
                  : 'pago no mês, sobre a receita do anterior'} />
              <Linha rotulo="Demais custos" valor={atual.custosPagos} fonte="extrato"
                     nota="sem anúncio, sem imposto e sem transferência entre contas próprias"
                     negativo />
              <Linha rotulo="Resultado" valor={atual.resultado} total />

              {atual.semDadosDeAnuncio && (
                <div className="flex gap-2 mt-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
                  <Info className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                  <p className="text-[11px] text-destructive leading-snug">
                    <strong>Este resultado não fecha.</strong> O extrato mostra{' '}
                    {formatCurrency(anunciosNoExtrato)} de anúncio pagos no mês, mas
                    não há dado do Meta para ele — a maior saída está de fora da
                    conta acima. A série do Meta começa em maio de 2026.
                  </p>
                </div>
              )}

              {atual.simples.presumido && (
                <div className="flex gap-2 mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
                  <Info className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
                  <p className="text-[11px] text-amber-200/90 leading-snug">
                    O imposto deste mês é <strong>presumido</strong> — ainda não foi
                    pago. Quando o pagamento entrar no extrato, esta linha passa a
                    mostrar o valor real sozinha.
                  </p>
                </div>
              )}
            </div>

            {/* ── conciliação com o caixa ── */}
            <div className="flex flex-col gap-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  O mesmo mês, em caixa
                </p>
                <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
                  O que de fato entrou e saiu da conta. A diferença para o
                  resultado acima não é erro: é o dinheiro do mês passado
                  chegando agora, e o deste mês chegando no que vem.
                </p>
                <Linha rotulo="Entrou na conta" valor={atual.caixaEntrou} fonte="extrato" />
                <Linha rotulo="Saiu da conta" valor={atual.caixaSaiu} fonte="extrato"
                       nota="inclusive anúncio e imposto" negativo />
                <Linha rotulo="Resultado em caixa"
                       valor={atual.caixaEntrou - atual.caixaSaiu} total />
                <p className="text-[11px] text-muted-foreground mt-3">
                  Diferença para o resultado do mês:{' '}
                  <span className="tabular-nums font-medium text-foreground">
                    {formatCurrency((atual.caixaEntrou - atual.caixaSaiu) - atual.resultado)}
                  </span>
                </p>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 flex-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Custos por categoria
                </p>
                {custosCat.length === 0
                  ? <p className="text-xs text-muted-foreground">Sem custos no período</p>
                  : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={custosCat} layout="vertical" margin={{ left: 0, right: 16 }}>
                        <XAxis type="number" tickFormatter={v => formatCurrency(v).replace('R$ ', '')} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="categoria" width={130} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => [formatCurrency(v), 'Total']} contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                          {custosCat.map((_, i) => <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
              </div>
            </div>
          </div>

          {/* ── histórico ── */}
          <div className="bg-card border border-border rounded-xl p-4 mb-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {MESES_HISTORICO} meses
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={linhas.map(l => ({
                label: rotuloMes(l.mes), Faturamento: l.fatBruto, Resultado: l.resultado,
              }))}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Faturamento" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Resultado" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  {['Mês', 'Faturamento', 'Anúncio', 'Imposto', 'Custos', 'Resultado', 'Margem'].map((h, i) => (
                    <th key={h} className={cn(
                      'px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider',
                      i === 0 ? 'text-left' : 'text-right',
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {linhas.map(l => (
                  <tr key={l.mes} className={cn(
                    'hover:bg-muted/20 transition-colors',
                    l.mes === mesAlvo && 'font-semibold bg-muted/10',
                  )}>
                    <td className="px-4 py-3 capitalize">{rotuloMes(l.mes)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(l.fatBruto)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {l.semDadosDeAnuncio
                        ? <span className="text-destructive" title="Sem dados do Meta neste mês">sem dado</span>
                        : formatCurrency(l.investMeta + l.impostoMeta)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(l.simples.valor)}
                      {l.simples.presumido && l.simples.valor > 0 && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-400">prev.</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(l.custosPagos)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums',
                      l.semDadosDeAnuncio ? 'text-muted-foreground line-through'
                        : l.resultado < 0 ? 'text-destructive' : 'text-green-400')}>
                      {formatCurrency(l.resultado)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {l.semDadosDeAnuncio
                        ? <span className="text-muted-foreground">—</span>
                        : `${l.margem.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
