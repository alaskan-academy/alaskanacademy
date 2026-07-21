import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ChevronLeft, ChevronRight, Pencil, Save, X, ExternalLink,
  Clock, MessageSquare, CornerDownLeft, Send,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  FASES_MAP, FASES_POR_TIPO, canMoveFaseOut, getAdjacentFases, formatFieldName,
} from './constants';
import { TipoBadge } from './CriativoCard';
import { GerenciarOpcoesPopover } from './GerenciarOpcoesPopover';
import type { Criativo, HistoricoEntry, Comentario, ProducaoNivel, Funil, Perfil, CriativoTipo } from './types';

// Fallback values used while DB options are loading or if table is empty
const FALLBACK_FORMATOS           = ['Carrossel', 'Vídeo', 'Estático'];
const FALLBACK_PLATAFORMAS        = ['Meta Ads', 'TikTok', 'YouTube'];
const FALLBACK_TIPOS_TESTE        = ['Hook', 'Copy', 'Ângulo', 'Oferta', 'Formato', 'Outro'];
const FALLBACK_NIVEIS_CONSCIENCIA = [
  'Inconsciente', 'Consciente do Problema', 'Consciente da Solução',
  'Consciente do Produto', 'Totalmente Consciente',
];

interface Props {
  criativoId: string | null;
  onClose: () => void;
  onUpdate: () => void;
  nivel: ProducaoNivel;
  userId: string;
  funis: Funil[];
  perfis: Perfil[];
}

export function CriativoDrawer({ criativoId, onClose, onUpdate, nivel, userId, funis, perfis }: Props) {
  const { toast } = useToast();
  const [criativo, setCriativo]         = useState<Criativo | null>(null);
  const [historico, setHistorico]       = useState<HistoricoEntry[]>([]);
  const [comentarios, setComentarios]   = useState<Comentario[]>([]);
  const [loading, setLoading]           = useState(false);
  const [editing, setEditing]           = useState(false);
  const [changes, setChanges]           = useState<Record<string, string | null>>({});
  const [movingFase, setMovingFase]     = useState(false);
  // Dynamic select options from DB
  const [opFormato, setOpFormato]                 = useState<string[]>(FALLBACK_FORMATOS);
  const [opPlataforma, setOpPlataforma]           = useState<string[]>(FALLBACK_PLATAFORMAS);
  const [opTipoTeste, setOpTipoTeste]             = useState<string[]>(FALLBACK_TIPOS_TESTE);
  const [opNivelConsciencia, setOpNivelConsciencia] = useState<string[]>(FALLBACK_NIVEIS_CONSCIENCIA);
  // comentários
  const [novoComentario, setNovoComentario] = useState('');
  const [postando, setPostando]             = useState(false);
  const [respondendoId, setRespondendoId]   = useState<string | null>(null);
  const [novaResposta, setNovaResposta]     = useState('');

  const loadOpcoes = useCallback(async () => {
    const { data } = await supabase
      .from('criativo_campos_opcoes')
      .select('campo,valor')
      .order('ordem');
    if (!data) return;
    const byField = (campo: string) => data.filter(d => d.campo === campo).map(d => d.valor as string);
    const fmt = byField('formato');
    const plt = byField('plataforma');
    const tst = byField('tipo_teste');
    const niv = byField('nivel_consciencia');
    if (fmt.length)  setOpFormato(fmt);
    if (plt.length)  setOpPlataforma(plt);
    if (tst.length)  setOpTipoTeste(tst);
    if (niv.length)  setOpNivelConsciencia(niv);
  }, []);

  const loadComentarios = useCallback(async () => {
    if (!criativoId) return;
    const { data } = await supabase
      .from('criativo_comentarios')
      .select('*, autor:perfis!autor_id(nome)')
      .eq('criativo_id', criativoId)
      .order('criado_em', { ascending: true });
    if (!data) return;
    // agrupar respostas
    const top  = data.filter(c => !c.resposta_a);
    const subs = data.filter(c =>  c.resposta_a);
    const withReplies = top.map(c => ({
      ...c,
      respostas: subs.filter(r => r.resposta_a === c.id),
    }));
    setComentarios(withReplies);
  }, [criativoId]);

  const load = useCallback(async () => {
    if (!criativoId) return;
    setLoading(true);
    const [{ data: c }, { data: h }] = await Promise.all([
      supabase.from('criativos')
        .select([
          '*',
          'funil:funis(id,nome,produto)',
          'responsavel:perfis!responsavel_id(id,nome)',
          'copy:perfis!copy_id(id,nome)',
          'gestor:perfis!gestor_id(id,nome)',
        ].join(','))
        .eq('id', criativoId).single(),
      supabase.from('criativo_historico')
        .select('*, usuario:perfis!usuario_id(nome)')
        .eq('criativo_id', criativoId)
        .order('criado_em', { ascending: false }),
    ]);
    setCriativo(c);
    setHistorico(h ?? []);
    setLoading(false);
  }, [criativoId]);

  useEffect(() => { loadOpcoes(); }, [loadOpcoes]);

  useEffect(() => {
    load();
    loadComentarios();
    setEditing(false);
    setChanges({});
  }, [load, loadComentarios]);

  const ch  = (k: string, v: string | null) => setChanges(prev => ({ ...prev, [k]: v }));
  const val = (k: string): string => {
    if (k in changes) return changes[k] ?? '';
    return ((criativo as Record<string, unknown> | null)?.[k] as string | null) ?? '';
  };

  const handleSave = async () => {
    if (!criativo || Object.keys(changes).length === 0) { setEditing(false); return; }
    const { error } = await supabase.from('criativos').update(changes).eq('id', criativo.id);
    if (error) { toast({ title: 'Erro ao salvar', variant: 'destructive' }); return; }
    const entries = Object.entries(changes).map(([campo, valor_novo]) => ({
      criativo_id:    criativo.id,
      usuario_id:     userId,
      tipo_alteracao: 'campo' as const,
      campo_alterado: campo,
      valor_anterior: ((criativo as Record<string, unknown>)[campo] as string | null | undefined)?.toString() ?? null,
      valor_novo:     valor_novo?.toString() ?? null,
    }));
    if (entries.length) await supabase.from('criativo_historico').insert(entries);
    toast({ title: 'Salvo' });
    setEditing(false);
    setChanges({});
    load();
    onUpdate();
  };

  const handleFaseChange = async (novaFase: string) => {
    if (!criativo) return;
    if (!canMoveFaseOut(criativo.fase, nivel)) {
      toast({ title: 'Requer aprovação de um administrador', variant: 'destructive' });
      return;
    }
    setMovingFase(true);
    await supabase.from('criativos').update({ fase: novaFase }).eq('id', criativo.id);
    await supabase.from('criativo_historico').insert({
      criativo_id:    criativo.id,
      usuario_id:     userId,
      tipo_alteracao: 'fase',
      campo_alterado: 'fase',
      valor_anterior: criativo.fase,
      valor_novo:     novaFase,
    });
    if (novaFase === 'aprovado' && criativo.responsavel_id && criativo.responsavel_id !== userId) {
      await supabase.from('notificacoes').insert({
        usuario_id:      criativo.responsavel_id,
        tipo:            'criativo_aprovado',
        mensagem:        `"${criativo.nome}" foi aprovado.`,
        referencia_id:   criativo.id,
        referencia_tipo: 'criativo',
      });
    }
    setMovingFase(false);
    load();
    onUpdate();
  };

  const handleDelete = async () => {
    if (!criativo) return;
    if (!confirm(`Excluir "${criativo.nome}"? Esta ação não pode ser desfeita.`)) return;
    await supabase.from('criativos').delete().eq('id', criativo.id);
    onUpdate();
    onClose();
  };

  const handlePostComment = async () => {
    if (!criativo || !novoComentario.trim()) return;
    setPostando(true);
    await supabase.from('criativo_comentarios').insert({
      criativo_id: criativo.id,
      autor_id:    userId,
      texto:       novoComentario.trim(),
      tipo:        'comentario',
    });
    setNovoComentario('');
    setPostando(false);
    loadComentarios();
  };

  const handlePostReply = async (parentId: string) => {
    if (!criativo || !novaResposta.trim()) return;
    setPostando(true);
    await supabase.from('criativo_comentarios').insert({
      criativo_id: criativo.id,
      autor_id:    userId,
      texto:       novaResposta.trim(),
      tipo:        'comentario',
      resposta_a:  parentId,
    });
    setNovaResposta('');
    setRespondendoId(null);
    setPostando(false);
    loadComentarios();
  };

  if (!criativoId) return null;

  if (loading || !criativo) {
    return (
      <Sheet open onOpenChange={v => !v && onClose()}>
        <SheetContent side="right" className="w-full max-w-2xl">
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Carregando...</div>
        </SheetContent>
      </Sheet>
    );
  }

  const { prev: prevFase, next: nextFase } = getAdjacentFases(criativo.tipo, criativo.fase);
  const canAdvance   = !!(nextFase && canMoveFaseOut(criativo.fase, nivel));
  const isRevisaoFase = !!(FASES_POR_TIPO[criativo.tipo]?.includes(criativo.fase) &&
    ['revisao_copy', 'revisao_edicao'].includes(criativo.fase));
  const canEdit   = nivel === 'socio';
  const canDelete = nivel === 'socio';

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-5 py-3 flex items-start gap-3 z-10">
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input className="h-7 text-sm font-semibold"
                value={val('nome')} onChange={e => ch('nome', e.target.value)} />
            ) : (
              <h2 className="text-sm font-semibold text-foreground leading-snug">{criativo.nome}</h2>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <TipoBadge tipo={criativo.tipo} />
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">
                {FASES_MAP[criativo.fase] ?? criativo.fase}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {editing ? (
              <>
                <Button size="sm" variant="ghost" className="h-7 px-2"
                  onClick={() => { setEditing(false); setChanges({}); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" className="h-7 px-3" onClick={handleSave}>
                  <Save className="h-3.5 w-3.5 mr-1" />Salvar
                </Button>
              </>
            ) : (
              <>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={() => setEditing(true)}>
                    <Pencil className="h-3 w-3 mr-1" />Editar
                  </Button>
                )}
                {canDelete && (
                  <Button size="sm" variant="ghost"
                    className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                    onClick={handleDelete}>
                    Excluir
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Phase navigation */}
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Fase</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="text-xs h-7"
                disabled={!prevFase || movingFase}
                onClick={() => prevFase && handleFaseChange(prevFase)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                {prevFase ? (FASES_MAP[prevFase] ?? prevFase) : 'Início'}
              </Button>
              <span className="flex-1 text-center text-xs font-semibold text-foreground px-1">
                {FASES_MAP[criativo.fase] ?? criativo.fase}
              </span>
              <Button size="sm" className="text-xs h-7"
                disabled={!nextFase || !canAdvance || movingFase}
                onClick={() => nextFase && canAdvance && handleFaseChange(nextFase)}>
                {nextFase ? (FASES_MAP[nextFase] ?? nextFase) : 'Fim'}
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
            {(nivel === 'head' || nivel === 'socio') && (
              <Select
                value={criativo.fase}
                onValueChange={fase => fase !== criativo.fase && handleFaseChange(fase)}
                disabled={movingFase}
              >
                <SelectTrigger className="mt-2 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(FASES_POR_TIPO[criativo.tipo] ?? []).map(f => (
                    <SelectItem key={f} value={f}>{FASES_MAP[f] ?? f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isRevisaoFase && !canAdvance && (
              <p className="text-[11px] text-amber-400 mt-1.5">
                Aguardando aprovação do líder ou sócio para avançar.
              </p>
            )}
          </div>

          <Separator />

          {/* Core fields */}
          <div className="space-y-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Informações</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Funil" editing={editing}>
                {editing ? (
                  <Select value={val('funil_id') || '_'} onValueChange={v => ch('funil_id', v === '_' ? null : v)}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <span>{criativo.funil?.nome ?? '—'}</span>}
              </Field>
              <Field label="Editor" editing={editing}>
                {editing ? (
                  <Select value={val('responsavel_id') || '_'} onValueChange={v => ch('responsavel_id', v === '_' ? null : v)}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <span>{criativo.responsavel?.nome ?? criativo.editor_nome_historico ?? '—'}</span>}
              </Field>
              <Field label="Copy" editing={editing}>
                {editing ? (
                  <Select value={val('copy_id') || '_'} onValueChange={v => ch('copy_id', v === '_' ? null : v)}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <span>{criativo.copy?.nome ?? '—'}</span>}
              </Field>
              <Field label="Gestor de Tráfego" editing={editing}>
                {editing ? (
                  <Select value={val('gestor_id') || '_'} onValueChange={v => ch('gestor_id', v === '_' ? null : v)}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <span>{criativo.gestor?.nome ?? '—'}</span>}
              </Field>
              <Field label="Início" editing={editing}>
                {editing ? (
                  <Input type="date" className="h-7 text-xs mt-0.5"
                    value={val('data_inicio')} onChange={e => ch('data_inicio', e.target.value || null)} />
                ) : <span>{criativo.data_inicio
                  ? new Date(criativo.data_inicio + 'T00:00:00').toLocaleDateString('pt-BR')
                  : '—'}</span>}
              </Field>
              <Field label="Prazo (fim)" editing={editing}>
                {editing ? (
                  <Input type="date" className="h-7 text-xs mt-0.5"
                    value={val('data_prazo')} onChange={e => ch('data_prazo', e.target.value || null)} />
                ) : <span>{criativo.data_prazo
                  ? new Date(criativo.data_prazo + 'T00:00:00').toLocaleDateString('pt-BR')
                  : '—'}</span>}
              </Field>
            </div>
          </div>

          {/* Type-specific fields */}
          {criativo.tipo === 'criativo' && (
            <div className="space-y-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Criativo</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Formato" editing={editing}>
                  {editing ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Select value={val('formato') || '_'} onValueChange={v => ch('formato', v === '_' ? null : v)}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_">—</SelectItem>
                          {opFormato.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {nivel === 'socio' && <GerenciarOpcoesPopover campo="formato" label="Formato" onAtualizar={loadOpcoes} />}
                    </div>
                  ) : <span>{criativo.formato ?? '—'}</span>}
                </Field>
                <Field label="Plataforma" editing={editing}>
                  {editing ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Select value={val('plataforma') || '_'} onValueChange={v => ch('plataforma', v === '_' ? null : v)}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_">—</SelectItem>
                          {opPlataforma.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {nivel === 'socio' && <GerenciarOpcoesPopover campo="plataforma" label="Plataforma" onAtualizar={loadOpcoes} />}
                    </div>
                  ) : <span>{criativo.plataforma ?? '—'}</span>}
                </Field>
                <Field label="Tipo de Teste" editing={editing}>
                  {editing ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Select value={val('tipo_teste') || '_'} onValueChange={v => ch('tipo_teste', v === '_' ? null : v)}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_">—</SelectItem>
                          {opTipoTeste.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {nivel === 'socio' && <GerenciarOpcoesPopover campo="tipo_teste" label="Tipo de Teste" onAtualizar={loadOpcoes} />}
                    </div>
                  ) : <span>{criativo.tipo_teste ?? '—'}</span>}
                </Field>
                <Field label="Nível de Consciência" editing={editing}>
                  {editing ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Select value={val('nivel_consciencia') || '_'} onValueChange={v => ch('nivel_consciencia', v === '_' ? null : v)}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_">—</SelectItem>
                          {opNivelConsciencia.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {nivel === 'socio' && <GerenciarOpcoesPopover campo="nivel_consciencia" label="Nível de Consciência" onAtualizar={loadOpcoes} />}
                    </div>
                  ) : <span>{criativo.nivel_consciencia ?? '—'}</span>}
                </Field>
              </div>
              <Field label="Ângulo de Teste" editing={editing}>
                {editing ? (
                  <Input className="h-7 text-xs mt-0.5"
                    value={val('angulo_teste')} onChange={e => ch('angulo_teste', e.target.value || null)} />
                ) : <span>{criativo.angulo_teste ?? '—'}</span>}
              </Field>
            </div>
          )}

          {criativo.tipo === 'aula' && (
            <div className="space-y-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Aula</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Módulo" editing={editing}>
                  {editing ? (
                    <Input className="h-7 text-xs mt-0.5"
                      value={val('modulo')} onChange={e => ch('modulo', e.target.value || null)} />
                  ) : <span>{criativo.modulo ?? '—'}</span>}
                </Field>
                <Field label="Ordem" editing={editing}>
                  {editing ? (
                    <Input type="number" className="h-7 text-xs mt-0.5"
                      value={val('ordem')} onChange={e => ch('ordem', e.target.value || null)} />
                  ) : <span>{criativo.ordem ?? '—'}</span>}
                </Field>
              </div>
            </div>
          )}

          {/* Links */}
          <div className="space-y-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Links</p>
            {(['copy_url', 'video_gravado_url', 'video_editado_url'] as const).map(field => {
              const labelMap = { copy_url: 'Copy', video_gravado_url: 'Vídeo Gravado', video_editado_url: 'Vídeo Editado' };
              const raw = criativo[field];
              return (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-28 shrink-0">{labelMap[field]}</span>
                  {editing ? (
                    <Input className="h-6 text-xs flex-1" placeholder="https://..."
                      value={val(field)} onChange={e => ch(field, e.target.value || null)} />
                  ) : raw ? (
                    <a href={raw} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1 truncate flex-1">
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{raw}</span>
                    </a>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </div>
              );
            })}
          </div>

          {/* Notas */}
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Notas</p>
            {editing ? (
              <Textarea className="text-xs resize-none" rows={3}
                value={val('notas')} onChange={e => ch('notas', e.target.value || null)} />
            ) : (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {criativo.notas || '—'}
              </p>
            )}
          </div>

          <Separator />

          {/* Comentários */}
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3" />Comentários
              {comentarios.length > 0 && (
                <span className="ml-1 font-normal text-muted-foreground/60">({comentarios.length})</span>
              )}
            </p>

            {comentarios.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 mb-3">Nenhum comentário ainda.</p>
            ) : (
              <div className="space-y-3 mb-4">
                {comentarios.map(c => (
                  <ComentarioItem
                    key={c.id}
                    comentario={c}
                    respondendoId={respondendoId}
                    novaResposta={novaResposta}
                    postando={postando}
                    onReply={() => { setRespondendoId(c.id); setNovaResposta(''); }}
                    onCancelReply={() => setRespondendoId(null)}
                    onNovaRespostaChange={setNovaResposta}
                    onPostReply={() => handlePostReply(c.id)}
                  />
                ))}
              </div>
            )}

            {/* Nova mensagem */}
            <div className="flex gap-2 items-end">
              <Textarea
                rows={2}
                value={novoComentario}
                onChange={e => setNovoComentario(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePostComment();
                }}
                placeholder="Escreva um comentário... (Ctrl+Enter para enviar)"
                className="text-xs resize-none flex-1"
              />
              <Button
                size="sm"
                className="h-9 px-3 gap-1"
                disabled={!novoComentario.trim() || postando}
                onClick={handlePostComment}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Histórico */}
          <HistoricoSection historico={historico} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ComentarioItem({
  comentario, respondendoId, novaResposta, postando,
  onReply, onCancelReply, onNovaRespostaChange, onPostReply,
}: {
  comentario: Comentario;
  respondendoId: string | null;
  novaResposta: string;
  postando: boolean;
  onReply: () => void;
  onCancelReply: () => void;
  onNovaRespostaChange: (v: string) => void;
  onPostReply: () => void;
}) {
  const isSistema   = comentario.tipo === 'sistema';
  const isDevolucao = comentario.tipo === 'devolucao';

  return (
    <div className="flex flex-col gap-1">
      <div className={cn(
        'rounded-lg px-3 py-2 text-xs',
        isSistema   ? 'bg-muted/40 border border-border/50 text-muted-foreground italic' :
        isDevolucao ? 'bg-amber-500/10 border border-amber-500/20 text-amber-200' :
                     'bg-accent/30 border border-border/30',
      )}>
        <div className="flex items-center gap-1.5 mb-1">
          {isSistema ? (
            <span className="text-[10px] text-muted-foreground/60 font-medium">Sistema</span>
          ) : isDevolucao ? (
            <>
              <span className="font-semibold text-amber-300">{comentario.autor?.nome ?? '—'}</span>
              <Badge className="text-[9px] h-3.5 px-1 bg-amber-500/20 text-amber-300 border-amber-500/30 font-normal">
                Devolução
              </Badge>
            </>
          ) : (
            <span className="font-semibold">{comentario.autor?.nome ?? '—'}</span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/40">
            {new Date(comentario.criado_em).toLocaleString('pt-BR', {
              day: '2-digit', month: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        <p className="leading-relaxed whitespace-pre-wrap">{comentario.texto}</p>
      </div>

      {/* Respostas */}
      {(comentario.respostas ?? []).length > 0 && (
        <div className="ml-4 flex flex-col gap-1 border-l-2 border-border/30 pl-3">
          {(comentario.respostas ?? []).map(r => (
            <div key={r.id} className="rounded-lg px-3 py-2 text-xs bg-accent/20 border border-border/20">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-semibold">{r.autor?.nome ?? '—'}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/40">
                  {new Date(r.criado_em).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="leading-relaxed whitespace-pre-wrap">{r.texto}</p>
            </div>
          ))}
        </div>
      )}

      {/* Responder */}
      {!isSistema && (
        respondendoId === comentario.id ? (
          <div className="ml-4 flex gap-2 items-end">
            <Textarea
              autoFocus
              rows={2}
              value={novaResposta}
              onChange={e => onNovaRespostaChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onPostReply(); }}
              placeholder="Responder... (Ctrl+Enter para enviar)"
              className="text-xs resize-none flex-1"
            />
            <div className="flex flex-col gap-1">
              <Button size="sm" className="h-7 px-2 gap-1 text-xs" disabled={!novaResposta.trim() || postando} onClick={onPostReply}>
                <Send className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancelReply}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={onReply}
            className="self-start ml-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
          >
            <CornerDownLeft className="h-2.5 w-2.5" />Responder
          </button>
        )
      )}
    </div>
  );
}

function Field({ label, editing, children }: { label: string; editing: boolean; children: ReactNode }) {
  return (
    <div>
      <Label className="text-[10.5px] text-muted-foreground">{label}</Label>
      <div className={cn('text-xs text-foreground', editing ? '' : 'mt-0.5')}>{children}</div>
    </div>
  );
}

function HistoricoSection({ historico }: { historico: HistoricoEntry[] }) {
  const [expandido, setExpandido] = useState(false);
  const PREVIEW = 3;
  const total = historico.length;
  const exibidos = expandido ? historico : historico.slice(0, PREVIEW);

  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        Histórico de alterações
        {total > 0 && (
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            {total}
          </span>
        )}
      </p>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum registro</p>
      ) : (
        <>
          <div className="space-y-3">
            {exibidos.map(h => (
              <div key={h.id} className="flex gap-2 text-xs text-muted-foreground">
                <span className="shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-border ring-1 ring-border mt-[5px]" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-foreground/80">{h.usuario?.nome ?? 'Sistema'}</span>
                  {' '}
                  <HistoricoText entry={h} />
                  <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                    {formatDistanceToNow(new Date(h.criado_em), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {total > PREVIEW && (
            <button
              onClick={() => setExpandido(e => !e)}
              className="mt-3 text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {expandido ? 'Recolher' : `Ver tudo (${total})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function HistoricoText({ entry }: { entry: HistoricoEntry }) {
  if (entry.tipo_alteracao === 'criacao') {
    return <span>criou <span className="text-foreground">"{entry.valor_novo}"</span></span>;
  }
  if (entry.tipo_alteracao === 'fase') {
    return (
      <span>
        moveu de <span className="text-foreground">{FASES_MAP[entry.valor_anterior ?? ''] ?? entry.valor_anterior}</span>
        {' → '}
        <span className="text-foreground">{FASES_MAP[entry.valor_novo ?? ''] ?? entry.valor_novo}</span>
      </span>
    );
  }
  return (
    <span>
      alterou <span className="text-foreground">{formatFieldName(entry.campo_alterado ?? '')}</span>
      {entry.valor_anterior ? <> de <span className="text-muted-foreground">"{entry.valor_anterior}"</span></> : null}
      {entry.valor_novo ? <> para <span className="text-foreground">"{entry.valor_novo}"</span></> : null}
    </span>
  );
}
