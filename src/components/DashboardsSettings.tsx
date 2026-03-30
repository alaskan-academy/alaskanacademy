import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Copy, Check, Pencil, Trash2, Link2, Settings2 } from 'lucide-react';

interface Funil {
  id: string;
  nome: string;
  produto: string;
  payt_key: string;
  ativo: boolean;
  criado_em: string;
}

interface AdAccount {
  id: string;
  account_id: string;
  nome: string;
  ativo: boolean;
  funil_id: string | null;
}

const PRODUTOS = [
  { value: 'velas', label: 'Velas' },
  { value: 'saponaria', label: 'Saponaria' },
  { value: 'cosmeticos', label: 'Cosméticos' },
  { value: 'hormonal', label: 'Hormonal' },
  { value: 'velaroma', label: 'Velaroma' },
];

const prodBadge: Record<string, string> = {
  velas: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  saponaria: 'bg-green-500/20 text-green-400 border-green-500/30',
  cosmeticos: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  hormonal: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  velaroma: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const SUPABASE_URL = 'https://prtkfwwqpcziexgipoqk.supabase.co';

export default function DashboardsSettings() {
  const [funis, setFunis] = useState<Funil[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editFunil, setEditFunil] = useState<Funil | null>(null);
  const [webhookFunil, setWebhookFunil] = useState<Funil | null>(null);
  const [casFunil, setCasFunil] = useState<Funil | null>(null);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [copied, setCopied] = useState(false);

  // Form state
  const [formNome, setFormNome] = useState('');
  const [formProduto, setFormProduto] = useState('velas');
  const [formPaytKey, setFormPaytKey] = useState('');
  const [formAtivo, setFormAtivo] = useState(true);

  // Created funil (to show webhook URL after creation)
  const [createdFunil, setCreatedFunil] = useState<Funil | null>(null);

  const fetchFunis = async () => {
    setLoading(true);
    const { data } = await supabase.from('funis').select('*').order('criado_em', { ascending: false });
    setFunis(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchFunis(); }, []);

  const resetForm = () => {
    setFormNome('');
    setFormProduto('');
    setFormPaytKey('');
    setFormAtivo(true);
  };

  const handleCreate = async () => {
    if (!formNome.trim()) {
      toast({ title: 'Nome é obrigatório', variant: 'destructive' });
      return;
    }
    const { data, error } = await supabase.from('funis').insert({
      nome: formNome.trim(),
      produto: formProduto,
      payt_key: formPaytKey.trim() || null,
      ativo: formAtivo,
    }).select().single();

    if (error) {
      toast({ title: 'Erro ao criar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Dashboard criado!' });
    setCreateOpen(false);
    setCreatedFunil(data);
    setWebhookFunil(data);
    resetForm();
    fetchFunis();
  };

  const handleEdit = async () => {
    if (!editFunil) return;
    const { error } = await supabase.from('funis').update({
      nome: formNome.trim(),
      produto: formProduto,
      payt_key: formPaytKey.trim() || null,
      ativo: formAtivo,
    }).eq('id', editFunil.id);

    if (error) {
      toast({ title: 'Erro ao atualizar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Dashboard atualizado!' });
    setEditFunil(null);
    resetForm();
    fetchFunis();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este dashboard?')) return;
    const { error } = await supabase.from('funis').delete().eq('id', id);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Dashboard excluído!' });
    fetchFunis();
  };

  const handleToggleAtivo = async (funil: Funil) => {
    await supabase.from('funis').update({ ativo: !funil.ativo }).eq('id', funil.id);
    fetchFunis();
  };

  const openEdit = (funil: Funil) => {
    setFormNome(funil.nome);
    setFormProduto(funil.produto);
    setFormPaytKey(funil.payt_key || '');
    setFormAtivo(funil.ativo);
    setEditFunil(funil);
  };

  const openCAs = async (funil: Funil) => {
    setCasFunil(funil);
    const { data } = await supabase.from('ad_accounts').select('id,account_id,nome,ativo,funil_id');
    setAdAccounts(data || []);
  };

  const toggleCA = async (ca: AdAccount, funil: Funil) => {
    const isLinked = ca.funil_id === funil.id && ca.ativo;
    await supabase.from('ad_accounts').update({
      funil_id: isLinked ? null : funil.id,
      ativo: !isLinked,
    }).eq('id', ca.id);
    // Refresh
    const { data } = await supabase.from('ad_accounts').select('id,account_id,nome,ativo,funil_id');
    setAdAccounts(data || []);
  };

  const webhookUrl = (funilId: string) => `${SUPABASE_URL}/functions/v1/payt-webhook/${funilId}`;

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">Dashboards (Funis)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Gerencie seus funis de venda e webhooks</p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Criar Dashboard
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Carregando...</div>
      ) : funis.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground text-sm">Nenhum dashboard criado ainda</p>
          <Button size="sm" className="mt-3" onClick={() => { resetForm(); setCreateOpen(true); }}>
            Criar primeiro dashboard
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {funis.map((f) => (
            <div key={f.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{f.nome}</span>
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize', prodBadge[f.produto] || '')}>
                      {f.produto}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">ID: {f.id.slice(0, 8)}...</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={f.ativo} onCheckedChange={() => handleToggleAtivo(f)} />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWebhookFunil(f)} title="Ver webhook URL">
                  <Link2 className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openCAs(f)} title="Gerenciar CAs">
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(f)} title="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(f.id)} title="Excluir">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Dashboard</DialogTitle>
          </DialogHeader>
          <FunilForm
            nome={formNome} setNome={setFormNome}
            produto={formProduto} setProduto={setFormProduto}
            paytKey={formPaytKey} setPaytKey={setFormPaytKey}
            ativo={formAtivo} setAtivo={setFormAtivo}
            onSubmit={handleCreate}
            submitLabel="Criar"
          />
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={!!editFunil} onOpenChange={(o) => { if (!o) { setEditFunil(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Dashboard</DialogTitle>
          </DialogHeader>
          <FunilForm
            nome={formNome} setNome={setFormNome}
            produto={formProduto} setProduto={setFormProduto}
            paytKey={formPaytKey} setPaytKey={setFormPaytKey}
            ativo={formAtivo} setAtivo={setFormAtivo}
            onSubmit={handleEdit}
            submitLabel="Salvar"
          />
        </DialogContent>
      </Dialog>

      {/* Webhook URL Modal */}
      <Dialog open={!!webhookFunil} onOpenChange={(o) => { if (!o) setWebhookFunil(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook URL — {webhookFunil?.nome}</DialogTitle>
          </DialogHeader>
          {webhookFunil && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Cole esta URL nas configurações da Payt para receber vendas neste funil:
              </p>
              <div className="bg-secondary rounded-lg p-3 text-xs font-mono text-foreground break-all">
                {webhookUrl(webhookFunil.id)}
              </div>
              <Button size="sm" className="w-full gap-2" onClick={() => copyUrl(webhookUrl(webhookFunil.id))}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copiado!' : 'Copiar URL'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Manage CAs Modal */}
      <Dialog open={!!casFunil} onOpenChange={(o) => { if (!o) setCasFunil(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerenciar CAs — {casFunil?.nome}</DialogTitle>
          </DialogHeader>
          {casFunil && (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {adAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma conta de anúncio encontrada</p>
              ) : (
                adAccounts.map((ca) => {
                  const isLinked = ca.funil_id === casFunil.id && ca.ativo;
                  return (
                    <div key={ca.id} className="flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{ca.nome || ca.account_id}</div>
                        <div className="text-xs text-muted-foreground">{ca.account_id}</div>
                      </div>
                      <Switch
                        checked={isLinked}
                        onCheckedChange={() => toggleCA(ca, casFunil)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FunilForm({
  nome, setNome, produto, setProduto, paytKey, setPaytKey, ativo, setAtivo, onSubmit, submitLabel,
}: {
  nome: string; setNome: (v: string) => void;
  produto: string; setProduto: (v: string) => void;
  paytKey: string; setPaytKey: (v: string) => void;
  ativo: boolean; setAtivo: (v: boolean) => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground">Nome</label>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Velas Perfeitas" className="mt-1" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Produto</label>
        <Input value={produto} onChange={(e) => setProduto(e.target.value)} placeholder="Ex: Velas, Saponaria, Cosméticos..." className="mt-1" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Integration Key da Payt</label>
        <Input value={paytKey} onChange={(e) => setPaytKey(e.target.value)} placeholder="Cole a integration_key da Payt" className="mt-1" />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-sm text-foreground">Ativo</label>
        <Switch checked={ativo} onCheckedChange={setAtivo} />
      </div>
      <Button onClick={onSubmit} className="w-full">{submitLabel}</Button>
    </div>
  );
}
