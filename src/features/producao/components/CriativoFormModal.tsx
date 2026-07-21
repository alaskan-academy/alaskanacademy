import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { getDefaultFase, TIPOS_LABEL } from './constants';
import type { CriativoTipo, Funil, Perfil } from './types';

const FORMATOS = ['Carrossel', 'Vídeo', 'Estático'];
const PLATAFORMAS = ['Meta Ads', 'TikTok', 'YouTube'];
const TIPOS_TESTE = ['Hook', 'Copy', 'Ângulo', 'Oferta', 'Formato', 'Outro'];
const NIVEIS_CONSCIENCIA = [
  'Inconsciente',
  'Consciente do Problema',
  'Consciente da Solução',
  'Consciente do Produto',
  'Totalmente Consciente',
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  userId: string;
  funis: Funil[];
  perfis: Perfil[];
  defaultDate?: string;
}

const EMPTY = {
  nome: '', tipo: 'criativo' as CriativoTipo,
  funil_id: '', responsavel_id: '',
  formato: '', plataforma: '', tipo_teste: '', nivel_consciencia: '', angulo_teste: '',
  modulo: '', ordem: '',
  copy_url: '', video_gravado_url: '',
  data_inicio: '', data_prazo: '', notas: '',
};

export function CriativoFormModal({ open, onClose, onCreated, userId, funis, perfis, defaultDate }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (open) setForm({ ...EMPTY, data_prazo: defaultDate ?? '' });
  }, [open, defaultDate]);

  const set = (k: keyof typeof EMPTY, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.nome.trim()) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const fase = getDefaultFase(form.tipo);
    const payload = {
      nome: form.nome.trim(),
      tipo: form.tipo,
      fase,
      funil_id:          form.funil_id          || null,
      responsavel_id:    form.responsavel_id    || null,
      formato:           form.formato           || null,
      plataforma:        form.plataforma        || null,
      tipo_teste:        form.tipo_teste        || null,
      nivel_consciencia: form.nivel_consciencia || null,
      angulo_teste:      form.angulo_teste      || null,
      modulo:            form.modulo            || null,
      ordem:             form.ordem ? parseInt(form.ordem) : null,
      copy_url:          form.copy_url          || null,
      video_gravado_url: form.video_gravado_url || null,
      data_inicio:       form.data_inicio       || null,
      data_prazo:        form.data_prazo        || null,
      notas:             form.notas             || null,
    };
    const { data, error } = await supabase.from('criativos').insert(payload).select('id').single();
    if (error || !data) {
      toast({ title: 'Erro ao criar', variant: 'destructive' });
      setLoading(false);
      return;
    }
    await supabase.from('criativo_historico').insert({
      criativo_id:    data.id,
      usuario_id:     userId,
      tipo_alteracao: 'criacao',
      valor_novo:     form.nome.trim(),
    });
    toast({ title: 'Criado com sucesso' });
    setForm(EMPTY);
    setLoading(false);
    onCreated();
    onClose();
  };

  const Sel = ({ label, field, options }: { label: string; field: keyof typeof EMPTY; options: string[] }) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={form[field] || '_'} onValueChange={v => set(field, v === '_' ? '' : v)}>
        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_">—</SelectItem>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo item de produção</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Nome *</Label>
            <Input className="mt-1 h-8 text-xs" placeholder="Ex: Criativo Dor de Cabeça v1"
              value={form.nome} onChange={e => set('nome', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo *</Label>
              <Select value={form.tipo} onValueChange={v => set('tipo', v as CriativoTipo)}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(TIPOS_LABEL) as [CriativoTipo, string][]).map(([k, v]) =>
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Funil</Label>
              <Select value={form.funil_id || '_'} onValueChange={v => set('funil_id', v === '_' ? '' : v)}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">Nenhum</SelectItem>
                  {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Responsável</Label>
            <Select value={form.responsavel_id || '_'} onValueChange={v => set('responsavel_id', v === '_' ? '' : v)}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Nenhum" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Nenhum</SelectItem>
                {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {form.tipo === 'criativo' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Sel label="Formato"    field="formato"    options={FORMATOS}   />
                <Sel label="Plataforma" field="plataforma" options={PLATAFORMAS} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Sel label="Tipo de Teste"       field="tipo_teste"        options={TIPOS_TESTE}          />
                <Sel label="Nível de Consciência" field="nivel_consciencia" options={NIVEIS_CONSCIENCIA}    />
              </div>
              <div>
                <Label className="text-xs">Ângulo de Teste</Label>
                <Input className="mt-1 h-8 text-xs" placeholder="Ex: Dor + transformação"
                  value={form.angulo_teste} onChange={e => set('angulo_teste', e.target.value)} />
              </div>
            </>
          )}

          {form.tipo === 'aula' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Módulo</Label>
                <Input className="mt-1 h-8 text-xs" placeholder="Ex: Módulo 3"
                  value={form.modulo} onChange={e => set('modulo', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Ordem</Label>
                <Input className="mt-1 h-8 text-xs" type="number" placeholder="Ex: 2"
                  value={form.ordem} onChange={e => set('ordem', e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Copy (link)</Label>
              <Input className="mt-1 h-8 text-xs" placeholder="https://..."
                value={form.copy_url} onChange={e => set('copy_url', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Vídeo Gravado (link)</Label>
              <Input className="mt-1 h-8 text-xs" placeholder="https://..."
                value={form.video_gravado_url} onChange={e => set('video_gravado_url', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Início</Label>
              <Input className="mt-1 h-8 text-xs" type="date"
                value={form.data_inicio} onChange={e => set('data_inicio', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Prazo (fim)</Label>
              <Input className="mt-1 h-8 text-xs" type="date"
                value={form.data_prazo} onChange={e => set('data_prazo', e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Notas</Label>
            <Textarea className="mt-1 text-xs resize-none" rows={2} placeholder="Observações..."
              value={form.notas} onChange={e => set('notas', e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Criando...' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
