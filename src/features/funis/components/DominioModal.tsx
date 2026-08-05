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
import { Dominio, Funil } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  dominio?: Dominio | null;
  funis: Funil[];
}

export function DominioModal({ open, onClose, onSaved, dominio, funis }: Props) {
  const [saving, setSaving] = useState(false);
  const [nome, setNome]             = useState('');
  const [funilId, setFunilId]       = useState('');
  const [ativo, setAtivo]           = useState(true);
  const [vencimento, setVencimento] = useState('');
  const [registrador, setRegistrador] = useState('');
  const [notas, setNotas]           = useState('');

  useEffect(() => {
    if (!open) return;
    setNome(dominio?.nome ?? '');
    setFunilId(dominio?.funil_id ?? '');
    setAtivo(dominio?.ativo ?? true);
    setVencimento(dominio?.vencimento ?? '');
    setRegistrador(dominio?.registrador ?? '');
    setNotas(dominio?.notas ?? '');
  }, [open, dominio]);

  async function handleSave() {
    if (!nome.trim()) {
      toast({ title: 'Nome do domínio é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      nome:        nome.trim().toLowerCase(),
      funil_id:    funilId || null,
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

  const funisAtivos = funis.filter(f => f.ativo || f.status !== 'arquivado');

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

          <div>
            <Label>Funil vinculado</Label>
            <Select value={funilId} onValueChange={setFunilId}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue placeholder="Nenhum (domínio independente)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none_">Nenhum (independente)</SelectItem>
                {funisAtivos.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
