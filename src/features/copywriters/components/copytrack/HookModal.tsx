import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { CopyHook } from '@/features/copywriters/types';
import { Star } from 'lucide-react';

const FORMATS = ['VSL', 'UGC', 'Imagem', 'Depoimento', 'Carrossel', 'Texto'];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  hook?: CopyHook | null;
}

export function HookModal({ open, onClose, onSaved, hook }: Props) {
  const [saving, setSaving] = useState(false);
  const [hookText, setHookText]       = useState(hook?.hook_text ?? '');
  const [hookType, setHookType]       = useState(hook?.hook_type ?? '');
  const [objective, setObjective]     = useState(hook?.objective ?? '');
  const [format, setFormat]           = useState<string[]>(hook?.format ?? []);
  const [notes, setNotes]             = useState(hook?.notes ?? '');
  const [isFavorite, setIsFavorite]   = useState(hook?.is_favorite ?? false);

  function toggleFormat(f: string) {
    setFormat(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  async function handleSave() {
    if (!hookText.trim()) {
      toast({ title: 'Texto do hook é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      hook_text:  hookText.trim(),
      hook_type:  hookType.trim() || null,
      objective:  objective.trim() || null,
      format:     format.length > 0 ? format : null,
      notes:      notes.trim() || null,
      is_favorite: isFavorite,
    };

    let error;
    if (hook) {
      ({ error } = await supabase.from('copytrack_hooks').update(payload).eq('id', hook.id));
    } else {
      ({ error } = await supabase.from('copytrack_hooks').insert(payload));
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: hook ? 'Hook atualizado' : 'Hook criado' });
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{hook ? 'Editar hook' : 'Novo hook'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label>Texto do hook *</Label>
            <Textarea
              className="mt-1 min-h-[100px] resize-none"
              placeholder="Escreva o hook aqui..."
              value={hookText}
              onChange={e => setHookText(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo de hook</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: Curiosidade, Dor..."
                value={hookType}
                onChange={e => setHookType(e.target.value)}
              />
            </div>
            <div>
              <Label>Objetivo</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: Conversão, Engajamento..."
                value={objective}
                onChange={e => setObjective(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Formato</Label>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFormat(f)}
                  className={cn(
                    'px-2.5 py-1 rounded text-xs font-medium transition-colors border',
                    format.includes(f)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1 h-16 resize-none text-sm"
              placeholder="Observações opcionais..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="hook-fav"
              checked={isFavorite}
              onCheckedChange={v => setIsFavorite(Boolean(v))}
            />
            <label htmlFor="hook-fav" className="text-sm flex items-center gap-1.5 cursor-pointer select-none">
              <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
              Marcar como favorito
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : hook ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
