import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Funil, Projeto, FunilSuboferta, Dominio } from '../types';

const METODOS_BASE = ['TSL', 'VSL', 'QUIZ'];

function formatPreco(raw: string): string {
  const num = parseFloat(raw.replace(',', '.'));
  if (isNaN(num)) return raw;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SubItem = { id?: string; nome: string; tipo: 'upsell' | 'orderbump'; preco: string; link: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  funil?: Funil | null;
  projetos: Projeto[];
  funilSubofertas: FunilSuboferta[];
  dominios: Dominio[];
  metodos?: string[];
}

export function FunilModal({ open, onClose, onSaved, funil, projetos, funilSubofertas, dominios, metodos = [] }: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nome, setNome]               = useState('');
  const [ofertaId, setOfertaId]       = useState('');
  const [metodo, setMetodo]           = useState('');
  const [status, setStatus]           = useState<'ativo' | 'pausado' | 'pausado_analise' | 'arquivado'>('ativo');
  const [preco, setPreco]             = useState('');
  const [linkCheckout, setLinkCheckout] = useState('');
  const [urlPage, setUrlPage]         = useState('');
  const [dominioId, setDominioId]     = useState('');
  const [notas, setNotas]             = useState('');
  const [ativo, setAtivo]             = useState(true);
  const [subofertas, setSubofertas]   = useState<SubItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setNome(funil?.nome ?? '');
    setOfertaId(funil?.oferta_id ?? '');
    setMetodo(funil?.metodo ?? '');
    setStatus((funil?.status ?? 'ativo') as typeof status);
    setPreco(funil?.preco != null ? String(funil.preco) : '');
    setLinkCheckout(funil?.link_checkout ?? '');
    setUrlPage(funil?.url_page ?? '');
    setNotas(funil?.notas ?? '');
    setAtivo(funil?.ativo ?? true);
    setConfirmDelete(false);

    const dominioAtual = dominios.find(d => d.funil_id === funil?.id);
    setDominioId(dominioAtual?.id ?? '');

    setSubofertas(
      funil
        ? funilSubofertas
            .filter(fs => fs.funil_id === funil.id)
            .map(fs => ({
              id:    fs.id,
              nome:  fs.nome ?? '',
              tipo:  (fs.tipo ?? 'upsell') as 'upsell' | 'orderbump',
              preco: fs.preco != null ? formatPreco(String(fs.preco)) : '',
              link:  fs.link ?? '',
            }))
        : [],
    );
  }, [open, funil, funilSubofertas, dominios]);

  function addSub(tipo: 'upsell' | 'orderbump') {
    setSubofertas(prev => [...prev, { nome: '', tipo, preco: '', link: '' }]);
  }

  function removeSub(idx: number) {
    setSubofertas(prev => prev.filter((_, i) => i !== idx));
  }

  function updateSub(idx: number, field: keyof SubItem, value: string) {
    setSubofertas(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }

  async function handleSave() {
    if (!nome.trim()) {
      toast({ title: 'Nome do funil é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload: Record<string, unknown> = {
      nome:          nome.trim(),
      oferta_id:     ofertaId || null,
      metodo:        metodo || null,
      status,
      preco:         preco ? parseFloat(preco.replace(',', '.')) : null,
      link_checkout: linkCheckout.trim() || null,
      url_page:      urlPage.trim() || null,
      notas:         notas.trim() || null,
      ativo:         status === 'arquivado' ? false : ativo,
    };

    let funilId = funil?.id;
    let error: { message: string } | null = null;

    if (funil) {
      ({ error } = await supabase.from('funis').update(payload).eq('id', funil.id));
    } else {
      const res = await supabase.from('funis').insert({ ...payload, criado_por: user?.id }).select('id').single();
      error = res.error;
      funilId = res.data?.id;
    }

    if (error || !funilId) {
      toast({ title: 'Erro ao salvar', description: error?.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    // Sync subofertas
    await supabase.from('funil_subofertas').delete().eq('funil_id', funilId);
    if (subofertas.length > 0) {
      await supabase.from('funil_subofertas').insert(
        subofertas.map(s => ({
          funil_id: funilId,
          oferta_id: null,
          nome:     s.nome.trim() || null,
          tipo:     s.tipo,
          preco:    s.preco ? parseFloat(s.preco.replace(',', '.')) : null,
          link:     s.link.trim() || null,
        })),
      );
    }

    // Sync domínio
    if (funil) {
      const prev = dominios.find(d => d.funil_id === funil.id && d.id !== dominioId);
      if (prev) await supabase.from('dominios').update({ funil_id: null }).eq('id', prev.id);
    }
    if (dominioId) await supabase.from('dominios').update({ funil_id: funilId }).eq('id', dominioId);

    setSaving(false);
    toast({ title: funil ? 'Funil atualizado' : 'Funil criado' });
    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!funil) return;
    setSaving(true);
    await supabase.from('funil_subofertas').delete().eq('funil_id', funil.id);
    const { error } = await supabase.from('funis').delete().eq('id', funil.id);
    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Funil excluído' });
    onSaved();
    onClose();
  }

  const allMetodos = [...new Set([...METODOS_BASE, ...metodos])].sort();
  const dominiosDisponiveis = dominios.filter(d => !d.funil_id || d.funil_id === funil?.id);

  const upsells    = subofertas.filter(s => s.tipo === 'upsell');
  const orderbumps = subofertas.filter(s => s.tipo === 'orderbump');

  function SubList({ tipo }: { tipo: 'upsell' | 'orderbump' }) {
    const isUp = tipo === 'upsell';
    const items = subofertas
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.tipo === tipo);
    const accentCls = isUp
      ? 'border-violet-500/30 bg-violet-500/5'
      : 'border-blue-500/30 bg-blue-500/5';

    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs">{isUp ? 'Upsells' : 'Order Bumps'}</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground px-2"
            onClick={() => addSub(tipo)}
          >
            <Plus className="h-3 w-3" />
            Adicionar
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 italic px-0.5">Nenhum cadastrado</p>
        ) : (
          <div className="space-y-2">
            {items.map(({ s, idx }) => (
              <div key={idx} className={cn('rounded-lg border p-2.5 space-y-2', accentCls)}>
                <div className="flex items-center gap-2">
                  <Input
                    className="flex-1 h-7 text-sm"
                    placeholder={isUp ? 'Nome do upsell...' : 'Nome do order bump...'}
                    value={s.nome}
                    onChange={e => updateSub(idx, 'nome', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeSub(idx)}
                    className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className={cn('grid gap-2', isUp ? 'grid-cols-2' : 'grid-cols-1')}>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground shrink-0">R$</span>
                    <Input
                      className="h-7 text-sm"
                      placeholder="0,00"
                      value={s.preco}
                      onChange={e => updateSub(idx, 'preco', e.target.value)}
                      onBlur={() => updateSub(idx, 'preco', s.preco ? formatPreco(s.preco) : s.preco)}
                    />
                  </div>
                  {isUp && (
                    <Input
                      className="h-7 text-sm"
                      placeholder="Link checkout..."
                      value={s.link}
                      onChange={e => updateSub(idx, 'link', e.target.value)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{funil ? 'Editar funil' : 'Novo funil'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Nome */}
          <div>
            <Label>Nome do funil *</Label>
            <Input
              className="mt-1"
              placeholder="Ex: VSL Principal, TSL Tickets..."
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

          {/* Projeto + Método */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Projeto</Label>
              <Select value={ofertaId} onValueChange={setOfertaId}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue placeholder="Selecionar projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">Sem projeto</SelectItem>
                  {projetos.filter(p => p.ativo).map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Método de venda</Label>
              <Input
                list="metodos-datalist"
                className="mt-1 h-8 text-sm"
                placeholder="TSL, VSL, QUIZ..."
                value={metodo}
                onChange={e => setMetodo(e.target.value)}
              />
              <datalist id="metodos-datalist">
                {allMetodos.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
          </div>

          {/* Status + Preço */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="pausado">Pausado</SelectItem>
                  <SelectItem value="pausado_analise">Pausado p/ análise</SelectItem>
                  <SelectItem value="arquivado">Arquivado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Preço (R$)</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="197,00"
                value={preco}
                onChange={e => setPreco(e.target.value)}
                onBlur={() => setPreco(v => v ? formatPreco(v) : v)}
              />
            </div>
          </div>

          {/* Domínio */}
          <div>
            <Label>Domínio</Label>
            <Select value={dominioId} onValueChange={setDominioId}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue placeholder="Selecionar domínio..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_">Sem domínio</SelectItem>
                {dominiosDisponiveis.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* URLs */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label>URL da landing page</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="https://..."
                value={urlPage}
                onChange={e => setUrlPage(e.target.value)}
              />
            </div>
            <div>
              <Label>Link de checkout</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="https://..."
                value={linkCheckout}
                onChange={e => setLinkCheckout(e.target.value)}
              />
            </div>
          </div>

          {/* Upsells */}
          <SubList tipo="upsell" />

          {/* Order Bumps */}
          <SubList tipo="orderbump" />

          {/* Notas */}
          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1 h-20 resize-none text-sm"
              placeholder="Observações sobre este funil..."
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          {/* Toggle visibilidade */}
          {status !== 'arquivado' && (
            <div className="flex items-center gap-2">
              <Switch id="funil-ativo" checked={ativo} onCheckedChange={setAtivo} />
              <label htmlFor="funil-ativo" className="text-sm cursor-pointer select-none">
                Aparece no seletor de funis (barra lateral)
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          {funil && (
            confirmDelete ? (
              <div className="flex items-center gap-2 mr-auto">
                <span className="text-xs text-destructive">Confirmar exclusão?</span>
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={saving}>Excluir</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={saving}>Cancelar</Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Excluir funil
              </Button>
            )
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : funil ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
