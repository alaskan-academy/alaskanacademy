import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Funil, Projeto, FunilSuboferta, Dominio } from '../types';
import { GerenciarOpcoesPopover } from '@/features/producao/components/GerenciarOpcoesPopover';

function formatPreco(raw: string): string {
  const num = parseFloat(raw.replace(',', '.'));
  if (isNaN(num)) return raw;
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SubTipo = 'upsell' | 'orderbump' | 'checkout';
type SubItem = { id?: string; nome: string; tipo: SubTipo; preco: string; link: string };

/* ─── SubList fora do modal para manter referência estável (evita remount em inputs) ─── */
interface SubListProps {
  tipo: SubTipo;
  subofertas: SubItem[];
  onAdd: (tipo: SubTipo) => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: keyof SubItem, value: string) => void;
}

function SubList({ tipo, subofertas, onAdd, onRemove, onUpdate }: SubListProps) {
  const isCheckout = tipo === 'checkout';
  const isUp = tipo === 'upsell';
  const items = subofertas.map((s, idx) => ({ s, idx })).filter(({ s }) => s.tipo === tipo);

  const accentCls = isCheckout
    ? 'border-emerald-500/30 bg-emerald-500/5'
    : isUp
      ? 'border-violet-500/30 bg-violet-500/5'
      : 'border-blue-500/30 bg-blue-500/5';

  const label = isCheckout ? 'Preços e Links de Checkout' : isUp ? 'Upsells' : 'Order Bumps';
  const nomePlaceholder = isCheckout
    ? 'Descrição (ex: À vista, 12x R$97...)'
    : isUp ? 'Nome do upsell...' : 'Nome do order bump...';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground px-2"
          onClick={() => onAdd(tipo)}
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
                  placeholder={nomePlaceholder}
                  value={s.nome}
                  onChange={e => onUpdate(idx, 'nome', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground shrink-0">R$</span>
                  <Input
                    className="h-7 text-sm"
                    placeholder="0,00"
                    value={s.preco}
                    onChange={e => onUpdate(idx, 'preco', e.target.value)}
                    onBlur={() => onUpdate(idx, 'preco', s.preco ? formatPreco(s.preco) : s.preco)}
                  />
                </div>
                <Input
                  className="h-7 text-sm"
                  placeholder="Link checkout..."
                  value={s.link}
                  onChange={e => onUpdate(idx, 'link', e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  funil?: Funil | null;
  projetos: Projeto[];
  funilSubofertas: FunilSuboferta[];
  dominios: Dominio[];
}

export function FunilModal({ open, onClose, onSaved, funil, projetos, funilSubofertas, dominios }: Props) {
  const { user } = useAuth();
  const [saving, setSaving]             = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [nome, setNome]           = useState('');
  const [ofertaId, setOfertaId]   = useState('');
  const [status, setStatus]       = useState<'planejado' | 'ativo' | 'pausado' | 'pausado_analise' | 'arquivado'>('ativo');
  const [urlPage, setUrlPage]     = useState('');
  const [dominioId, setDominioId] = useState('');
  const [notas, setNotas]         = useState('');
  const [ativo, setAtivo]         = useState(true);
  const [subofertas, setSubofertas] = useState<SubItem[]>([]);

  // Método de venda
  const [metodo, setMetodo]       = useState('');
  const [opMetodos, setOpMetodos] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;

    setNome(funil?.nome ?? '');
    setOfertaId(funil?.oferta_id ?? '');
    setMetodo(funil?.metodo ?? '');
    setStatus((funil?.status ?? 'ativo') as typeof status);
    setUrlPage(funil?.url_page ?? '');
    setNotas(funil?.notas ?? '');
    setAtivo(funil?.ativo ?? true);
    setConfirmDelete(false);

    const dominioAtual = dominios.find(d => d.funil_id === funil?.id);
    setDominioId(dominioAtual?.id ?? '');

    // Subofertas existentes
    const existing: SubItem[] = funil
      ? funilSubofertas
          .filter(fs => fs.funil_id === funil.id)
          .map(fs => ({
            id:    fs.id,
            nome:  fs.nome ?? '',
            tipo:  (fs.tipo ?? 'upsell') as SubTipo,
            preco: fs.preco != null ? formatPreco(String(fs.preco)) : '',
            link:  fs.link ?? '',
          }))
      : [];

    // Migração legada: se funil tem preco/link_checkout mas ainda sem checkout suboferta
    const hasCheckout = existing.some(s => s.tipo === 'checkout');
    if (!hasCheckout && funil && (funil.preco != null || funil.link_checkout)) {
      existing.unshift({
        nome:  '',
        tipo:  'checkout',
        preco: funil.preco != null ? formatPreco(String(funil.preco)) : '',
        link:  funil.link_checkout ?? '',
      });
    }
    setSubofertas(existing);

    // Carregar opções de método de venda da mesma tabela do Funil de Vendas
    supabase.from('criativo_campos_opcoes')
      .select('valor')
      .eq('campo', 'funil_video')
      .order('ordem')
      .then(({ data }) => {
        setOpMetodos(data?.map(d => d.valor as string) ?? []);
      });

  }, [open, funil, funilSubofertas, dominios]);

  /* ── Subofertas ── */
  function addSub(tipo: SubTipo) {
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

    // Sincroniza primeiro checkout com colunas legadas (compatibilidade com outras páginas)
    const firstCheckout = subofertas.find(s => s.tipo === 'checkout');
    const payload: Record<string, unknown> = {
      nome:          nome.trim(),
      oferta_id:     ofertaId || null,
      metodo:        metodo || null,
      status,
      preco:         firstCheckout?.preco ? parseFloat(firstCheckout.preco.replace(',', '.')) : null,
      link_checkout: firstCheckout?.link?.trim() || null,
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
          funil_id:  funilId,
          oferta_id: null,
          nome:      s.nome.trim() || null,
          tipo:      s.tipo,
          preco:     s.preco ? parseFloat(s.preco.replace(',', '.')) : null,
          link:      s.link.trim() || null,
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

  async function handleDuplicate() {
    if (!funil) return;
    setSaving(true);
    const firstCheckout = subofertas.find(s => s.tipo === 'checkout');
    const res = await supabase.from('funis').insert({
      nome:          `${nome.trim()} (cópia)`,
      oferta_id:     ofertaId || null,
      metodo:        metodo || null,
      status:        'planejado',
      preco:         firstCheckout?.preco ? parseFloat(firstCheckout.preco.replace(',', '.')) : null,
      link_checkout: firstCheckout?.link?.trim() || null,
      url_page:      urlPage.trim() || null,
      notas:         notas.trim() || null,
      ativo:         true,
      criado_por:    user?.id,
    }).select('id').single();
    if (res.error || !res.data) {
      toast({ title: 'Erro ao duplicar', description: res.error?.message, variant: 'destructive' });
      setSaving(false);
      return;
    }
    if (subofertas.length > 0) {
      await supabase.from('funil_subofertas').insert(
        subofertas.map(s => ({
          funil_id:  res.data.id,
          oferta_id: null,
          nome:      s.nome.trim() || null,
          tipo:      s.tipo,
          preco:     s.preco ? parseFloat(s.preco.replace(',', '.')) : null,
          link:      s.link.trim() || null,
        })),
      );
    }
    setSaving(false);
    toast({ title: 'Funil duplicado com sucesso' });
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

  const dominiosDisponiveis = dominios.filter(d => d.ativo);

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

          {/* Projeto + Status */}
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
              <Label>Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planejado">Em planejamento</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="pausado">Pausado</SelectItem>
                  <SelectItem value="pausado_analise">Pausado p/ análise</SelectItem>
                  <SelectItem value="arquivado">Arquivado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Método de venda — mesmo visual do Funil de Vendas + gerenciar */}
          <div>
            <Label>Método de venda</Label>
            <div className="flex items-center gap-1 mt-1">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-8 text-sm flex-1 flex items-center px-3 rounded-md border border-input bg-background hover:bg-accent transition-colors text-left min-w-0"
                  >
                    {metodo
                      ? <span className="truncate">{metodo}</span>
                      : <span className="text-muted-foreground text-sm">—</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-2" align="start">
                  {opMetodos.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-1">
                      Nenhum método. Clique em ⚙ para adicionar.
                    </p>
                  ) : (
                    opMetodos.map(v => (
                      <div
                        key={v}
                        className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted cursor-pointer"
                        onClick={() => setMetodo(v === metodo ? '' : v)}
                      >
                        <Checkbox
                          checked={v === metodo}
                          onCheckedChange={() => setMetodo(v === metodo ? '' : v)}
                        />
                        <span className="text-xs">{v}</span>
                      </div>
                    ))
                  )}
                </PopoverContent>
              </Popover>
              <GerenciarOpcoesPopover
                campo="funil_video"
                label="Métodos de Venda"
                onAtualizar={() =>
                  supabase.from('criativo_campos_opcoes')
                    .select('valor')
                    .eq('campo', 'funil_video')
                    .order('ordem')
                    .then(({ data }) => setOpMetodos(data?.map(d => d.valor as string) ?? []))
                }
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

          {/* URL da landing page */}
          <div>
            <Label>URL da landing page</Label>
            <Input
              className="mt-1 h-8 text-sm"
              placeholder="https://..."
              value={urlPage}
              onChange={e => setUrlPage(e.target.value)}
            />
          </div>

          {/* Preços e Checkouts */}
          <SubList tipo="checkout" subofertas={subofertas} onAdd={addSub} onRemove={removeSub} onUpdate={updateSub} />

          {/* Order Bumps — acima de upsells */}
          <SubList tipo="orderbump" subofertas={subofertas} onAdd={addSub} onRemove={removeSub} onUpdate={updateSub} />

          {/* Upsells */}
          <SubList tipo="upsell" subofertas={subofertas} onAdd={addSub} onRemove={removeSub} onUpdate={updateSub} />

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
              <div className="flex items-center gap-1 mr-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={handleDuplicate}
                  disabled={saving}
                >
                  Duplicar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Excluir funil
                </Button>
              </div>
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
