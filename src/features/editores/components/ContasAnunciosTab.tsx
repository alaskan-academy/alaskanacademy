import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Conta = {
  id: string;
  account_id: string;
  nome: string;
  produto_payt: string | null;
  ativo: boolean;
  roas_meta: number | null;
  cpa_meta: number | null;
};

export function ContasAnunciosTab() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [metas, setMetas] = useState<Record<string, { roas: string; cpa: string }>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('ad_accounts')
      .select('id, account_id, nome, produto_payt, ativo, roas_meta, cpa_meta')
      .order('nome');
    setContas(data || []);
    const initial: Record<string, string> = {};
    const metasIniciais: Record<string, { roas: string; cpa: string }> = {};
    (data || []).forEach(c => {
      initial[c.id] = c.produto_payt || '';
      metasIniciais[c.id] = {
        roas: c.roas_meta != null ? String(c.roas_meta) : '',
        cpa:  c.cpa_meta  != null ? String(c.cpa_meta)  : '',
      };
    });
    setEdits(initial);
    setMetas(metasIniciais);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async (c: Conta) => {
    setSaving(c.id);
    const m = metas[c.id] ?? { roas: '', cpa: '' };

    // O `.select()` no fim devolve as linhas afetadas. Sem ele, um UPDATE barrado por
    // RLS retorna 200 com zero linhas e o código comemora — foi assim que os parâmetros
    // fiscais e o Caixa passaram meses "salvando" sem gravar.
    const { data, error } = await supabase
      .from('ad_accounts')
      .update({
        produto_payt: edits[c.id] || null,
        // Campo vazio significa "sem meta", não zero: zero seria uma meta impossível
        // de bater e a tela cobraria a conta por ela.
        roas_meta: m.roas.trim() === '' ? null : Number(m.roas.replace(',', '.')),
        cpa_meta:  m.cpa.trim()  === '' ? null : Number(m.cpa.replace(',', '.')),
      })
      .eq('id', c.id)
      .select('id');
    setSaving(null);

    if (error) {
      toast({ title: 'Não salvou', description: error.message, variant: 'destructive' });
    } else if (!data || data.length === 0) {
      toast({
        title: 'Não salvou',
        description: 'Nenhuma linha alterada — provável falta de permissão.',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Salvo' });
    }
  };

  const toggleAtivo = async (c: Conta) => {
    const { error } = await supabase
      .from('ad_accounts')
      .update({ ativo: !c.ativo })
      .eq('id', c.id);
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    else load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Contas de Anúncios</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure o produto Payt de cada conta para atribuição correta de vendas.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground uppercase">
                <th className="px-4 py-2 text-left">Conta (CA)</th>
                <th className="px-4 py-2 text-left">Account ID</th>
                <th className="px-4 py-2 text-left">Produto Payt (nome exato)</th>
                {/* Metas alimentam a página de Tendências. Vazio = sem meta: a tela
                    simplesmente não compara, em vez de assumir um alvo inventado. */}
                <th className="px-4 py-2 text-left">ROAS mín.</th>
                <th className="px-4 py-2 text-left">CPA máx.</th>
                <th className="px-4 py-2 text-center">Ativo</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {contas.map(c => (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="px-4 py-2 font-medium">{c.nome}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.account_id}</td>
                  <td className="px-4 py-2">
                    <Input
                      value={edits[c.id] ?? ''}
                      onChange={e => setEdits(prev => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="ex: Curso Velas Perfeitas 2.0"
                      className="h-8 text-xs w-72"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={metas[c.id]?.roas ?? ''}
                      onChange={e => setMetas(prev => ({
                        ...prev, [c.id]: { ...(prev[c.id] ?? { roas: '', cpa: '' }), roas: e.target.value },
                      }))}
                      placeholder="2,0"
                      inputMode="decimal"
                      className="h-8 w-20 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={metas[c.id]?.cpa ?? ''}
                      onChange={e => setMetas(prev => ({
                        ...prev, [c.id]: { ...(prev[c.id] ?? { roas: '', cpa: '' }), cpa: e.target.value },
                      }))}
                      placeholder="50,00"
                      inputMode="decimal"
                      className="h-8 w-24 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => toggleAtivo(c)}
                      className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                        c.ativo
                          ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                          : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                      }`}
                    >
                      {c.ativo ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={saving === c.id}
                      onClick={() => save(c)}
                    >
                      {saving === c.id ? 'Salvando...' : 'Salvar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-secondary/30 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Como funciona a atribuição de vendas</p>
        <p>O nome do produto deve ser idêntico ao que aparece nos relatórios da Payt (campo "Produto").</p>
        <p>Ao cruzar dados, só são atribuídas vendas onde o <span className="font-mono">utm_content</span> bate com o nome do ad <strong>e</strong> o produto da venda bate com o produto configurado aqui.</p>
        <p>Contas sem produto configurado usarão apenas o nome do ad para atribuição (menos preciso).</p>
      </div>
    </div>
  );
}
