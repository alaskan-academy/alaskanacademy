import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { getDefaultFase, TIPOS_LABEL, FASES_POR_TIPO, FASES_MAP } from './constants';
import type { CriativoTipo, Funil, Perfil } from './types';

const FALLBACK_FORMATOS           = ['Carrossel', 'Vídeo', 'Estático'];
const FALLBACK_PLATAFORMAS        = ['Meta Ads', 'TikTok', 'YouTube'];
const FALLBACK_TIPOS_TESTE        = ['Hook', 'Copy', 'Ângulo', 'Oferta', 'Formato', 'Outro'];
const FALLBACK_NIVEIS_CONSCIENCIA = [
  'Inconsciente', 'Consciente do Problema', 'Consciente da Solução',
  'Consciente do Produto', 'Totalmente Consciente',
];
const FALLBACK_FUNIL_VIDEO = ['TSL', 'VSL', 'QUIZ'];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  userId: string;
  funis?: Funil[];
  perfis?: Perfil[];
  defaultDate?: string;
}

type OfertaEditorOption = { id: string; nome: string };

type FormState = {
  nome: string; tipo: CriativoTipo; fase: string;
  funil_id: string; responsavel_id: string; projeto_id: string; funil_video: string;
  formato: string; plataforma: string; tipo_teste: string; nivel_consciencia: string; angulo_teste: string;
  modulo: string; ordem: string;
  copy_url: string; video_gravado_url: string; video_editado_url: string;
  data_inicio: string; data_prazo: string; notas: string;
};

const makeEmpty = (tipo: CriativoTipo = 'criativo'): FormState => ({
  nome: '', tipo, fase: getDefaultFase(tipo),
  funil_id: '', responsavel_id: '', projeto_id: '', funil_video: '',
  formato: '', plataforma: '', tipo_teste: '', nivel_consciencia: '', angulo_teste: '',
  modulo: '', ordem: '',
  copy_url: '', video_gravado_url: '', video_editado_url: '',
  data_inicio: '', data_prazo: '', notas: '',
});

export function CriativoFormModal({ open, onClose, onCreated, userId, funis: funisProp, perfis: perfisProp, defaultDate }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(makeEmpty());
  const [internalFunis, setInternalFunis] = useState<Funil[]>([]);
  const [internalPerfis, setInternalPerfis] = useState<Perfil[]>([]);
  const [projetos, setProjetos] = useState<OfertaEditorOption[]>([]);
  const [opFunilVideo, setOpFunilVideo] = useState<string[]>(FALLBACK_FUNIL_VIDEO);
  const [opFormato, setOpFormato] = useState<string[]>(FALLBACK_FORMATOS);
  const [opPlataforma, setOpPlataforma] = useState<string[]>(FALLBACK_PLATAFORMAS);
  const [opTipoTeste, setOpTipoTeste] = useState<string[]>(FALLBACK_TIPOS_TESTE);
  const [opNivelConsciencia, setOpNivelConsciencia] = useState<string[]>(FALLBACK_NIVEIS_CONSCIENCIA);

  const funis  = funisProp  ?? internalFunis;
  const perfis = perfisProp ?? internalPerfis;

  useEffect(() => {
    if (open) {
      setForm({ ...makeEmpty(), data_prazo: defaultDate ?? '' });
      Promise.all([
        funisProp  ? Promise.resolve({ data: funisProp  }) : supabase.from('funis').select('id,nome,produto').eq('ativo', true).order('nome'),
        perfisProp ? Promise.resolve({ data: perfisProp }) : supabase.from('perfis').select('id,nome').eq('ativo', true).order('nome'),
        supabase.from('ofertas_editores').select('id,nome').eq('ativo', true).order('nome'),
        supabase.from('criativo_campos_opcoes').select('campo,valor').order('ordem'),
      ]).then(([{ data: fs }, { data: ps }, { data: pj }, { data: op }]) => {
        if (fs && !funisProp)  setInternalFunis(fs as Funil[]);
        if (ps && !perfisProp) setInternalPerfis(ps as Perfil[]);
        if (pj) setProjetos(pj as OfertaEditorOption[]);
        if (op) {
          const by = (campo: string) => op.filter(d => d.campo === campo).map(d => d.valor as string);
          const fv = by('funil_video'); if (fv.length) setOpFunilVideo(fv);
          const fm = by('formato');     if (fm.length) setOpFormato(fm);
          const pl = by('plataforma');  if (pl.length) setOpPlataforma(pl);
          const tt = by('tipo_teste');  if (tt.length) setOpTipoTeste(tt);
          const nc = by('nivel_consciencia'); if (nc.length) setOpNivelConsciencia(nc);
        }
      });
    }
  }, [open, defaultDate, funisProp, perfisProp]);

  const set = (k: keyof FormState, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const setTipo = (v: CriativoTipo) => setForm(prev => ({ ...prev, tipo: v, fase: getDefaultFase(v) }));

  const handleSubmit = async () => {
    if (!form.nome.trim()) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const payload = {
      nome:              form.nome.trim(),
      tipo:              form.tipo,
      fase:              form.fase || getDefaultFase(form.tipo),
      funil_id:          null,
      projeto_id:        form.projeto_id        || null,
      funil_video:       form.tipo === 'criativo' ? (form.funil_video || null) : null,
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
      video_editado_url: form.video_editado_url || null,
      data_inicio:       form.data_inicio       || null,
      data_prazo:        form.data_prazo        || null,
      notas:             form.notas             || null,
    };
    const { data, error } = await supabase.from('producoes').insert(payload).select('id').single();
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
    setForm(makeEmpty());
    setLoading(false);
    onCreated();
    onClose();
  };

  const fasesDisponiveis = FASES_POR_TIPO[form.tipo] ?? [];

  const Sel = ({ label, field, options }: { label: string; field: keyof FormState; options: string[] }) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={(form[field] as string) || '_'} onValueChange={v => set(field, v === '_' ? '' : v)}>
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
              <Select value={form.tipo} onValueChange={v => setTipo(v as CriativoTipo)}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(TIPOS_LABEL) as [CriativoTipo, string][]).map(([k, v]) =>
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fase</Label>
              <Select value={form.fase} onValueChange={v => set('fase', v)}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fasesDisponiveis.map(k =>
                    <SelectItem key={k} value={k}>{FASES_MAP[k] ?? k}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Projeto</Label>
            <Select value={form.projeto_id || '_'} onValueChange={v => set('projeto_id', v === '_' ? '' : v)}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Nenhum" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Nenhum</SelectItem>
                {projetos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Editor</Label>
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
                <Sel label="Funil de Vendas" field="funil_video" options={opFunilVideo} />
                <Sel label="Plataforma"      field="plataforma"  options={opPlataforma} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Sel label="Formato"       field="formato"     options={opFormato}    />
                <Sel label="Tipo de Teste" field="tipo_teste"  options={opTipoTeste}  />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Sel label="Nível de Consciência" field="nivel_consciencia" options={opNivelConsciencia} />
                <div>
                  <Label className="text-xs">Ângulo de Teste</Label>
                  <Input className="mt-1 h-8 text-xs" placeholder="Ex: Dor + transformação"
                    value={form.angulo_teste} onChange={e => set('angulo_teste', e.target.value)} />
                </div>
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

          <div>
            <Label className="text-xs">Vídeo Editado (link)</Label>
            <Input className="mt-1 h-8 text-xs" placeholder="https://..."
              value={form.video_editado_url} onChange={e => set('video_editado_url', e.target.value)} />
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
