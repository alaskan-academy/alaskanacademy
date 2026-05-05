import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { formatNumber, formatPercent } from '@/lib/formatters';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend,
} from 'recharts';

type MonthPreset = 'this' | 'last' | 'custom';

function ymToDateRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const endDate = new Date(y, m, 0);
  const end = `${ym}-${String(endDate.getDate()).padStart(2, '0')}`;
  return { start, end };
}

function currentYM(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function DesempenhoTab() {
  const [editores, setEditores] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEditor, setFilterEditor] = useState('all');
  const [filterOferta, setFilterOferta] = useState('all');
  const [monthPreset, setMonthPreset] = useState<MonthPreset>('this');
  const [customStart, setCustomStart] = useState(currentYM(-2));
  const [customEnd, setCustomEnd] = useState(currentYM(0));

  const load = async () => {
    setLoading(true);
    const [e, d] = await Promise.all([
      supabase.from('editores').select('id, nome').order('nome'),
      supabase.from('avaliacoes_criativos').select('*').order('mes_referencia', { ascending: false }),
    ]);
    setEditores(e.data || []);
    setItems(d.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const editorMap = Object.fromEntries(editores.map(x => [x.id, x.nome]));
  const ofertas = useMemo(() => Array.from(new Set(items.map(i => i.oferta).filter(Boolean))), [items]);

  const { startStr, endStr } = useMemo(() => {
    if (monthPreset === 'this') {
      const r = ymToDateRange(currentYM(0));
      return { startStr: r.start, endStr: r.end };
    }
    if (monthPreset === 'last') {
      const r = ymToDateRange(currentYM(-1));
      return { startStr: r.start, endStr: r.end };
    }
    const s = ymToDateRange(customStart).start;
    const e = ymToDateRange(customEnd).end;
    return { startStr: s, endStr: e };
  }, [monthPreset, customStart, customEnd]);

  const filtered = useMemo(() => items.filter(i => {
    if (!i.mes_referencia) return false;
    const d = String(i.mes_referencia).slice(0, 10);
    if (d < startStr || d > endStr) return false;
    if (filterEditor !== 'all' && i.editor_id !== filterEditor) return false;
    if (filterOferta !== 'all' && i.oferta !== filterOferta) return false;
    return true;
  }), [items, startStr, endStr, filterEditor, filterOferta]);

  const totals = useMemo(() => {
    const t = filtered.reduce((acc, i) => {
      acc.testados += Number(i.ads_testados || 0);
      acc.validados += Number(i.ads_validados || 0);
      return acc;
    }, { testados: 0, validados: 0 });
    return { ...t, taxa: t.testados > 0 ? (t.validados / t.testados) * 100 : 0 };
  }, [filtered]);

  const porEditor = useMemo(() => {
    const map: Record<string, { nome: string; testados: number; validados: number; projetos: Set<string> }> = {};
    filtered.forEach(i => {
      const key = i.editor_id || 'sem-editor';
      const nome = editorMap[i.editor_id] || '—';
      if (!map[key]) map[key] = { nome, testados: 0, validados: 0, projetos: new Set() };
      map[key].testados += Number(i.ads_testados || 0);
      map[key].validados += Number(i.ads_validados || 0);
      if (i.oferta) map[key].projetos.add(i.oferta);
    });
    return Object.values(map).map(v => ({
      ...v,
      taxa: v.testados > 0 ? (v.validados / v.testados) * 100 : 0,
      projetos: v.projetos.size,
    })).sort((a, b) => b.taxa - a.taxa);
  }, [filtered, editorMap]);

  const porProjeto = useMemo(() => {
    const map: Record<string, { oferta: string; testados: number; validados: number }> = {};
    filtered.forEach(i => {
      const oferta = i.oferta || '—';
      if (!map[oferta]) map[oferta] = { oferta, testados: 0, validados: 0 };
      map[oferta].testados += Number(i.ads_testados || 0);
      map[oferta].validados += Number(i.ads_validados || 0);
    });
    return Object.values(map).map(v => ({
      ...v, taxa: v.testados > 0 ? (v.validados / v.testados) * 100 : 0,
    })).sort((a, b) => b.taxa - a.taxa);
  }, [filtered]);

  const evolucao = useMemo(() => {
    const map: Record<string, { mes: string; testados: number; validados: number }> = {};
    filtered.forEach(i => {
      const mes = String(i.mes_referencia).slice(0, 7);
      if (!map[mes]) map[mes] = { mes, testados: 0, validados: 0 };
      map[mes].testados += Number(i.ads_testados || 0);
      map[mes].validados += Number(i.ads_validados || 0);
    });
    return Object.values(map)
      .map(v => ({ ...v, taxa: v.testados > 0 ? (v.validados / v.testados) * 100 : 0 }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-card border border-border rounded-lg p-4 flex items-end gap-3 flex-wrap">
        <div>
          <Label className="text-xs">Período</Label>
          <Select value={monthPreset} onValueChange={(v: MonthPreset) => setMonthPreset(v)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="this">Este mês</SelectItem>
              <SelectItem value="last">Mês passado</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {monthPreset === 'custom' && (
          <>
            <div>
              <Label className="text-xs">De</Label>
              <Input type="month" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="month" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-[160px]" />
            </div>
          </>
        )}
        <div>
          <Label className="text-xs">Editor</Label>
          <Select value={filterEditor} onValueChange={setFilterEditor}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos editores</SelectItem>
              {editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Projeto</Label>
          <Select value={filterOferta} onValueChange={setFilterOferta}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos projetos</SelectItem>
              {ofertas.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase">Total ADs testados</p>
          <p className="text-2xl font-semibold mt-1">{formatNumber(totals.testados)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase">Total ADs validados</p>
          <p className="text-2xl font-semibold mt-1">{formatNumber(totals.validados)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase">Taxa de validação</p>
          <p className="text-2xl font-semibold mt-1">{formatPercent(totals.taxa)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-sm font-medium mb-3">Assertividade média por editor</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porEditor}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="nome" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any) => formatPercent(Number(v))} />
              <Bar dataKey="taxa" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-sm font-medium mb-3">Taxa média de assertividade por projeto</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porProjeto}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="oferta" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any) => formatPercent(Number(v))} />
              <Bar dataKey="taxa" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 lg:col-span-2">
          <h4 className="text-sm font-medium mb-3">Evolução da assertividade ao longo do tempo</h4>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={evolucao}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any) => formatPercent(Number(v))} />
              <Legend />
              <Line type="monotone" dataKey="taxa" name="Taxa de validação" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela: Assertividade por editor */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border"><h4 className="text-sm font-medium">Assertividade por editor</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground uppercase">
              <th className="text-left px-3 py-2">Editor</th>
              <th className="text-left px-3 py-2">Projetos</th>
              <th className="text-left px-3 py-2">Ads testados</th>
              <th className="text-left px-3 py-2">Ads validados</th>
              <th className="text-left px-3 py-2">Taxa</th>
            </tr></thead>
            <tbody>
              {porEditor.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-3 py-2 font-medium">{r.nome}</td>
                  <td className="px-3 py-2">{r.projetos}</td>
                  <td className="px-3 py-2">{formatNumber(r.testados)}</td>
                  <td className="px-3 py-2">{formatNumber(r.validados)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.taxa >= 20 ? 'bg-emerald-500/10 text-emerald-500' : r.taxa >= 10 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>
                      {formatPercent(r.taxa)}
                    </span>
                  </td>
                </tr>
              ))}
              {porEditor.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{loading ? 'Carregando...' : 'Sem dados'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
