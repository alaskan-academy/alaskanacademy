import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ChevronDown, X, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Dominio, Funil, Projeto } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  dominio?: Dominio | null;
  funis: Funil[];
  projetos: Projeto[];
}

export function DominioModal({ open, onClose, onSaved, dominio, funis, projetos }: Props) {
  const projetoMap = Object.fromEntries(projetos.map(p => [p.id, p]));
  const [saving, setSaving] = useState(false);
  const [nome, setNome]               = useState('');
  const [funilIds, setFunilIds]       = useState<string[]>([]);
  const [ativo, setAtivo]             = useState(true);
  const [vencimento, setVencimento]   = useState('');
  const [registrador, setRegistrador] = useState('');
  const [notas, setNotas]             = useState('');
  const [dropOpen, setDropOpen]       = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setNome(dominio?.nome ?? '');
    const ids = dominio?.funil_ids?.length
      ? dominio.funil_ids
      : dominio?.funil_id ? [dominio.funil_id] : [];
    setFunilIds(ids);
    setAtivo(dominio?.ativo ?? true);
    setVencimento(dominio?.vencimento ?? '');
    setRegistrador(dominio?.registrador ?? '');
    setNotas(dominio?.notas ?? '');
    setDropOpen(false);
  }, [open, dominio]);

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function toggleFunil(id: string) {
    setFunilIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSave() {
    if (!nome.trim()) {
      toast({ title: 'Nome do domínio é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      nome:        nome.trim().toLowerCase(),
      funil_id:    funilIds[0] ?? null,
      funil_ids:   funilIds,
      ativo,
      vencimento:  vencimento || null,
      registrador: registrador.trim() || null,
      notas:       notas.trim() || null,
      updated_at:  new Date().toISOString(),
    };

    let error;
    if (dominio) {
      ({ error } = await supabase.from('dominios').update(payload).eq('id', dominio.id));
    } else {
      ({ error } = await supabase.from('dominios').insert(payload));
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: dominio ? 'Domínio atualizado' : 'Domínio adicionado' });
    onSaved();
    onClose();
  }

  const funisAtivos = funis.filter(f => f.ativo && f.status !== 'arquivado');
  const funilMap    = Object.fromEntries(funis.map(f => [f.id, f]));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{dominio ? 'Editar domínio' : 'Novo domínio'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label>Domínio *</Label>
            <Input
              className="mt-1 font-mono text-sm"
              placeholder="exemplo.com.br"
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

          {/* Multiselect funis */}
          <div>
            <Label>Funis vinculados</Label>
            <div className="relative mt-1" ref={dropRef}>
              <button
                type="button"
                onClick={() => setDropOpen(v => !v)}
                className={cn(
                  'w-full min-h-[2rem] flex flex-wrap items-center gap-1 px-2 py-1 rounded-md border border-input bg-background text-sm text-left',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {funilIds.length === 0 ? (
                  <span className="text-muted-foreground text-xs py-0.5">Nenhum (domínio independente)</span>
                ) : (
                  funilIds.map(id => {
                    const f = funilMap[id];
                    return f ? (
                      <span key={id} className="inline-flex items-center gap-0.5 bg-muted rounded px-1.5 py-0.5 text-[11px]">
                        {f.nome}
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); toggleFunil(id); }}
                          className="ml-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ) : null;
                  })
                )}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
              </button>

              {dropOpen && (
                <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                  {funisAtivos.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum funil ativo</p>
                  ) : (
                    funisAtivos.map(f => {
                      const proj    = f.oferta_id ? projetoMap[f.oferta_id] : null;
                      const checked = funilIds.includes(f.id);
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => toggleFunil(f.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60 text-left"
                        >
                          <span className={cn('h-3.5 w-3.5 rounded-sm border border-input flex items-center justify-center shrink-0', checked && 'bg-primary border-primary')}>
                            {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                          </span>
                          <span className="flex-1 truncate">{f.nome}</span>
                          {proj && <span className="text-[11px] text-muted-foreground shrink-0">· {proj.nome}</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vencimento</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-sm"
                value={vencimento}
                onChange={e => setVencimento(e.target.value)}
              />
            </div>
            <div>
              <Label>Registrador</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Registro.br, GoDaddy..."
                value={registrador}
                onChange={e => setRegistrador(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1 h-16 resize-none text-sm"
              placeholder="Observações..."
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="dom-ativo" checked={ativo} onCheckedChange={setAtivo} />
            <label htmlFor="dom-ativo" className="text-sm cursor-pointer select-none">
              Domínio ativo
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : dominio ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
