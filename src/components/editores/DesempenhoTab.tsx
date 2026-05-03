import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNumber, formatPercent } from '@/lib/formatters';

export function DesempenhoTab() {
  const [editores, setEditores] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEditor, setFilterEditor] = useState('all');
  const [filterOferta, setFilterOferta] = useState('all');

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

  const filtered = items.filter(i =>
    (filterEditor === 'all' || i.editor_id === filterEditor) &&
    (filterOferta === 'all' || i.oferta === filterOferta)
  );

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

  const porEditorProjeto = useMemo(() => {
    const map: Record<string, { editor: string; oferta: string; testados: number; validados: number }> = {};
    filtered.forEach(i => {
      const editor = editorMap[i.editor_id] || '—';
      const oferta = i.oferta || '—';
      const k = `${editor}__${oferta}`;
      if (!map[k]) map[k] = { editor, oferta, testados: 0, validados: 0 };
      map[k].testados += Number(i.ads_testados || 0);
      map[k].validados += Number(i.ads_validados || 0);
    });
    return Object.values(map).map(v => ({
      ...v, taxa: v.testados > 0 ? (v.validados / v.testados) * 100 : 0,
    })).sort((a, b) => b.taxa - a.taxa);
  }, [filtered, editorMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterEditor} onValueChange={setFilterEditor}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Editor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos editores</SelectItem>
              {editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterOferta} onValueChange={setFilterOferta}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Oferta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ofertas</SelectItem>
              {ofertas.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Dados consolidados a partir de <strong>Avaliar criativo</strong>.</p>
      </div>

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

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border"><h4 className="text-sm font-medium">Assertividade por editor × projeto</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground uppercase">
              <th className="text-left px-3 py-2">Editor</th>
              <th className="text-left px-3 py-2">Projeto</th>
              <th className="text-left px-3 py-2">Testados</th>
              <th className="text-left px-3 py-2">Validados</th>
              <th className="text-left px-3 py-2">Taxa</th>
            </tr></thead>
            <tbody>
              {porEditorProjeto.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-3 py-2">{r.editor}</td>
                  <td className="px-3 py-2">{r.oferta}</td>
                  <td className="px-3 py-2">{formatNumber(r.testados)}</td>
                  <td className="px-3 py-2">{formatNumber(r.validados)}</td>
                  <td className="px-3 py-2">{formatPercent(r.taxa)}</td>
                </tr>
              ))}
              {porEditorProjeto.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{loading ? 'Carregando...' : 'Sem dados'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border"><h4 className="text-sm font-medium">Registros</h4></div>
        {loading ? <div className="p-6 text-center text-muted-foreground">Carregando...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground uppercase">
                <th className="text-left px-3 py-2">Mês</th>
                <th className="text-left px-3 py-2">Empresa</th>
                <th className="text-left px-3 py-2">Oferta</th>
                <th className="text-left px-3 py-2">Editor</th>
                <th className="text-left px-3 py-2">Testados</th>
                <th className="text-left px-3 py-2">Validados</th>
                <th className="text-left px-3 py-2">Taxa</th>
              </tr></thead>
              <tbody>
                {filtered.map(i => (
                  <tr key={i.id} className="border-b border-border/50">
                    <td className="px-3 py-2">{i.mes_referencia ? String(i.mes_referencia).slice(0, 7) : '—'}</td>
                    <td className="px-3 py-2">{i.empresa || '—'}</td>
                    <td className="px-3 py-2">{i.oferta || '—'}</td>
                    <td className="px-3 py-2">{editorMap[i.editor_id] || '—'}</td>
                    <td className="px-3 py-2">{i.ads_testados}</td>
                    <td className="px-3 py-2">{i.ads_validados}</td>
                    <td className="px-3 py-2">{formatPercent(Number(i.taxa_assertividade || (i.ads_testados > 0 ? (i.ads_validados / i.ads_testados) * 100 : 0)))}</td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem registros</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
