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
import { TesteFunil, Funil } from '../types';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  teste?: TesteFunil | null;
  funis: Funil[];
  presetFunilId?: string;
}

const TIPOS = [
  { value: 'funil_novo',  label: 'Funil novo', desc: 'Validando o funil inteiro como conceito' },
  { value: 'ab_interno',  label: 'A/B interno', desc: 'Testando variações dentro de um funil existente' },
];

const VENCEDORES = [
  { value: 'a',            label: 'Variante A venceu' },
  { value: 'b',            label: 'Variante B venceu' },
  { value: 'inconclusivo', label: 'Inconclusivo' },
];

export function TesteModal({ open, onClose, onSaved, teste, funis, presetFunilId }: Props) {
  const [saving, setSaving] = useState(false);
  const [funilId, setFunilId]         = useState('');
  const [titulo, setTitulo]           = useState('');
  const [tipo, setTipo]               = useState<'funil_novo' | 'ab_interno'>('ab_interno');
  const [varianteA, setVarianteA]     = useState('');
  const [varianteB, setVarianteB]     = useState('');
  const [metrica, setMetrica]         = useState('');
  const [resultadoA, setResultadoA]   = useState('');
  const [resultadoB, setResultadoB]   = useState('');
  const [vencedor, setVencedor]       = useState('');
  const [validado, setValidado]       = useState(false);
  const [dataInicio, setDataInicio]   = useState('');
  const [dataFim, setDataFim]         = useState('');
  const [notas, setNotas]             = useState('');

  useEffect(() => {
    if (!open) return;
    setFunilId(teste?.funil_id ?? presetFunilId ?? '');
    setTitulo(teste?.titulo ?? '');
    setTipo((teste?.tipo ?? 'ab_interno') as 'funil_novo' | 'ab_interno');
    setVarianteA(teste?.variante_a ?? '');
    setVarianteB(teste?.variante_b ?? '');
    setMetrica(teste?.metrica ?? '');
    setResultadoA(teste?.resultado_a ?? '');
    setResultadoB(teste?.resultado_b ?? '');
    setVencedor(teste?.vencedor ?? '');
    setValidado(teste?.validado ?? false);
    setDataInicio(teste?.data_inicio ?? '');
    setDataFim(teste?.data_fim ?? '');
    setNotas(teste?.notas ?? '');
  }, [open, teste, presetFunilId]);

  async function handleSave() {
    if (!funilId) {
      toast({ title: 'Selecione um funil', variant: 'destructive' });
      return;
    }
    if (!titulo.trim()) {
      toast({ title: 'Título é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      funil_id:    funilId,
      titulo:      titulo.trim(),
      tipo,
      variante_a:  varianteA.trim() || null,
      variante_b:  varianteB.trim() || null,
      metrica:     metrica.trim() || null,
      resultado_a: resultadoA.trim() || null,
      resultado_b: resultadoB.trim() || null,
      vencedor:    vencedor || null,
      validado,
      data_inicio: dataInicio || null,
      data_fim:    dataFim || null,
      notas:       notas.trim() || null,
      updated_at:  new Date().toISOString(),
    };

    let error;
    if (teste) {
      ({ error } = await supabase.from('testes_funis').update(payload).eq('id', teste.id));
    } else {
      ({ error } = await supabase.from('testes_funis').insert(payload));
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: teste ? 'Teste atualizado' : 'Teste registrado' });
    onSaved();
    onClose();
  }

  const emAndamento = !dataFim;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{teste ? 'Editar teste' : 'Registrar teste'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Tipo */}
          <div>
            <Label className="mb-2 block">Tipo de teste</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTipo(t.value as typeof tipo)}
                  className={cn(
                    'text-left px-3 py-2.5 rounded-lg border text-sm transition-colors',
                    tipo === t.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  <div className="font-medium text-xs mb-0.5">{t.label}</div>
                  <div className="text-[10px] opacity-70 leading-snug">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Funil *</Label>
            <Select value={funilId} onValueChange={setFunilId}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue placeholder="Selecionar funil" />
              </SelectTrigger>
              <SelectContent>
                {funis.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Título do teste *</Label>
            <Input
              className="mt-1"
              placeholder='Ex: "VSL longa vs curta", "Headline A vs B"'
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Variante A {tipo === 'funil_novo' ? '(controle)' : ''}</Label>
              <Textarea
                className="mt-1 h-16 resize-none text-sm"
                placeholder="Descreva a variante A..."
                value={varianteA}
                onChange={e => setVarianteA(e.target.value)}
              />
            </div>
            <div>
              <Label>Variante B {tipo === 'funil_novo' ? '(challenger)' : ''}</Label>
              <Textarea
                className="mt-1 h-16 resize-none text-sm"
                placeholder="Descreva a variante B..."
                value={varianteB}
                onChange={e => setVarianteB(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Métrica principal</Label>
            <Input
              className="mt-1 h-8 text-sm"
              placeholder="Ex: Taxa de conversão, CPA, AOV..."
              value={metrica}
              onChange={e => setMetrica(e.target.value)}
            />
          </div>

          {/* Resultados */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Resultado A</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: 3,2% conv."
                value={resultadoA}
                onChange={e => setResultadoA(e.target.value)}
              />
            </div>
            <div>
              <Label>Resultado B</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Ex: 4,1% conv."
                value={resultadoB}
                onChange={e => setResultadoB(e.target.value)}
              />
            </div>
          </div>

          {/* Vencedor */}
          {(resultadoA || resultadoB) && (
            <div>
              <Label className="mb-2 block">Vencedor</Label>
              <div className="flex gap-2">
                {VENCEDORES.map(v => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => setVencedor(prev => prev === v.value ? '' : v.value)}
                    className={cn(
                      'flex-1 px-2 py-1.5 rounded border text-xs font-medium transition-colors',
                      vencedor === v.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40',
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de início</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-sm"
                value={dataInicio}
                onChange={e => setDataInicio(e.target.value)}
              />
            </div>
            <div>
              <Label>Data de fim</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-sm"
                value={dataFim}
                onChange={e => setDataFim(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Notas</Label>
            <Textarea
              className="mt-1 h-20 resize-none text-sm"
              placeholder="Contexto, hipóteses, conclusões..."
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          {!emAndamento && (
            <div className="flex items-center gap-2">
              <Switch id="teste-validado" checked={validado} onCheckedChange={setValidado} />
              <label htmlFor="teste-validado" className="text-sm cursor-pointer select-none">
                Resultado validado (aprovado para escalar/manter)
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : teste ? 'Salvar' : 'Registrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
