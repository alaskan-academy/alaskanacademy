import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Opcao = { id: string; campo: string; valor: string; ordem: number };

const CAMPOS: { key: string; label: string }[] = [
  { key: 'formato',           label: 'Formato' },
  { key: 'plataforma',        label: 'Plataforma' },
  { key: 'tipo_teste',        label: 'Tipo de Teste' },
  { key: 'nivel_consciencia', label: 'Nível de Consciência' },
];

export function ConfiguracaoProducaoTab() {
  const { toast } = useToast();
  const [opcoes, setOpcoes]   = useState<Opcao[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState('');
  // new item per campo
  const [novoValor, setNovoValor] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('criativo_campos_opcoes')
      .select('*')
      .order('campo')
      .order('ordem');
    setOpcoes(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (o: Opcao) => {
    setEditingId(o.id);
    setEditingVal(o.valor);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingVal('');
  };

  const saveEdit = async (o: Opcao) => {
    const trimmed = editingVal.trim();
    if (!trimmed || trimmed === o.valor) { cancelEdit(); return; }
    const { error } = await supabase
      .from('criativo_campos_opcoes')
      .update({ valor: trimmed })
      .eq('id', o.id);
    if (error) {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    } else {
      toast({ title: 'Salvo' });
      cancelEdit();
      load();
    }
  };

  const deleteOpcao = async (o: Opcao) => {
    if (!confirm(`Excluir a opção "${o.valor}"?`)) return;
    const { error } = await supabase
      .from('criativo_campos_opcoes')
      .delete()
      .eq('id', o.id);
    if (error) {
      toast({ title: 'Erro ao excluir', variant: 'destructive' });
    } else {
      load();
    }
  };

  const addOpcao = async (campo: string) => {
    const trimmed = (novoValor[campo] ?? '').trim();
    if (!trimmed) return;
    const existentes = opcoes.filter(o => o.campo === campo);
    const maxOrdem = existentes.reduce((m, o) => Math.max(m, o.ordem), -1);
    const { error } = await supabase
      .from('criativo_campos_opcoes')
      .insert({ campo, valor: trimmed, ordem: maxOrdem + 1 });
    if (error) {
      toast({
        title: error.code === '23505' ? 'Opção já existe' : 'Erro ao adicionar',
        variant: 'destructive',
      });
    } else {
      setNovoValor(prev => ({ ...prev, [campo]: '' }));
      load();
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>;
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-1">Opções dos campos de seleção</h3>
        <p className="text-xs text-muted-foreground">
          Gerencie as opções disponíveis nos campos de seleção dos criativos.
          Visível apenas para admins.
        </p>
      </div>

      {CAMPOS.map(({ key, label }) => {
        const items = opcoes.filter(o => o.campo === key);
        return (
          <div key={key} className="space-y-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>

            <div className="border border-border rounded-lg divide-y divide-border">
              {items.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">Nenhuma opção cadastrada.</p>
              )}
              {items.map(o => (
                <div key={o.id} className="flex items-center gap-2 px-3 py-1.5">
                  {editingId === o.id ? (
                    <>
                      <Input
                        autoFocus
                        className="h-7 text-xs flex-1"
                        value={editingVal}
                        onChange={e => setEditingVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit(o);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                      <button
                        onClick={() => saveEdit(o)}
                        className="text-green-400 hover:text-green-300 transition-colors"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs flex-1">{o.valor}</span>
                      <button
                        onClick={() => startEdit(o)}
                        className="text-muted-foreground/50 hover:text-foreground transition-colors p-0.5"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => deleteOpcao(o)}
                        className="text-muted-foreground/50 hover:text-red-400 transition-colors p-0.5"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              ))}

              {/* Add new */}
              <div className={cn('flex items-center gap-2 px-3 py-1.5', items.length > 0 && 'border-t border-border/50')}>
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="Nova opção..."
                  value={novoValor[key] ?? ''}
                  onChange={e => setNovoValor(prev => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addOpcao(key); }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => addOpcao(key)}
                  disabled={!(novoValor[key] ?? '').trim()}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
