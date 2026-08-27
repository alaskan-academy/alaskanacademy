import { paraYmd } from '@/lib/datas';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import {
  CAT_CUSTOS_OPERACIONAIS, CAT_ANUNCIOS, ehCustoOperacional, ehReceita,
} from '@/features/financeiro/constants';
import { AvisoRevisao } from '@/features/financeiro/components/AvisoRevisao';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Download, DollarSign, Target, Percent, Zap } from 'lucide-react';

// ─── helpers ─────────────────────────────────────────────────────────────────

function mesLabel(yyyy: number, mm: number) {
  return new Date(yyyy, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}
function primeiroDia(yyyy: number, mm: number) {
  return `${yyyy}-${String(mm).padStart(2, '0')}-01`;
}
function ultimoDia(yyyy: number, mm: number) {
  return paraYmd(new Date(yyyy, mm, 0));
}
function mesesAnteriores(yyyy: number, mm: number, n: number) {
  const list: { yyyy: number; mm: number }[] = [];
  for (let i = 0; i < n; i++) {
    let m = mm - i;
    let y = yyyy;
    while (m <= 0) { m += 12; y -= 1; }
    list.unshift({ yyyy: y, mm: m });
  }
  return list;
}

// ─── types ───────────────────────────────────────────────────────────────────

interface KPIs {
  receitaBruta: number;
  /** Receita menos custo operacional, em reais. A margem sozinha esconde a
   *  escala: 3,2% de R$ 123 mil e 3,2% de R$ 12 mil são decisões diferentes. */
  resultado: number;
  totalCustos: number;
  margemOperacional: number;
  /** Quanto saiu da conta em anúncio no período. Vem do extrato, não do Meta:
   *  aqui interessa o dinheiro que saiu, não o que a plataforma reporta. */
  gastoAds: number;
}

interface CustoCategoria { categoria: string; total: number }
interface MesRow {
  label: string;
  receitaBruta: number;
  totalCustos: number;
  margem: number;
}

const CORES_BARRA = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#f97316','#14b8a6',
];

// ─── component ───────────────────────────────────────────────────────────────

export default function FinanceiroFechamentoPage() {
  const now = new Date();
  const [ano, setAno]   = useState(now.getFullYear());
  const [mes, setMes]   = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);

  const [kpis, setKpis]               = useState<KPIs | null>(null);
  const [custosCat, setCustosCat]     = useState<CustoCategoria[]>([]);
  const [historico, setHistorico]     = useState<MesRow[]>([]);

  // ── fetch ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const inicio = primeiroDia(ano, mes);
    const fim    = ultimoDia(ano, mes);
    const meses  = mesesAnteriores(ano, mes, 6);

    // Uma fonte só: o extrato. Venda de plataforma vive nas telas de Vendas.
    const [trans] = await Promise.all([
      supabase
        .from('transacoes')
        .select('valor,categoria')
        .gte('data', inicio)
        .lte('data', fim),
    ]);

    if (trans.error) {
      toast({ title: 'Erro ao carregar dados', variant: 'destructive' });
    }

    /* -----------------------------------------------------------------------
     * Só extrato bancário.
     *
     * Antes a receita vinha da Payt e da Hotmart e o custo vinha do banco — duas
     * bases diferentes na mesma conta de margem —, e ainda por cima a consulta
     * de custos EXCLUÍA 'Anúncios (Facebook ADs)', porque o gasto de anúncio
     * deveria chegar pela UTMify. A UTMify nunca foi ligada (`metricas_diarias`
     * com zero linhas), então a maior saída do mês simplesmente não entrava.
     *
     * Em agosto/2026 isso dava margem de 57,1% na tela contra 3,2% no extrato:
     * R$ 92.849,66 de anúncio fora da conta.
     * --------------------------------------------------------------------- */
    const linhas = trans.data || [];
    const soma = (f: (t: { valor: number; categoria: string | null }) => boolean) =>
      linhas.filter(f).reduce((s, t) => s + Math.abs(Number(t.valor)), 0);

    const receitaBruta  = soma(ehReceita);
    // Não existe "líquida" aqui. O dinheiro chega na conta já descontado da
    // taxa da plataforma, então o extrato só tem UM valor de receita. Bruto
    // versus líquido é conversa da Payt, e a Payt não entra nesta tela.
    const totalCustos   = soma(ehCustoOperacional);
    const gastoAds      = soma(t => t.valor < 0 && t.categoria === CAT_ANUNCIOS);
    const resultado     = receitaBruta - totalCustos;
    const margem        = receitaBruta > 0 ? (resultado / receitaBruta) * 100 : 0;

    setKpis({ receitaBruta, resultado, totalCustos, margemOperacional: margem, gastoAds });

    // custos por categoria
    const catMap = new Map<string, number>();
    // O gráfico usa a MESMA classificação do total. Antes ele somava toda
    // saída, então "Reserva de Caixa" aparecia como custo — e transferência
    // entre contas próprias não é custo, é caixa mudando de lugar. O gráfico
    // dizia uma coisa e o cartão de total dizia outra, na mesma tela.
    for (const t of (trans.data || [])) {
      if (t.valor >= 0) continue;
      if (!ehCustoOperacional(t)) continue;
      if (!t.categoria) continue;
      catMap.set(t.categoria, (catMap.get(t.categoria) || 0) + Math.abs(Number(t.valor)));
    }
    setCustosCat(
      Array.from(catMap.entries())
        .map(([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
    );

    // histórico 6 meses
    const hist: MesRow[] = await Promise.all(
      meses.map(async ({ yyyy, mm }) => {
        const d0 = primeiroDia(yyyy, mm);
        const d1 = ultimoDia(yyyy, mm);
        // Mesma regra do mês corrente: extrato, receita e custo pela mesma base.
        const { data: t2 } = await supabase
          .from('transacoes').select('valor,categoria').gte('data', d0).lte('data', d1);
        const linhas2 = t2 || [];
        const soma2 = (f: (t: { valor: number; categoria: string | null }) => boolean) =>
          linhas2.filter(f).reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
        const rb = soma2(ehReceita);
        const rl = rb;
        const tc = soma2(ehCustoOperacional);
        const mg = rl > 0 ? ((rl - tc) / rl) * 100 : 0;
        return { label: mesLabel(yyyy, mm), receitaBruta: rb, totalCustos: tc, margem: mg };
      })
    );
    setHistorico(hist);
    setLoading(false);
  }, [ano, mes]);

  useEffect(() => { load(); }, [load]);

  // ── derivados ──────────────────────────────────────────────────────────────

  const anoOpts = useMemo(() => [now.getFullYear(), now.getFullYear() - 1], []);
  const mesOpts = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'long' }),
  })), []);

  function exportar() {
    if (!kpis) return;
    const linhas = [
      ['Métrica', 'Valor'],
      // Mesma ordem da tela: entrou, saiu, sobrou, margem. Planilha que segue
      // outra sequência obriga quem lê a remontar a conta de cabeça.
      ['Entrou na conta', kpis.receitaBruta.toFixed(2)],
      ['Saiu da conta', kpis.totalCustos.toFixed(2)],
      ['  dos quais em anuncios', kpis.gastoAds.toFixed(2)],
      ['Resultado', kpis.resultado.toFixed(2)],
      ['Margem Operacional (%)', kpis.margemOperacional.toFixed(1)],
      [],
      ['Custos por Categoria'],
      ...custosCat.map(c => [c.categoria, c.total.toFixed(2)]),
    ];
    const csv = linhas.map(l => l.join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `fechamento-${ano}-${String(mes).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── render ───────────────────────────────────────────────────────────────

  const KPICard = ({ label, value, sub, icon: Icon, positivo }: {
    label: string; value: string; sub?: string; icon: React.ElementType; positivo?: boolean;
  }) => (
    <div className="bg-card border border-border rounded-xl p-4">
      {/* `items-start` e `leading-tight`: rótulo de duas linhas ("Margem
          operacional") desalinhava a altura dos cartões vizinhos. */}
      <div className="flex items-start justify-between gap-2 mb-2 min-h-[2rem]">
        <span className="text-[11px] leading-tight text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      {/* O valor encolhe um passo em tela estreita em vez de ser cortado. Antes
          aparecia "R$ 123.266,7" — dinheiro truncado é pior que fonte menor. */}
      <p className={cn(
        'text-lg lg:text-xl font-bold tabular-nums leading-tight whitespace-nowrap',
        positivo === false ? 'text-red-400' : positivo === true ? 'text-green-400' : '',
      )}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{sub}</p>}
    </div>
  );

  return (
    <DashboardLayout title="Financeiro" hideFilters>
      <FinanceiroNav />

      {/* Esta tela soma transação pendente junto com as revisadas. É escolha —
          o fechamento quer o retrato completo do mês —, mas até aqui era uma
          escolha muda, e o Caixa fazia o oposto sem ninguém saber. */}
      <AvisoRevisao inicio={primeiroDia(ano, mes)} fim={ultimoDia(ano, mes)} modo="inclui" />

      {/* seletor de mês */}
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
        <Button variant="outline" size="sm" onClick={exportar} disabled={!kpis || loading}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!loading && kpis && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            {/* A ordem é a da conta: entrou, saiu, sobrou, e o quanto isso
                representa. Antes o Resultado vinha em segundo, ANTES dos custos
                que o produziram — a tela pedia para acreditar num total antes de
                mostrar as parcelas.

                Em duas colunas o agrupamento ainda ajuda: os dois fatos do
                extrato em cima, as duas conclusões embaixo.

                Um cartão de receita, não dois. "Bruta" e "líquida" mostravam o
                MESMO número lado a lado — `receitaLiquida = receitaBruta` —, o
                que sugere uma distinção que o extrato não tem. */}
            <KPICard
              label="Entrou na conta"
              value={formatCurrency(kpis.receitaBruta)}
              sub="categorias de receita"
              icon={DollarSign}
              positivo={kpis.receitaBruta > 0}
            />
            <KPICard
              label="Saiu da conta"
              value={formatCurrency(kpis.totalCustos)}
              sub={kpis.gastoAds > 0
                ? `${formatCurrency(kpis.gastoAds)} em anúncios`
                : 'custos operacionais'}
              icon={TrendingDown}
              positivo={false}
            />
            <KPICard
              label="Resultado"
              value={formatCurrency(kpis.resultado)}
              sub="o que sobrou no mês"
              icon={TrendingUp}
              positivo={kpis.resultado > 0}
            />
            <KPICard
              label="Margem operacional"
              value={`${kpis.margemOperacional.toFixed(1)}%`}
              sub="resultado sobre o que entrou"
              icon={Percent}
              positivo={kpis.margemOperacional >= 20}
            />
            {/* ROAS, CPL e leads saíram: não são dado de conta bancária. Quem
                mede retorno de anúncio é o Meta Ads e o Criativos Meta, com a
                atribuição de verdade.
                O gasto com anúncios virou subtítulo do total de custos: ele é
                PARTE do total, não um irmão dele. Como quinto cartão sobrava
                sozinho na segunda linha e sugeria ser outra grandeza. */}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            {/* gráfico custos por categoria */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Custos por categoria</p>
              {custosCat.length === 0
                ? <p className="text-xs text-muted-foreground">Sem dados no período</p>
                : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={custosCat} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                      <XAxis type="number" tickFormatter={v => formatCurrency(v).replace('R$ ', '')} tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="categoria" width={130} tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(v: number) => [formatCurrency(v), 'Total']}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                        {custosCat.map((_, i) => <Cell key={i} fill={CORES_BARRA[i % CORES_BARRA.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </div>

            {/* comparativo mensal */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Comparativo 6 meses</p>
              {historico.length === 0
                ? <p className="text-xs text-muted-foreground">Sem dados</p>
                : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={historico} margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="receitaBruta" name="Receita" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="totalCustos"  name="Custos"  fill="#f97316" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </div>
          </div>

          {/* tabela comparativo */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Mês</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Receita bruta</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total custos</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Margem %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {historico.map((row, i) => (
                  <tr key={i} className={cn('hover:bg-muted/20 transition-colors', i === historico.length - 1 && 'font-semibold')}>
                    <td className="px-4 py-3 capitalize">{row.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-400">{formatCurrency(row.receitaBruta)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-400">{formatCurrency(row.totalCustos)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums', row.margem >= 20 ? 'text-green-400' : 'text-yellow-400')}>
                      {row.margem.toFixed(1)}%
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
