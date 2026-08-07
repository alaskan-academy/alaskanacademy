import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { TesteFunil, Funil, Projeto, PipelineStatus, CategoriaTest, ImpactoTest, DificuldadeTest } from '../types';
import { cn } from '@/lib/utils';
import { GerenciarOpcoesPopover } from '@/features/producao/components/GerenciarOpcoesPopover';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  teste?: TesteFunil | null;
  funis: Funil[];
  projetos?: Projeto[];
  presetFunilId?: string;
  presetPipelineStatus?: PipelineStatus;
}

const TIPOS = [
  { value: 'ab_interno', label: 'A/B interno', desc: 'Testando variações dentro de um funil existente' },
  { value: 'funil_novo', label: 'Funil novo',  desc: 'Validando o funil inteiro como conceito' },
  { value: 'ad',         label: 'AD',           desc: 'Teste de criativo ou ângulo de anúncio' },
];

const VENCEDORES = [
  { value: 'a',            label: 'Variante A venceu' },
  { value: 'b',            label: 'Variante B venceu' },
  { value: 'inconclusivo', label: 'Inconclusivo' },
];

const PIPELINE_OPTIONS: { value: PipelineStatus; label: string }[] = [
  { value: 'planejado',  label: '💡 Planejado' },
  { value: 'produzindo', label: '🔨 Produzindo' },
  { value: 'rodando',    label: '📊 Rodando' },
  { value: 'concluido',  label: '✅ Concluído' },
];


// ── Sync to Radar ─────────────────────────────────────────────────────────────

async function syncToRadar(opts: {
  funisTesteId: string;
  radarTesteId: string | null;
  tipo: string;
  titulo: string;
  notas: string;
  resultadoA: string;
  resultadoB: string;
  varianteA: string;
  varianteB: string;
  vencedor: string;
  validado: boolean;
  dataInicio: string;
  dataFim: string;
  kpi: string;
  funilNome: string;
  // AD-specific
  nomeAd: string;
  linkAd: string;
  comentarioAd: string;
}): Promise<string | null> {
  const {
    funisTesteId, radarTesteId, tipo,
    titulo, notas, resultadoA, resultadoB, varianteA, varianteB,
    vencedor, validado, dataInicio, dataFim, kpi, funilNome,
    nomeAd, linkAd, comentarioAd,
  } = opts;

  const status = dataFim ? 'concluido' : 'em_andamento';
  let resultado: 'positivo' | 'negativo' | 'inconclusivo' | null = null;
  if (dataFim) {
    if (vencedor === 'inconclusivo') resultado = 'inconclusivo';
    else if (validado) resultado = 'positivo';
    else resultado = 'negativo';
  }

  let hipotese: string | null;
  let conclusao: string | null;
  let tituloRadar: string;

  if (tipo === 'ad') {
    tituloRadar = nomeAd || titulo || 'Sem título';
    hipotese = comentarioAd || notas || null;
    conclusao = resultadoA || null;
  } else {
    tituloRadar = titulo || 'Sem título';
    hipotese = notas || null;
    const parts: string[] = [];
    if (varianteA && resultadoA) parts.push(`A (${varianteA}): ${resultadoA}`);
    else if (resultadoA)         parts.push(`A: ${resultadoA}`);
    if (varianteB && resultadoB) parts.push(`B (${varianteB}): ${resultadoB}`);
    else if (resultadoB)         parts.push(`B: ${resultadoB}`);
    conclusao = parts.join('\n\n') || null;
  }

  const tags: string[] = ['funis', tipo];
  if (kpi) tags.push(kpi.toLowerCase());
  if (tipo === 'ad' && linkAd) tags.push('criativo');

  const metodologia = funilNome ? `Funil: ${funilNome}` : null;

  const payload = {
    titulo:      tituloRadar,
    hipotese,
    metodologia,
    conclusao,
    data_inicio: dataInicio || null,
    data_fim:    dataFim || null,
    status,
    resultado,
    tags,
    fonte:    'funis',
    fonte_id: funisTesteId,
    atualizado_em: new Date().toISOString(),
  };

  if (radarTesteId) {
    await supabase.from('radar_testes').update(payload).eq('id', radarTesteId);
    return radarTesteId;
  } else {
    const { data, error } = await supabase
      .from('radar_testes')
      .insert({ ...payload, criado_em: new Date().toISOString() })
      .select('id')
      .single();
    if (error || !data) return null;
    return data.id as string;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TesteModal({ open, onClose, onSaved, teste, funis, projetos = [], presetFunilId, presetPipelineStatus }: Props) {
  const projetoMap = Object.fromEntries(projetos.map(p => [p.id, p]));
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actioning, setActioning]         = useState(false);

  const [funilIds, setFunilIds]       = useState<string[]>([]);
  const [titulo, setTitulo]           = useState('');
  const [tipo, setTipo]               = useState<'funil_novo' | 'ab_interno' | 'ad'>('ab_interno');
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

  // Esteira
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('planejado');
  const [categoria, setCategoria]           = useState<CategoriaTest | ''>('');
  const [impacto, setImpacto]               = useState<ImpactoTest | ''>('');
  const [dificuldade, setDificuldade]       = useState<DificuldadeTest | ''>('');
  const [kpi, setKpi]                       = useState('');
  const [dataPrevista, setDataPrevista]     = useState('');

  // AD-specific
  const [nomeAd, setNomeAd]           = useState('');
  const [linkAd, setLinkAd]           = useState('');
  const [comentarioAd, setComentarioAd] = useState('');

  const [opCategorias, setOpCategorias] = useState<string[]>([]);

  function loadCategorias() {
    supabase.from('criativo_campos_opcoes')
      .select('valor')
      .eq('campo', 'teste_categoria')
      .order('ordem')
      .then(({ data }) => setOpCategorias(data?.map(d => d.valor as string) ?? []));
  }

  useEffect(() => { loadCategorias(); }, []);

  useEffect(() => {
    if (!open) return;
    const ids = teste?.funil_ids?.length
      ? teste.funil_ids
      : teste?.funil_id ? [teste.funil_id]
      : presetFunilId ? [presetFunilId]
      : [];
    setFunilIds(ids);
    setTitulo(teste?.titulo ?? '');
    setTipo((teste?.tipo ?? 'ab_interno') as typeof tipo);
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
    setPipelineStatus(teste?.pipeline_status ?? presetPipelineStatus ?? 'planejado');
    setCategoria((teste?.categoria as CategoriaTest) ?? '');
    setImpacto((teste?.impacto as ImpactoTest) ?? '');
    setDificuldade((teste?.dificuldade as DificuldadeTest) ?? '');
    setKpi(teste?.kpi ?? '');
    setDataPrevista(teste?.data_prevista ?? '');
    setNomeAd(teste?.nome_ad ?? '');
    setLinkAd(teste?.link_ad ?? '');
    setComentarioAd(teste?.comentario_ad ?? '');
  }, [open, teste, presetFunilId, presetPipelineStatus]);

  async function handleDelete() {
    if (!teste) return;
    setActioning(true);
    const { error } = await supabase.from('testes_funis').delete().eq('id', teste.id);
    setActioning(false);
    if (error) toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Teste excluído' }); onSaved(); onClose(); }
  }

  async function handleArchive() {
    if (!teste) return;
    setActioning(true);
    const { error } = await supabase.from('testes_funis').update({ arquivado: true }).eq('id', teste.id);
    setActioning(false);
    if (error) toast({ title: 'Erro ao arquivar', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Teste arquivado' }); onSaved(); onClose(); }
  }

  async function handleSave() {
    if (tipo !== 'ad' && funilIds.length === 0) {
      toast({ title: 'Selecione ao menos um funil', variant: 'destructive' });
      return;
    }
    const tituloFinal = tipo === 'ad' ? (nomeAd.trim() || titulo.trim()) : titulo.trim();
    if (!tituloFinal) {
      toast({ title: tipo === 'ad' ? 'Nome do AD é obrigatório' : 'Título é obrigatório', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      funil_id:       funilIds[0] || null,
      funil_ids:      funilIds,
      titulo:         tituloFinal,
      tipo,
      variante_a:     tipo !== 'ad' ? (varianteA.trim() || null) : null,
      variante_b:     tipo !== 'ad' ? (varianteB.trim() || null) : null,
      metrica:        tipo !== 'ad' ? (metrica.trim() || null) : null,
      resultado_a:    resultadoA.trim() || null,
      resultado_b:    tipo !== 'ad' ? (resultadoB.trim() || null) : null,
      vencedor:       tipo !== 'ad' ? (vencedor || null) : null,
      validado,
      data_inicio:    dataInicio || null,
      data_fim:       dataFim || null,
      notas:          notas.trim() || null,
      pipeline_status: pipelineStatus,
      categoria:      categoria || null,
      impacto:        impacto || null,
      dificuldade:    dificuldade || null,
      kpi:            kpi.trim() || null,
      data_prevista:  dataPrevista || null,
      nome_ad:        tipo === 'ad' ? (nomeAd.trim() || null) : null,
      link_ad:        tipo === 'ad' ? (linkAd.trim() || null) : null,
      comentario_ad:  tipo === 'ad' ? (comentarioAd.trim() || null) : null,
      updated_at:     new Date().toISOString(),
    };

    let funisTesteId = teste?.id ?? null;
    let error: { message: string } | null = null;

    if (teste) {
      ({ error } = await supabase.from('testes_funis').update(payload).eq('id', teste.id));
    } else {
      const res = await supabase.from('testes_funis').insert({ ...payload, criado_por: user?.id }).select('id').single();
      error = res.error;
      funisTesteId = res.data?.id ?? null;
    }

    if (error || !funisTesteId) {
      toast({ title: 'Erro ao salvar', description: error?.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    const funilNome = funis.find(f => f.id === funilIds[0])?.nome ?? '';
    const newRadarId = await syncToRadar({
      funisTesteId,
      radarTesteId: teste?.radar_teste_id ?? null,
      tipo,
      titulo: tituloFinal,
      notas: notas.trim(),
      resultadoA: resultadoA.trim(),
      resultadoB: resultadoB.trim(),
      varianteA: varianteA.trim(),
      varianteB: varianteB.trim(),
      vencedor,
      validado,
      dataInicio,
      dataFim,
      kpi: kpi.trim(),
      funilNome,
      nomeAd: nomeAd.trim(),
      linkAd: linkAd.trim(),
      comentarioAd: comentarioAd.trim(),
    }).catch(() => null);

    if (newRadarId && !teste?.radar_teste_id) {
      await supabase.from('testes_funis').update({ radar_teste_id: newRadarId }).eq('id', funisTesteId);
    }

    setSaving(false);
    toast({ title: teste ? 'Teste atualizado' : 'Teste registrado' });
    onSaved();
    onClose();
  }

  const isAd = tipo === 'ad';
  const emAndamento = !dataFim;
  const isConcluido = pipelineStatus === 'concluido';

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{teste ? 'Editar teste' : 'Registrar teste'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">

          {/* ── Tipo ── */}
          <div>
            <Label className="mb-2 block">Tipo de teste</Label>
            <div className="grid grid-cols-3 gap-2">
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

          {/* ── Funil + Etapa ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Funil {!isAd && '*'}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="mt-1 h-8 text-sm w-full flex items-center px-3 rounded-md border border-input bg-background hover:bg-accent transition-colors text-left min-w-0"
                  >
                    {funilIds.length === 0
                      ? <span className="text-muted-foreground">Selecionar funil...</span>
                      : funilIds.length === 1
                        ? <span className="truncate">{funis.find(f => f.id === funilIds[0])?.nome}</span>
                        : <span className="truncate">{funis.find(f => f.id === funilIds[0])?.nome} <span className="text-muted-foreground">+{funilIds.length - 1}</span></span>
                    }
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <div className="max-h-52 overflow-y-auto space-y-0.5" onWheel={e => e.stopPropagation()}>
                    {funis.map(f => {
                      const proj = f.oferta_id ? projetoMap[f.oferta_id] : null;
                      return (
                        <div
                          key={f.id}
                          className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted cursor-pointer"
                          onClick={() => setFunilIds(prev =>
                            prev.includes(f.id) ? prev.filter(id => id !== f.id) : [...prev, f.id]
                          )}
                        >
                          <Checkbox
                            checked={funilIds.includes(f.id)}
                            onCheckedChange={() => setFunilIds(prev =>
                              prev.includes(f.id) ? prev.filter(id => id !== f.id) : [...prev, f.id]
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs truncate">{f.nome}</p>
                            {proj && <p className="text-[10px] text-muted-foreground truncate">{proj.nome}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Etapa na esteira</Label>
              <Select value={pipelineStatus} onValueChange={v => setPipelineStatus(v as PipelineStatus)}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Conclusão (aparece ao marcar Concluído) ── */}
          {isConcluido && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-4">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Resultado do teste</p>

              <div className="flex items-center gap-3">
                <Switch id="teste-validado-concluido" checked={validado} onCheckedChange={setValidado} />
                <label htmlFor="teste-validado-concluido" className="text-sm cursor-pointer select-none">
                  Resultado validado — aprovado para escalar ou manter
                </label>
              </div>
            </div>
          )}

          {/* ══ FORM AD ══════════════════════════════════════════════════════════ */}
          {isAd && (
            <>
              <div className="border border-sky-500/25 rounded-lg p-3 space-y-3 bg-sky-500/5">
                <p className="text-xs font-semibold text-sky-400 uppercase tracking-wide">Criativo</p>
                <div>
                  <Label>Nome do AD *</Label>
                  <Input
                    className="mt-1"
                    placeholder="Ex: VSL 02 h07 v01"
                    value={nomeAd}
                    onChange={e => setNomeAd(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Link do AD</Label>
                  <Input
                    className="mt-1 h-8 text-sm"
                    placeholder="https://..."
                    value={linkAd}
                    onChange={e => setLinkAd(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Hook / Ângulo testado</Label>
                  <Textarea
                    className="mt-1 h-16 resize-none text-sm"
                    placeholder="Descreva o hook, ângulo ou copy principal do AD..."
                    value={comentarioAd}
                    onChange={e => setComentarioAd(e.target.value)}
                  />
                </div>
              </div>

              {/* Classificação AD */}
              <div className="border border-border/50 rounded-lg p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Classificação</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">KPI principal</Label>
                    <Input
                      className="mt-1 h-8 text-sm"
                      placeholder="ROAS, CTR, CPL..."
                      value={kpi}
                      onChange={e => setKpi(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Impacto esperado</Label>
                    <Select value={impacto} onValueChange={v => setImpacto(v as ImpactoTest)}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alto">🔴 Alto</SelectItem>
                        <SelectItem value="medio">🟡 Médio</SelectItem>
                        <SelectItem value="baixo">🟢 Baixo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Dificuldade</Label>
                    <Select value={dificuldade} onValueChange={v => setDificuldade(v as DificuldadeTest)}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="facil">✅ Fácil</SelectItem>
                        <SelectItem value="media">⚠️ Média</SelectItem>
                        <SelectItem value="dificil">🔴 Difícil</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Datas AD */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Data prevista</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataPrevista} onChange={e => setDataPrevista(e.target.value)} />
                </div>
                <div>
                  <Label>Início</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
                </div>
                <div>
                  <Label>Fim</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataFim} onChange={e => setDataFim(e.target.value)} />
                </div>
              </div>

              {/* Resultado AD */}
              <div>
                <Label>Resultado</Label>
                <Textarea
                  className="mt-1 h-16 resize-none text-sm"
                  placeholder="O que aconteceu? Métricas, conclusão..."
                  value={resultadoA}
                  onChange={e => setResultadoA(e.target.value)}
                />
              </div>

              <div>
                <Label>Notas / Hipótese</Label>
                <Textarea
                  className="mt-1 h-16 resize-none text-sm"
                  placeholder="Contexto, expectativas, o que esperamos aprender..."
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                />
              </div>
            </>
          )}

          {/* ══ FORM FUNIL (A/B interno + funil_novo) ═══════════════════════════ */}
          {!isAd && (
            <>
              <div>
                <Label>Título do teste *</Label>
                <Input
                  className="mt-1"
                  placeholder='Ex: "VSL longa vs curta", "Testar nova lead C"'
                  value={titulo}
                  onChange={e => setTitulo(e.target.value)}
                />
              </div>

              {/* Classificação */}
              <div className="border border-border/50 rounded-lg p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Classificação</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Label className="text-xs">Categoria</Label>
                      <GerenciarOpcoesPopover campo="teste_categoria" label="Categorias" onAtualizar={loadCategorias} />
                    </div>
                    <Select value={categoria} onValueChange={v => setCategoria(v as CategoriaTest)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                      <SelectContent>
                        {opCategorias.map(o => (
                          <SelectItem key={o} value={o}>{o}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">KPI principal</Label>
                    <Input
                      className="mt-1 h-8 text-sm"
                      placeholder="ROAS, Conversão, AOV..."
                      value={kpi}
                      onChange={e => setKpi(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Impacto esperado</Label>
                    <Select value={impacto} onValueChange={v => setImpacto(v as ImpactoTest)}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alto">🔴 Alto</SelectItem>
                        <SelectItem value="medio">🟡 Médio</SelectItem>
                        <SelectItem value="baixo">🟢 Baixo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Dificuldade</Label>
                    <Select value={dificuldade} onValueChange={v => setDificuldade(v as DificuldadeTest)}>
                      <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="facil">✅ Fácil</SelectItem>
                        <SelectItem value="media">⚠️ Média</SelectItem>
                        <SelectItem value="dificil">🔴 Difícil</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Datas */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Data prevista</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataPrevista} onChange={e => setDataPrevista(e.target.value)} />
                </div>
                <div>
                  <Label>Início</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
                </div>
                <div>
                  <Label>Fim</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataFim} onChange={e => setDataFim(e.target.value)} />
                </div>
              </div>

              {/* Variantes */}
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
                  <Input className="mt-1 h-8 text-sm" placeholder="Ex: 3,2% conv." value={resultadoA} onChange={e => setResultadoA(e.target.value)} />
                </div>
                <div>
                  <Label>Resultado B</Label>
                  <Input className="mt-1 h-8 text-sm" placeholder="Ex: 4,1% conv." value={resultadoB} onChange={e => setResultadoB(e.target.value)} />
                </div>
              </div>

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

              <div>
                <Label>Hipótese / Notas</Label>
                <Textarea
                  className="mt-1 h-20 resize-none text-sm"
                  placeholder="Contexto, hipóteses, o que esperamos aprender..."
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                />
              </div>
            </>
          )}

        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          {teste && !confirmDelete && (
            <div className="flex gap-2 mr-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                disabled={actioning || saving}
                onClick={() => handleArchive()}
              >
                Arquivar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                disabled={actioning || saving}
                onClick={() => setConfirmDelete(true)}
              >
                Excluir
              </Button>
            </div>
          )}

          {teste && confirmDelete && (
            <div className="flex items-center gap-2 mr-auto">
              <span className="text-sm text-muted-foreground">Excluir permanentemente?</span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={actioning}
                onClick={handleDelete}
              >
                {actioning ? 'Excluindo...' : 'Sim, excluir'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              >
                Não
              </Button>
            </div>
          )}

          <Button variant="outline" onClick={onClose} disabled={saving || actioning}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || actioning}>
            {saving ? 'Salvando...' : teste ? 'Salvar' : 'Registrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
