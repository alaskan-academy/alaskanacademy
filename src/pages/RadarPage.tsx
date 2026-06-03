import { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Plus, Search, Pencil, Trash2, Calendar, User, Tag,
  FlaskConical, CheckCircle2, XCircle, MinusCircle, Clock, PauseCircle
} from 'lucide-react';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Area = {
  id: string;
  slug: string;
  nome: string;
  categoria: string;
  icone: string;
  descricao: string[];
};

type Teste = {
  id: string;
  titulo: string;
  area_id: string | null;
  area?: Area;
  hipotese: string | null;
  metodologia: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  status: 'em_andamento' | 'concluido' | 'pausado' | 'cancelado';
  resultado: 'positivo' | 'negativo' | 'inconclusivo' | null;
  conclusao: string | null;
  aprendizado: string | null;
  tags: string[];
  responsavel_id: string | null;
  responsavel_nome?: string;
  criado_por: string | null;
  criado_em: string;
};

type PerfilSimples = { id: string; nome: string };

const blankForm = () => ({
  titulo: '',
  area_id: '',
  hipotese: '',
  metodologia: '',
  data_inicio: '',
  data_fim: '',
  status: 'em_andamento' as Teste['status'],
  resultado: '' as Teste['resultado'] | '',
  conclusao: '',
  aprendizado: '',
  tags: '',
  responsavel_id: '',
});

// ─── Labels & cores ──────────────────────────────────────────────────────────

const STATUS_CFG = {
  em_andamento: { label: 'Em andamento', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',    icon: Clock },
  concluido:    { label: 'Concluído',    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  pausado:      { label: 'Pausado',      color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',  icon: PauseCircle },
  cancelado:    { label: 'Cancelado',    color: 'bg-red-500/15 text-red-400 border-red-500/30',       icon: XCircle },
};

const RESULTADO_CFG = {
  positivo:     { label: 'Positivo',     color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  negativo:     { label: 'Negativo',     color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  inconclusivo: { label: 'Inconclusivo', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
};

const CATEGORIA_LABEL: Record<string, string> = {
  trafego: 'Tráfego',
  criativo: 'Criativo',
  funil_oferta: 'Funil & Oferta',
  produto: 'Produto',
  relacionamento: 'Relacionamento',
  interno: 'Interno',
};

function StatusBadge({ status }: { status: Teste['status'] }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium', cfg.color)}>
      <Icon className="h-3 w-3" />{cfg.label}
    </span>
  );
}

function ResultadoBadge({ resultado }: { resultado: Teste['resultado'] }) {
  if (!resultado) return null;
  const cfg = RESULTADO_CFG[resultado];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium', cfg.color)}>
      {resultado === 'positivo' && <CheckCircle2 className="h-3 w-3" />}
      {resultado === 'negativo' && <XCircle className="h-3 w-3" />}
      {resultado === 'inconclusivo' && <MinusCircle className="h-3 w-3" />}
      {cfg.label}
    </span>
  );
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function RadarPage() {
  const { perfil: authPerfil, user } = useAuth();
  const isAdmin = authPerfil?.is_admin ?? false;
  const podeCriar = (authPerfil as any)?.radar_pode_criar !== false;
  const confirm = useConfirm();

  const [areas, setAreas]       = useState<Area[]>([]);
  const [testes, setTestes]     = useState<Teste[]>([]);
  const [perfis, setPerfis]     = useState<PerfilSimples[]>([]);
  const [loading, setLoading]   = useState(true);

  // filtros
  const [search, setSearch]         = useState('');
  const [filtroArea, setFiltroArea] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroResultado, setFiltroResultado] = useState('');

  // modal criar/editar
  const [openForm, setOpenForm]     = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState(blankForm());
  const [saving, setSaving]         = useState(false);

  // detalhe dialog
  const [detalhe, setDetalhe]       = useState<Teste | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    const [{ data: areasData }, { data: testesData }, { data: perfisData }] = await Promise.all([
      supabase.from('radar_areas').select('*').eq('ativo', true).order('ordem'),
      supabase.from('radar_testes').select('*').order('criado_em', { ascending: false }),
      supabase.from('perfis').select('id, nome').order('nome'),
    ]);
    setAreas(areasData || []);
    setPerfis(perfisData || []);

    const areaMap = Object.fromEntries((areasData || []).map((a: Area) => [a.id, a]));
    const perfilMap = Object.fromEntries((perfisData || []).map((p: PerfilSimples) => [p.id, p.nome]));

    setTestes(
      (testesData || []).map((t: any) => ({
        ...t,
        area: areaMap[t.area_id] ?? null,
        responsavel_nome: perfilMap[t.responsavel_id] ?? null,
      }))
    );
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const testesFiltrados = useMemo(() => {
    return testes.filter(t => {
      if (search && !t.titulo.toLowerCase().includes(search.toLowerCase())) return false;
      if (filtroArea && t.area_id !== filtroArea) return false;
      if (filtroStatus && t.status !== filtroStatus) return false;
      if (filtroResultado && t.resultado !== filtroResultado) return false;
      return true;
    });
  }, [testes, search, filtroArea, filtroStatus, filtroResultado]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    em_andamento: testes.filter(t => t.status === 'em_andamento').length,
    concluido:    testes.filter(t => t.status === 'concluido').length,
    pausado:      testes.filter(t => t.status === 'pausado').length,
    positivos:    testes.filter(t => t.resultado === 'positivo').length,
  }), [testes]);

  // ── Form helpers ──────────────────────────────────────────────────────────
  const openNew = () => {
    setEditingId(null);
    setForm({ ...blankForm(), responsavel_id: user?.id || '' });
    setOpenForm(true);
  };

  const openEdit = (t: Teste) => {
    setDetalhe(null);
    setEditingId(t.id);
    setForm({
      titulo: t.titulo,
      area_id: t.area_id || '',
      hipotese: t.hipotese || '',
      metodologia: t.metodologia || '',
      data_inicio: t.data_inicio || '',
      data_fim: t.data_fim || '',
      status: t.status,
      resultado: t.resultado || '',
      conclusao: t.conclusao || '',
      aprendizado: t.aprendizado || '',
      tags: (t.tags || []).join(', '),
      responsavel_id: t.responsavel_id || '',
    });
    setOpenForm(true);
  };

  const save = async () => {
    if (!form.titulo.trim()) return toast({ title: 'Título obrigatório', variant: 'destructive' });
    setSaving(true);
    const payload = {
      titulo: form.titulo.trim(),
      area_id: form.area_id || null,
      hipotese: form.hipotese || null,
      metodologia: form.metodologia || null,
      data_inicio: form.data_inicio || null,
      data_fim: form.data_fim || null,
      status: form.status,
      resultado: form.resultado || null,
      conclusao: form.conclusao || null,
      aprendizado: form.aprendizado || null,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      responsavel_id: form.responsavel_id || null,
      atualizado_em: new Date().toISOString(),
    };

    const { error } = editingId
      ? await supabase.from('radar_testes').update(payload).eq('id', editingId)
      : await supabase.from('radar_testes').insert({ ...payload, criado_por: user?.id });

    setSaving(false);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Teste atualizado' : 'Teste criado' });
    setOpenForm(false);
    load();
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Excluir teste?', description: 'Esta ação não pode ser desfeita.' }))) return;
    const { error } = await supabase.from('radar_testes').delete().eq('id', id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Teste excluído' });
    setDetalhe(null);
    load();
  };

  const podeEditar = (t: Teste) => isAdmin || t.criado_por === user?.id;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout title="Radar Alaskan">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Central de testes e aprendizados da empresa
          </p>
        </div>
        {podeCriar && (
          <Button onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4 mr-1" /> Novo teste
          </Button>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Em andamento', value: stats.em_andamento, color: 'text-blue-400' },
          { label: 'Concluídos',   value: stats.concluido,    color: 'text-emerald-400' },
          { label: 'Pausados',     value: stats.pausado,      color: 'text-yellow-400' },
          { label: 'Positivos',    value: stats.positivos,    color: 'text-emerald-400' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg px-4 py-3">
            <div className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar teste..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm" />
        </div>
        <Select value={filtroArea || 'all'} onValueChange={v => setFiltroArea(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue placeholder="Área" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as áreas</SelectItem>
            {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.icone} {a.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroStatus || 'all'} onValueChange={v => setFiltroStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroResultado || 'all'} onValueChange={v => setFiltroResultado(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue placeholder="Resultado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(RESULTADO_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Lista ── */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Carregando...</div>
      ) : testesFiltrados.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{testes.length === 0 ? 'Nenhum teste registrado ainda.' : 'Nenhum teste encontrado com esses filtros.'}</p>
          {testes.length === 0 && podeCriar && (
            <Button variant="outline" size="sm" className="mt-3" onClick={openNew}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Criar primeiro teste
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {testesFiltrados.map(t => (
            <div
              key={t.id}
              onClick={() => setDetalhe(t)}
              className="bg-card border border-border rounded-lg p-4 cursor-pointer hover:border-primary/40 hover:bg-card/80 transition-colors group"
            >
              {/* área + status */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground">
                  {t.area ? `${t.area.icone} ${t.area.nome}` : '—'}
                </span>
                <StatusBadge status={t.status} />
              </div>

              {/* título */}
              <p className="text-sm font-medium leading-snug mb-2 line-clamp-2">{t.titulo}</p>

              {/* resultado */}
              {t.resultado && <div className="mb-2"><ResultadoBadge resultado={t.resultado} /></div>}

              {/* tags */}
              {t.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {t.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                  {t.tags.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{t.tags.length - 3}</span>
                  )}
                </div>
              )}

              {/* rodapé */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {fmtDate(t.data_inicio) || '—'}
                </span>
                {t.responsavel_nome && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" />{t.responsavel_nome}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Detalhe Dialog ── */}
      <Dialog open={!!detalhe} onOpenChange={v => !v && setDetalhe(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          {detalhe && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {detalhe.area && (
                    <span className="text-xs text-muted-foreground">{detalhe.area.icone} {detalhe.area.nome}</span>
                  )}
                  <StatusBadge status={detalhe.status} />
                  {detalhe.resultado && <ResultadoBadge resultado={detalhe.resultado} />}
                </div>
                <DialogTitle className="text-base leading-snug text-left">{detalhe.titulo}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm mt-2">

                {/* Datas + responsável */}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
                  {detalhe.data_inicio && (
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Início: {fmtDate(detalhe.data_inicio)}</span>
                  )}
                  {detalhe.data_fim && (
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Fim: {fmtDate(detalhe.data_fim)}</span>
                  )}
                  {detalhe.responsavel_nome && (
                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> {detalhe.responsavel_nome}</span>
                  )}
                </div>

                {detalhe.hipotese && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Hipótese</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{detalhe.hipotese}</p>
                  </div>
                )}

                {detalhe.metodologia && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Metodologia</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{detalhe.metodologia}</p>
                  </div>
                )}

                {detalhe.conclusao && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Conclusão</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{detalhe.conclusao}</p>
                  </div>
                )}

                {detalhe.aprendizado && (
                  <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
                    <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">💡 Aprendizado</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{detalhe.aprendizado}</p>
                  </div>
                )}

                {detalhe.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                    {detalhe.tags.map(tag => (
                      <span key={tag} className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                )}
              </div>

              {podeEditar(detalhe) && (
                <DialogFooter className="mt-4 gap-2 sm:justify-start">
                  <Button size="sm" variant="outline" onClick={() => openEdit(detalhe)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(detalhe.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Modal Criar / Editar ── */}
      <Dialog open={openForm} onOpenChange={v => !v && setOpenForm(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" />
              {editingId ? 'Editar teste' : 'Novo teste'}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Título */}
            <div className="col-span-2">
              <Label>Título <span className="text-destructive">*</span></Label>
              <Input value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })}
                placeholder="Ex: Teste de hook com pergunta direta nos 3s" className="mt-1" />
            </div>

            {/* Área */}
            <div>
              <Label>Área</Label>
              <Select value={form.area_id} onValueChange={v => setForm({ ...form, area_id: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {Object.entries(
                    areas.reduce((acc, a) => {
                      if (!acc[a.categoria]) acc[a.categoria] = [];
                      acc[a.categoria].push(a);
                      return acc;
                    }, {} as Record<string, Area[]>)
                  ).map(([cat, lista]) => (
                    <div key={cat}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {CATEGORIA_LABEL[cat] || cat}
                      </div>
                      {lista.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.icone} {a.nome}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Responsável */}
            <div>
              <Label>Responsável</Label>
              <Select value={form.responsavel_id} onValueChange={v => setForm({ ...form, responsavel_id: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Datas */}
            <div>
              <Label>Data de início</Label>
              <Input type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Data de fim</Label>
              <Input type="date" value={form.data_fim} onChange={e => setForm({ ...form, data_fim: e.target.value })} className="mt-1" />
            </div>

            {/* Status */}
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as Teste['status'] })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Resultado — só se concluído */}
            <div>
              <Label>Resultado</Label>
              <Select
                value={form.resultado || ''}
                onValueChange={v => setForm({ ...form, resultado: v as Teste['resultado'] })}
                disabled={form.status !== 'concluido'}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={form.status !== 'concluido' ? 'Apenas para concluídos' : 'Selecione...'} />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RESULTADO_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Hipótese */}
            <div className="col-span-2">
              <Label>Hipótese</Label>
              <Textarea value={form.hipotese} onChange={e => setForm({ ...form, hipotese: e.target.value })}
                placeholder="O que você acredita que vai acontecer e por quê?" className="mt-1 min-h-[80px]" />
            </div>

            {/* Metodologia */}
            <div className="col-span-2">
              <Label>Metodologia</Label>
              <Textarea value={form.metodologia} onChange={e => setForm({ ...form, metodologia: e.target.value })}
                placeholder="Como o teste será conduzido? Quais variáveis? Qual métrica principal?" className="mt-1 min-h-[80px]" />
            </div>

            {/* Conclusão */}
            <div className="col-span-2">
              <Label>Conclusão</Label>
              <Textarea value={form.conclusao} onChange={e => setForm({ ...form, conclusao: e.target.value })}
                placeholder="O que os dados mostraram?" className="mt-1 min-h-[80px]" />
            </div>

            {/* Aprendizado */}
            <div className="col-span-2">
              <Label>Aprendizado <span className="text-xs text-muted-foreground">(o que a empresa aprende com isso?)</span></Label>
              <Textarea value={form.aprendizado} onChange={e => setForm({ ...form, aprendizado: e.target.value })}
                placeholder="Qual o aprendizado que fica para a empresa?" className="mt-1 min-h-[80px]" />
            </div>

            {/* Tags */}
            <div className="col-span-2">
              <Label>Tags <span className="text-xs text-muted-foreground">(separadas por vírgula)</span></Label>
              <Input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
                placeholder="hook, velas, 3s, mobile" className="mt-1" />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar teste'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
