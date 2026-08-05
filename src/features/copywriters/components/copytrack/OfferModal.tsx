import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { CopyOffer } from '@/features/copywriters/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  offer?: CopyOffer | null;
}

export function OfferModal({ open, onClose, onSaved, offer }: Props) {
  const [saving, setSaving] = useState(false);
  const [name, setName]               = useState(offer?.name ?? '');
  const [niche, setNiche]             = useState(offer?.niche ?? '');
  const [status, setStatus]           = useState(offer?.status ?? 'acompanhando');
  const [adLibraryUrl, setAdLibraryUrl] = useState(offer?.ad_library_url ?? '');
  const [pageUrl, setPageUrl]         = useState(offer?.page_url ?? '');
  const [notes, setNotes]             = useState(offer?.notes ?? '');

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: 'Nome da oferta é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      name:           name.trim(),
      niche:          niche.trim() || null,
      status:         status,
      ad_library_url: adLibraryUrl.trim() || null,
      page_url:       pageUrl.trim() || null,
      notes:          notes.trim() || null,
    };

    let error;
    if (offer) {
      ({ error } = await supabase.from('copytrack_offers').update(payload).eq('id', offer.id));
    } else {
      ({ error } = await supabase.from('copytrack_offers').insert(payload));
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: offer ? 'Oferta atualizada' : 'Oferta criada' });
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{offer ? 'Editar oferta' : 'Nova oferta para acompanhar'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label>Nome da oferta *</Label>
            <Input
              className="mt-1"
              placeholder="Ex: Produto X da Marca Y..."
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nicho</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: Saúde, Finanças..."
                value={niche}
                onChange={e => setNiche(e.target.value)}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acompanhando">Acompanhando</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="pausado">Pausado</SelectItem>
                  <SelectItem value="arquivado">Arquivado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>URL da Biblioteca de Anúncios</Label>
            <Input
              className="mt-1 h-8 text-sm"
              placeholder="https://..."
              value={adLibraryUrl}
              onChange={e => setAdLibraryUrl(e.target.value)}
            />
          </div>

          <div>
            <Label>URL da Página</Label>
            <Input
              className="mt-1 h-8 text-sm"
              placeholder="https://..."
              value={pageUrl}
              onChange={e => setPageUrl(e.target.value)}
            />
          </div>

          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1 h-20 resize-none text-sm"
              placeholder="Observações, estratégias identificadas..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : offer ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
