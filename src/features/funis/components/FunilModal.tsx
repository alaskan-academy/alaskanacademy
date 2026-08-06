import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Funil, Projeto, SubOferta, FunilSuboferta } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  funil?: Funil | null;
  projetos: Projeto[];
  subOfertas: SubOferta[];
  funilSubofertas: FunilSuboferta[];
}

const TIPO_BADGE: Record<string, string> = {
  upsell:     'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  orderbump:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export function FunilModal({ open, onClose, onSaved, funil, projetos, subOfertas, funilSubofertas }: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [nome, setNome]               = useState('');
  const [ofertaId, setOfertaId]       = useState('');
  const [metodo, setMetodo]           = useState('');
  const [status, setStatus]           = useState<'ativo' | 'pausado' | 'pausado_analise' | 'arquivado'>('ativo');
  const [preco, setPreco]             = useState('');
  const [linkCheckout, setLinkCheckout] = useState('');
  const [notas, setNotas]             = useState('');
  const [ativo, setAtivo]             = useState(true);
  const [selectedSubofertas, setSelectedSubofertas] = useState<{ id: string; preco: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setNome(funil?.nome ?? '');
    setOfertaId(funil?.oferta_id ?? '');
    setMetodo(funil?.metodo ?? '');
    setStatus((funil?.status ?? 'ativo') as 'ativo' | 'pausado' | 'arquivado');
    setPreco(funil?.preco != null ? String(funil.preco) : '');
    setLinkCheckout(funil?.link_checkout ?? '');
    setNotas(funil?.notas ?? '');
    setAtivo(funil?.ativo ?? true);
    if (funil) {
      setSelectedSubofertas(
        funilSubofertas
          .filter(fs => fs.funil_id === funil.id)
          .map(fs => ({ id: fs.oferta_id, preco: fs.preco != null ? String(fs.preco) : '' })),
      );
    } else {
      setSelectedSubofertas([]);
    }
  }, [open, funil, funilSubofertas]);

  function toggleSuboferta(id: string) {
    setSelectedSubofertas(prev => {
      const exists = prev.find(s => s.id === id);
      return exists ? prev.filter(s => s.id !== id) : [...prev, { id, preco: '' }];
    });
  }

  function setSubofertaPreco(id: string, valor: string) {
    setSelectedSubofertas(prev => prev.map(s => s.id === id ? { ...s, preco: valor } : s));
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
      metodo:        metodo.trim() || null,
      status,
      preco:         preco ? parseFloat(preco.replace(',', '.')) : null,
      link_checkout: linkCheckout.trim() || null,
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
    if (selectedSubofertas.length > 0) {
      await supabase.from('funil_subofertas').insert(
        selectedSubofertas.map(s => ({
          funil_id: funilId,
          oferta_id: s.id,
          preco: s.preco ? parseFloat(s.preco.replace(',', '.')) : null,
        })),
      );
    }

    setSaving(false);
    toast({ title: funil ? 'Funil atualizado' : 'Funil criado' });
    onSaved();
    onClose();
  }

  const upsells    = subOfertas.filter(o => o.tipo === 'upsell');
  const orderbumps = subOfertas.filter(o => o.tipo === 'orderbump');
  const subofertaMap = Object.fromEntries(subOfertas.map(o => [o.id, o]));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{funil ? 'Editar funil' : 'Novo funil'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label>Nome do funil *</Label>
            <Input
              className="mt-1"
              placeholder="Ex: VSL Principal, TSL Tickets..."
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

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
                className="mt-1 h-8 text-sm"
                placeholder="VSL, TSL, Carta, Webinar..."
                value={metodo}
                onChange={e => setMetodo(e.target.value)}
              />
            </div>
          </div>

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
              />
            </div>
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

          {/* Upsells */}
          {upsells.length > 0 && (
            <div>
              <Label className="mb-2 block">Upsells neste funil</Label>
              <div className="flex flex-wrap gap-2">
                {upsells.map(o => {
                  const sel = selectedSubofertas.some(s => s.id === o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleSuboferta(o.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                        sel
                          ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                          : 'border-border text-muted-foreground hover:border-violet-500/40',
                      )}
                    >
                      {sel && <X className="h-2.5 w-2.5" />}
                      {o.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Order Bumps */}
          {orderbumps.length > 0 && (
            <div>
              <Label className="mb-2 block">Order Bumps neste funil</Label>
              <div className="flex flex-wrap gap-2">
                {orderbumps.map(o => {
                  const sel = selectedSubofertas.some(s => s.id === o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleSuboferta(o.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                        sel
                          ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                          : 'border-border text-muted-foreground hover:border-blue-500/40',
                      )}
                    >
                      {sel && <X className="h-2.5 w-2.5" />}
                      {o.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preços dos selecionados */}
          {selectedSubofertas.length > 0 && (
            <div>
              <Label className="mb-2 block text-muted-foreground text-xs">Preços neste funil</Label>
              <div className="space-y-2">
                {selectedSubofertas.map(s => {
                  const oferta = subofertaMap[s.id];
                  if (!oferta) return null;
                  return (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full border font-medium shrink-0',
                        oferta.tipo === 'upsell'
                          ? 'border-violet-500/30 text-violet-400 bg-violet-500/10'
                          : 'border-blue-500/30 text-blue-400 bg-blue-500/10',
                      )}>
                        {oferta.tipo === 'upsell' ? '↑' : '●'} {oferta.nome}
                      </span>
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="text-xs text-muted-foreground">R$</span>
                        <Input
                          className="h-7 w-28 text-sm"
                          placeholder="0,00"
                          value={s.preco}
                          onChange={e => setSubofertaPreco(s.id, e.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1 h-20 resize-none text-sm"
              placeholder="Observações sobre este funil..."
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          {status !== 'arquivado' && (
            <div className="flex items-center gap-2">
              <Switch id="funil-ativo" checked={ativo} onCheckedChange={setAtivo} />
              <label htmlFor="funil-ativo" className="text-sm cursor-pointer select-none">
                Visível no filtro do dashboard
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : funil ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
