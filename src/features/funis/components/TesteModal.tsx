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
import { formatCurrency } from '@/lib/formatters';
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
  /** Tipo inicial. REV recem-criado abre como 'funil_novo': o primeiro teste
   *  de um REV e validacao, nao comparacao. */
  presetTipo?: 'funil_novo' | 'ab_interno' | 'ad';
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

interface LinhaDeBase {
  rev: string;
  dias: number;
  vendas: number;
  faturamento: number;
  ticket_medio: number;
  vendas_por_dia: number;
  de: string;
  ate: string;
}

const PIPELINE_OPTIONS: { value: PipelineStatus; label: string }[] = [
  { value: 'planejado',        label: '💡 Planejado' },
  { value: 'produzindo',       label: '🔨 Produzindo' },
  { value: 'pronto_para_teste', label: '🚀 Pronto para teste' },
  { value: 'rodando',          label: '📊 Rodando' },
  { value: 'concluido',        label: '✅ Concluído' },
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

export function TesteModal({ open, onClose, onSaved, teste, funis, projetos = [], presetFunilId, presetPipelineStatus, presetTipo }: Props) {
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

  /**
   * Números do REV que está no ar, para o REV novo ter contra o que lutar.
   *
   * O primeiro teste de um REV novo não é A contra B — não existe B. É
   * validação, e o adversário é a meta: o desempenho do REV que ele quer
   * substituir. Isso já era feito à mão, escrito dentro do campo "Variante A".
   */
  const [base, setBase] = useState<LinhaDeBase | null>(null);
  const [baseCarregando, setBaseCarregando] = useState(false);

  function loadCategorias() {
    supabase.from('criativo_campos_opcoes')
      .select('valor')
      .eq('campo', 'teste_categoria')
      .order('ordem')
      .then(({ data }) => setOpCategorias(data?.map(d => d.valor as string) ?? []));
  }

  useEffect(() => { loadCategorias(); }, []);

  // Busca a linha de base pelo PROJETO do REV escolhido, e nao pelo REV: a meta
  // e o desempenho do irmao que esta no ar, nao o do proprio REV -- que, sendo
  // novo, ainda nao vendeu nada.
  useEffect(() => {
    if (tipo !== 'funil_novo' || funilIds.length === 0) { setBase(null); return; }
    const f = funis.find(x => x.id === funilIds[0]);
    if (!f?.projeto_id) { setBase(null); return; }
    let cancelado = false;
    setBaseCarregando(true);
    supabase.rpc('fn_linha_de_base_do_projeto', { p_projeto_id: f.projeto_id })
      .then(({ data }) => {
        if (cancelado) return;
        setBase((data as LinhaDeBase | null) ?? null);
        setBaseCarregando(false);
      });
    return () => { cancelado = true; };
  }, [tipo, funilIds, funis]);

  useEffect(() => {
    if (!open) return;
    const ids = teste?.funil_ids?.length
      ? teste.funil_ids
      : teste?.funil_id ? [teste.funil_id]
      : presetFunilId ? [presetFunilId]
      : [];
    setFunilIds(ids);
    setTitulo(teste?.titulo ?? '');
    setTipo((teste?.tipo ?? presetTipo ?? 'ab_interno') as typeof tipo);
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
  }, [open, teste, presetFunilId, presetPipelineStatus, presetTipo]);

  async function handleDuplicate() {
    if (!teste) return;
    setActioning(true);
    const { error } = await supabase.from('testes_funis').insert({
      funil_id:        funilIds[0] || null,
      funil_ids:       funilIds,
      titulo:          `${titulo.trim()} (cópia)`,
      tipo,
      variante_a:      varianteA || null,
      variante_b:      varianteB || null,
      metrica:         metrica || null,
      notas:           notas || null,
      pipeline_status: 'planejado',
      categoria:       categoria || null,
      impacto:         impacto || null,
      dificuldade:     dificuldade || null,
      kpi:             kpi || null,
      nome_ad:         nomeAd || null,
      link_ad:         linkAd || null,
      comentario_ad:   comentarioAd || null,
      criado_por:      user?.id,
    });
    setActioning(false);
    if (error) toast({ title: 'Erro ao duplicar', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Teste duplicado com sucesso' }); onSaved(); onClose(); }
  }

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
  // Um teste que já começou não precisa mais dos campos de planejamento, e
  // precisa dos de resultado. A data de início é o sinal mais confiável: o
  // status pode ter sido arrastado à mão sem o teste ter começado de fato.
  const jaComecou = Boolean(dataInicio) || pipelineStatus === 'rodando' || isConcluido;

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
                      const proj = f.projeto_id ? projetoMap[f.projeto_id] : null;
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
                  {/* Impacto e dificuldade servem para PRIORIZAR o que ainda não
                      começou — juntos formam o ICE que ordena a fila. Depois que
                      o teste está rodando não decidem mais nada, e ocupar espaço
                      ao lado do resultado real só atrapalha a leitura. */}
                  {!jaComecou && (
                    <>
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
                    </>
                  )}
                </div>
              </div>

              {/* Datas. "Data prevista" é promessa de quando vai começar: some
                  assim que começou, porque aí a data real já existe ao lado e
                  manter as duas convida a ler a errada. */}
              <div className={cn('grid gap-3', jaComecou ? 'grid-cols-2' : 'grid-cols-3')}>
                {!jaComecou && (
                  <div>
                    <Label>Previsão de início</Label>
                    <Input type="date" className="mt-1 h-8 text-sm" value={dataPrevista} onChange={e => setDataPrevista(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label>Início</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
                </div>
                <div>
                  <Label>Fim</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={dataFim} onChange={e => setDataFim(e.target.value)} />
                </div>
              </div>

              {/* Validação de REV novo: não existe "variante B".
                  O formulário pedia A e B para os três tipos, e só um deles tem
                  as duas coisas: dos 13 `funil_novo`, apenas UM tinha B. E onde
                  A estava preenchido, guardava outra coisa — "ROAS 1,11 /
                  Conversão 6,67%", ou seja, a META a bater. O campo pedia
                  variante e recebia linha de base, porque não havia campo de
                  linha de base. */}
              {tipo === 'funil_novo' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Precisa bater</Label>
                    {baseCarregando && (
                      <span className="text-[10px] text-muted-foreground">buscando…</span>
                    )}
                  </div>

                  {base ? (
                    <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-1.5">
                      <p className="text-[11px] text-muted-foreground">
                        {base.rev} · últimos {base.dias} dias ({base.de.slice(8)}/{base.de.slice(5,7)}
                        {' – '}{base.ate.slice(8)}/{base.ate.slice(5,7)})
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-sm font-semibold tabular-nums">{base.vendas_por_dia}</div>
                          <div className="text-[10px] text-muted-foreground">vendas/dia</div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold tabular-nums">
                            {formatCurrency(base.ticket_medio)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">ticket médio</div>
                        </div>
                        <div>
                          <div className="text-sm font-semibold tabular-nums">{base.vendas}</div>
                          <div className="text-[10px] text-muted-foreground">vendas no período</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Sem REV ativo vendendo, não há meta — e mostrar zeros seria
                    // pior que dizer que não há.
                    <p className="text-xs text-muted-foreground/60 italic">
                      {funilIds.length === 0
                        ? 'Escolha o REV para buscar a linha de base.'
                        : 'Nenhum REV ativo com vendas neste projeto ainda — este é o primeiro. Escreva a meta na hipótese abaixo.'}
                    </p>
                  )}

                  <Textarea
                    className="mt-1 h-14 resize-none text-sm"
                    placeholder="Meta ou observação sobre a linha de base…"
                    value={varianteA}
                    onChange={e => setVarianteA(e.target.value)}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Variante A (controle)</Label>
                    <Textarea
                      className="mt-1 h-16 resize-none text-sm"
                      placeholder="O que está no ar hoje..."
                      value={varianteA}
                      onChange={e => setVarianteA(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Variante B (desafiante)</Label>
                    <Textarea
                      className="mt-1 h-16 resize-none text-sm"
                      placeholder="O que vai ser testado contra..."
                      value={varianteB}
                      onChange={e => setVarianteB(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* O campo "Métrica principal" saiu daqui.
                  Era o MESMO que "KPI principal", logo acima — dois rótulos para
                  a mesma pergunta, em blocos diferentes da tela. E o resultado
                  foi o previsível: 26 testes preencheram um, 11 preencheram o
                  outro, e dos 7 que preencheram os dois, 6 se contradiziam
                  (kpi='AOV' com metrica='Conversão'), porque ninguém sabia qual
                  era para quê. O banco agora mantém `metrica` igual a `kpi`. */}

              {/* Resultados. Só aparecem depois que o teste começou: pedir o
                  resultado de um teste que ainda nem rodou é campo vazio
                  ocupando espaço, e ensina a ignorar campos vazios. */}
              {jaComecou && (
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
              )}

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
            <div className="flex gap-1 mr-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                disabled={actioning || saving}
                onClick={handleDuplicate}
              >
                Duplicar
              </Button>
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
