import { useState, useEffect, useCallback } from 'react';
import { Settings2, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

type Opcao = { id: string; valor: string; ordem: number };

interface Props {
  campo: string;
  label: string;
  onAtualizar: () => void;
}

export function GerenciarOpcoesPopover({ campo, label, onAtualizar }: Props) {
  const { toast } = useToast();
  const [open, setOpen]           = useState(false);
  const [opcoes, setOpcoes]       = useState<Opcao[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState('');
  const [novoValor, setNovoValor] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('criativo_campos_opcoes')
      .select('id,valor,ordem')
      .eq('campo', campo)
      .order('ordem');
    setOpcoes(data ?? []);
  }, [campo]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const startEdit = (o: Opcao) => { setEditingId(o.id); setEditingVal(o.valor); };
  const cancelEdit = () => { setEditingId(null); setEditingVal(''); };

  const saveEdit = async (o: Opcao) => {
    const v = editingVal.trim();
    if (!v || v === o.valor) { cancelEdit(); return; }
    const { error } = await supabase.from('criativo_campos_opcoes').update({ valor: v }).eq('id', o.id);
    if (error) { toast({ title: 'Erro ao salvar', variant: 'destructive' }); return; }
    cancelEdit();
    load();
    onAtualizar();
  };

  const deleteOpcao = async (o: Opcao) => {
    if (!confirm(`Excluir "${o.valor}"?`)) return;
    await supabase.from('criativo_campos_opcoes').delete().eq('id', o.id);
    load();
    onAtualizar();
  };

  const addOpcao = async () => {
    const v = novoValor.trim();
    if (!v) return;
    const maxOrdem = opcoes.reduce((m, o) => Math.max(m, o.ordem), -1);
    const { error } = await supabase.from('criativo_campos_opcoes')
      .insert({ campo, valor: v, ordem: maxOrdem + 1 });
    if (error) {
      toast({ title: error.code === '23505' ? 'Opção já existe' : 'Erro', variant: 'destructive' });
      return;
    }
    setNovoValor('');
    load();
    onAtualizar();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Gerenciar opções de ${label}`}
          className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start" side="bottom">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        </div>
        <div className="max-h-52 overflow-y-auto divide-y divide-border/50">
          {opcoes.map(o => (
            <div key={o.id} className="flex items-center gap-1.5 px-2 py-1">
              {editingId === o.id ? (
                <>
                  <Input
                    autoFocus
                    className="h-6 text-xs flex-1 px-1.5"
                    value={editingVal}
                    onChange={e => setEditingVal(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEdit(o);
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <button onClick={() => saveEdit(o)} className="text-green-400 hover:text-green-300">
                    <Check className="h-3 w-3" />
                  </button>
                  <button onClick={cancelEdit} className="text-muted-foreground/60 hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs flex-1 truncate">{o.valor}</span>
                  <button onClick={() => startEdit(o)} className="text-muted-foreground/30 hover:text-foreground transition-colors">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button onClick={() => deleteOpcao(o)} className="text-muted-foreground/30 hover:text-red-400 transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border">
          <Input
            className="h-6 text-xs flex-1 px-1.5"
            placeholder="Nova opção..."
            value={novoValor}
            onChange={e => setNovoValor(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addOpcao(); }}
          />
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={addOpcao} disabled={!novoValor.trim()}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
