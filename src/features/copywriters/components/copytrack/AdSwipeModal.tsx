import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { CopyAdSwipe } from '@/features/copywriters/types';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const FORMATS = ['VSL', 'UGC', 'Imagem', 'Depoimento', 'Carrossel', 'Texto'];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  ad?: CopyAdSwipe | null;
}

export function AdSwipeModal({ open, onClose, onSaved, ad }: Props) {
  const [saving, setSaving] = useState(false);
  const [adCode, setAdCode]         = useState(ad?.ad_code ?? '');
  const [title, setTitle]           = useState(ad?.title ?? '');
  const [niche, setNiche]           = useState(ad?.niche ?? '');
  const [format, setFormat]         = useState(ad?.format ?? '');
  const [headline, setHeadline]     = useState(ad?.headline ?? '');
  const [body, setBody]             = useState(ad?.body ?? '');
  const [cta, setCta]               = useState(ad?.cta ?? '');
  const [angle, setAngle]           = useState(ad?.angle ?? '');
  const [hookType, setHookType]     = useState(ad?.hook_type ?? '');
  const [notes, setNotes]           = useState(ad?.notes ?? '');
  /*
    Interno ou externo, escolhido à mão.

    O padrão é 'interno' porque é o uso majoritário hoje (30 dos 35), e porque
    ad externo se cadastra olhando para o anúncio do outro — momento em que
    trocar o botão é parte de prestar atenção nele.

    NÃO adivinho pelo "AD xxx" do título. Essa regra rodou uma vez, na
    migration que classificou os 35 existentes, e ficou lá: mantê-la viva aqui
    criaria uma segunda fonte para a mesma resposta, esperando divergir no
    primeiro ad que fuja do padrão de nome.
  */
  const [source, setSource] = useState<'interno' | 'externo'>(ad?.source ?? 'interno');
  const [isValidated, setIsValidated] = useState(ad?.is_validated ?? false);
  const [isFavorite, setIsFavorite]   = useState(ad?.is_favorite ?? false);

  async function handleSave() {
    if (!headline.trim() && !title.trim()) {
      toast({ title: 'Headline ou título é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      ad_code:      adCode.trim() || null,
      title:        title.trim() || null,
      niche:        niche.trim() || null,
      format:       format || null,
      headline:     headline.trim() || null,
      body:         body.trim() || null,
      cta:          cta.trim() || null,
      angle:        angle.trim() || null,
      hook_type:    hookType.trim() || null,
      notes:        notes.trim() || null,
      source,
      is_validated: isValidated,
      is_favorite:  isFavorite,
    };

    let error;
    if (ad) {
      ({ error } = await supabase.from('copytrack_ad_swipe').update(payload).eq('id', ad.id));
    } else {
      ({ error } = await supabase.from('copytrack_ad_swipe').insert(payload));
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: ad ? 'Ad atualizado' : 'Ad criado' });
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ad ? 'Editar ad' : 'Novo ad swipe'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/*
            A origem vem primeiro porque muda o sentido de tudo abaixo: num ad
            interno, "headline" é o que escrevemos; num externo, é o que o
            outro escreveu e estamos guardando.
          */}
          <div>
            <Label>Origem</Label>
            <div className="mt-1 flex w-fit items-center gap-1 rounded-lg bg-secondary p-1">
              {(['interno', 'externo'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSource(v)}
                  className={cn(
                    // Sem `capitalize`: os rótulos ja vem escritos, e a classe virava
                    // "Externo (De Terceiro)".
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    source === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'interno' ? 'Interno (nosso)' : 'Externo (de terceiro)'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Código do ad</Label>
              <Input
                className="mt-1 h-8 text-sm font-mono"
                placeholder="Ex: AD-001"
                value={adCode}
                onChange={e => setAdCode(e.target.value)}
              />
            </div>
            <div>
              <Label>Nicho</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: Saúde, Finanças..."
                value={niche}
                onChange={e => setNiche(e.target.value)}
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
                  onClick={() => setFormat(prev => prev === f ? '' : f)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                    format === f
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

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
            <Label>Headline *</Label>
            <Textarea
              className="mt-1 h-16 resize-none text-sm"
              placeholder="Texto principal do anúncio..."
              value={headline}
              onChange={e => setHeadline(e.target.value)}
            />
          </div>

          <div>
            <Label>Título (alternativo)</Label>
            <Input
              className="mt-1 h-8 text-sm"
              placeholder="Nome descritivo do ad..."
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div>
            <Label>Corpo (body)</Label>
            <Textarea
              className="mt-1 min-h-[100px] resize-none text-sm"
              placeholder="Texto completo do anúncio..."
              value={body}
              onChange={e => setBody(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>CTA</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: Saiba mais, Compre agora..."
                value={cta}
                onChange={e => setCta(e.target.value)}
              />
            </div>
            <div>
              <Label>Ângulo</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: Transformação, Prova social..."
                value={angle}
                onChange={e => setAngle(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1 h-16 resize-none text-sm"
              placeholder="Observações, contexto, motivo de salvar..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox id="ad-validated" checked={isValidated} onCheckedChange={v => setIsValidated(Boolean(v))} />
              <label htmlFor="ad-validated" className="text-sm cursor-pointer select-none">Validado</label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ad-fav" checked={isFavorite} onCheckedChange={v => setIsFavorite(Boolean(v))} />
              <label htmlFor="ad-fav" className="text-sm flex items-center gap-1.5 cursor-pointer select-none">
                <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                Favorito
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : ad ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
