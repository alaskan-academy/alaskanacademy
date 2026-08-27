import { hoje } from '@/lib/datas';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RichTextEditor } from '@/components/RichTextEditor';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export interface RotinaCard {
  id: string;
  titulo: string;
  data_inicio: string;
  data_fim: string;
  notas: object;
  cor: string;
  criado_por: string | null;
  recorrencia_tipo: string | null;
  recorrencia_dias_semana: number[] | null;
  recorrencia_fim: string | null;
  recorrencia_pai_id: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  userId: string;
  card?: RotinaCard | null;
  defaultDate?: string;
}

const CORES = [
  { value: 'blue',   label: 'Azul',    cls: 'bg-blue-500' },
  { value: 'violet', label: 'Violeta', cls: 'bg-violet-500' },
  { value: 'emerald',label: 'Verde',   cls: 'bg-emerald-500' },
  { value: 'amber',  label: 'Amarelo', cls: 'bg-amber-500' },
  { value: 'rose',   label: 'Rosa',    cls: 'bg-rose-500' },
  { value: 'cyan',   label: 'Ciano',   cls: 'bg-cyan-500' },
];

const DIAS_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function RotinaCardModal({ open, onClose, onSaved, userId, card, defaultDate }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const today = defaultDate ?? hoje();

  // Initialized directly from props — the parent forces remount (key prop) on each open,
  // so these initial values are always fresh. Tiptap only reads content on mount,
  // so we must not rely on useEffect to set notas after mount.
  const [titulo, setTitulo]   = useState(card?.titulo ?? '');
  const [inicio, setInicio]   = useState(card?.data_inicio ?? today);
  const [fim, setFim]         = useState(card?.data_fim ?? today);
  const [notas, setNotas]     = useState<object>(card?.notas ?? {});
  const [cor, setCor]         = useState(card?.cor ?? 'blue');
  const [recTipo, setRecTipo] = useState(card?.recorrencia_tipo ?? 'none');
  const [recDias, setRecDias] = useState<number[]>(card?.recorrencia_dias_semana ?? []);
  const [recFim, setRecFim]   = useState(card?.recorrencia_fim ?? '');

  const toggleDia = (d: number) =>
    setRecDias(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());

  const handleSave = async () => {
    if (!titulo.trim()) {
      toast({ title: 'Título obrigatório', variant: 'destructive' });
      return;
    }
    if (fim < inicio) {
      toast({ title: 'Data fim não pode ser antes do início', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      titulo: titulo.trim(),
      data_inicio: inicio,
      data_fim: fim,
      notas,
      cor,
      criado_por: userId,
      recorrencia_tipo: recTipo === 'none' ? null : recTipo,
      recorrencia_dias_semana: recTipo === 'semanal' && recDias.length > 0 ? recDias : null,
      recorrencia_fim: recTipo !== 'none' && recFim ? recFim : null,
    };

    let error;
    if (card) {
      ({ error } = await supabase.from('copy_rotina_cards').update(payload).eq('id', card.id));
    } else {
      ({ error } = await supabase.from('copy_rotina_cards').insert(payload));
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: card ? 'Card atualizado' : 'Card criado' });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{card ? 'Editar card' : 'Novo card de rotina'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Título */}
          <div>
            <Label>Título *</Label>
            <Input
              className="mt-1"
              placeholder="Nome da tarefa..."
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
            />
          </div>

          {/* Datas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data início</Label>
              <Input type="date" className="mt-1" value={inicio}
                onChange={e => { setInicio(e.target.value); if (fim < e.target.value) setFim(e.target.value); }} />
            </div>
            <div>
              <Label>Data fim</Label>
              <Input type="date" className="mt-1" value={fim} min={inicio}
                onChange={e => setFim(e.target.value)} />
            </div>
          </div>

          {/* Cor */}
          <div>
            <Label className="mb-2 block">Cor</Label>
            <div className="flex gap-2">
              {CORES.map(c => (
                <button key={c.value} type="button" title={c.label}
                  onClick={() => setCor(c.value)}
                  className={cn('w-6 h-6 rounded-full transition-all', c.cls,
                    cor === c.value ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground' : 'opacity-60 hover:opacity-100'
                  )} />
              ))}
            </div>
          </div>

          {/* Recorrência */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Recorrência</Label>
            <Select value={recTipo} onValueChange={setRecTipo}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem recorrência</SelectItem>
                <SelectItem value="diario">Diária</SelectItem>
                <SelectItem value="semanal">Semanal (dias específicos)</SelectItem>
                <SelectItem value="mensal">Mensal (mesmo dia)</SelectItem>
              </SelectContent>
            </Select>

            {recTipo === 'semanal' && (
              <div className="flex gap-1.5 flex-wrap">
                {DIAS_LABELS.map((d, i) => (
                  <button key={i} type="button"
                    onClick={() => toggleDia(i)}
                    className={cn(
                      'px-2.5 py-1 rounded text-[11px] font-medium transition-colors border',
                      recDias.includes(i)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50',
                    )}
                  >{d}</button>
                ))}
              </div>
            )}

            {recTipo !== 'none' && (
              <div>
                <Label className="text-xs text-muted-foreground">Repetir até</Label>
                <Input type="date" className="mt-1 h-8 text-xs" value={recFim} min={inicio}
                  onChange={e => setRecFim(e.target.value)} />
              </div>
            )}
          </div>

          {/* Notas */}
          <div>
            <Label className="mb-2 block">Notas</Label>
            <RichTextEditor content={notas} onChange={setNotas} minHeight="140px" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : card ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
