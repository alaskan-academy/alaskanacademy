import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
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
  return new Date(yyyy, mm, 0).toISOString().slice(0, 10);
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
  receitaLiquida: number;
  totalCustos: number;
  margemOperacional: number;
  gastoAds: number;
  roas: number;
  custoLead: number;
  leads: number;
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

    const [payt, trans, metrics] = await Promise.all([
      supabase
        .from('vendas_payt')
        .select('valor')
        .gte('data', inicio)
        .lte('data', fim)
        .eq('status', 'approved'),
      supabase
        .from('transacoes')
        .select('valor,categoria')
        .gte('data', inicio)
        .lte('data', fim)
        .neq('categoria', 'Anúncios (Facebook ADs)'),
      supabase
        .from('metricas_diarias')
        .select('gasto_ads,receita,leads')
        .gte('data', inicio)
        .lte('data', fim),
    ]);

    if (payt.error || trans.error || metrics.error) {
      toast({ title: 'Erro ao carregar dados', variant: 'destructive' });
    }

    const receitaBruta  = (payt.data  || []).reduce((s, r) => s + Number(r.valor || 0), 0);
    const receitaLiquida= receitaBruta;
    const totalCustos   = (trans.data || []).filter(t => t.valor < 0).reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
    const gastoAds      = (metrics.data || []).reduce((s, r) => s + Number(r.gasto_ads || 0), 0);
    const leads         = (metrics.data || []).reduce((s, r) => s + Number(r.leads    || 0), 0);
    const receitaAds    = (metrics.data || []).reduce((s, r) => s + Number(r.receita  || 0), 0);
    const roas          = gastoAds > 0 ? receitaAds / gastoAds : 0;
    const custoLead     = leads   > 0 ? gastoAds  / leads     : 0;
    const lucro         = receitaLiquida - totalCustos;
    const margem        = receitaLiquida > 0 ? (lucro / receitaLiquida) * 100 : 0;

    setKpis({ receitaBruta, receitaLiquida, totalCustos, margemOperacional: margem, gastoAds, roas, custoLead, leads });

    // custos por categoria
    const catMap = new Map<string, number>();
    for (const t of (trans.data || [])) {
      if (t.valor >= 0) continue;
      const k = t.categoria || 'Sem categoria';
      catMap.set(k, (catMap.get(k) || 0) + Math.abs(Number(t.valor)));
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
        const [p2, t2] = await Promise.all([
          supabase.from('vendas_payt').select('valor').gte('data', d0).lte('data', d1).eq('status', 'approved'),
          supabase.from('transacoes').select('valor').gte('data', d0).lte('data', d1).neq('categoria', 'Anúncios (Facebook ADs)'),
        ]);
        const rb = (p2.data || []).reduce((s, r) => s + Number(r.valor || 0), 0);
        const rl = rb;
        const tc = (t2.data || []).filter(t => t.valor < 0).reduce((s, t) => s + Math.abs(Number(t.valor)), 0);
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
      ['Receita Bruta', kpis.receitaBruta.toFixed(2)],
      ['Receita Líquida', kpis.receitaLiquida.toFixed(2)],
      ['Total de Custos', kpis.totalCustos.toFixed(2)],
      ['Margem Operacional (%)', kpis.margemOperacional.toFixed(1)],
      ['Gasto Ads', kpis.gastoAds.toFixed(2)],
      ['ROAS', kpis.roas.toFixed(2)],
      ['CPL', kpis.custoLead.toFixed(2)],
      ['Leads', kpis.leads.toString()],
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
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className={cn('text-xl font-bold tabular-nums', positivo === false ? 'text-red-400' : positivo === true ? 'text-green-400' : '')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <DashboardLayout title="Financeiro">
      <FinanceiroNav />

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <KPICard label="Receita bruta" value={formatCurrency(kpis.receitaBruta)} icon={DollarSign} positivo={kpis.receitaBruta > 0} />
            <KPICard label="Receita líquida" value={formatCurrency(kpis.receitaLiquida)} icon={TrendingUp} positivo={kpis.receitaLiquida > 0} />
            <KPICard label="Total de custos" value={formatCurrency(kpis.totalCustos)} icon={TrendingDown} positivo={false} />
            <KPICard
              label="Margem operacional"
              value={`${kpis.margemOperacional.toFixed(1)}%`}
              icon={Percent}
              positivo={kpis.margemOperacional >= 20}
            />
            <KPICard label="Gasto ads" value={formatCurrency(kpis.gastoAds)} sub="UTMify" icon={Target} />
            <KPICard label="ROAS" value={`${kpis.roas.toFixed(2)}x`} sub="receita / gasto ads" icon={Zap} positivo={kpis.roas >= 3} />
            <KPICard label="Custo por lead (CPL)" value={formatCurrency(kpis.custoLead)} icon={Target} />
            <KPICard label="Leads gerados" value={kpis.leads.toLocaleString('pt-BR')} sub="UTMify" icon={TrendingUp} />
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
