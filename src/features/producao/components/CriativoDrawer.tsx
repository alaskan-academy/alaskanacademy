import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Pencil, Save, X, ExternalLink, GitBranch,
  Clock, MessageSquare, CornerDownLeft, Send, Maximize2, Minimize2, Copy, Trash2,
} from 'lucide-react';
import { supabase, linhas, linha } from '@/lib/supabase';
import { fetchProjetos } from '@/lib/dataCache';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  canMoveFaseOut, formatFieldName, rotuloDoPrazo,
} from './constants';
import { useFases, fasesDoTipo, rotuloDaFase } from '../useFases';
import { usePedirMotivo } from '../usePedirMotivo';
import { SeletorDePrazo } from './SeletorDePrazo';
import { TipoBadge } from './CriativoCard';
import { PedidoVariacaoModal } from './PedidoVariacaoModal';
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
  const { fases } = useFases();
  const { pedirMotivo, dialogoMotivo } = usePedirMotivo();
  const [criativo, setCriativo]         = useState<Criativo | null>(null);
  const [historico, setHistorico]       = useState<HistoricoEntry[]>([]);
  const [comentarios, setComentarios]   = useState<Comentario[]>([]);
  const [loading, setLoading]           = useState(false);
  const [editing, setEditing]           = useState(false);
  const [changes, setChanges]           = useState<Record<string, string | null | string[]>>({});
  const [movingFase, setMovingFase]     = useState(false);
  const [expanded, setExpanded]         = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  // Dynamic select options from DB
  const [opFormato, setOpFormato]                 = useState<string[]>(FALLBACK_FORMATOS);
  const [opPlataforma, setOpPlataforma]           = useState<string[]>(FALLBACK_PLATAFORMAS);
  const [opTipoTeste, setOpTipoTeste]             = useState<string[]>(FALLBACK_TIPOS_TESTE);
  const [opNivelConsciencia, setOpNivelConsciencia] = useState<string[]>(FALLBACK_NIVEIS_CONSCIENCIA);
  const [opFunilVideo, setOpFunilVideo]           = useState<string[]>(['TSL', 'VSL', 'QUIZ']);
  const [opStatusVeiculacao, setOpStatusVeiculacao] = useState<string[]>(['Rodando', 'Pausado', 'Encerrado', 'Bloqueado', 'Arquivado']);
  const [opAvaliacao, setOpAvaliacao]               = useState<string[]>(['Sem dados', 'Validado', 'Não validado']);
  const [projetos, setProjetos]                   = useState<{ id: string; nome: string }[]>([]);
  const [editores, setEditores]                   = useState<{ id: string; nome: string }[]>([]);
  const [copys, setCopys]                         = useState<{ id: string; nome: string }[]>([]);
  const [gestores, setGestores]                   = useState<{ id: string; nome: string }[]>([]);
  const [especialistas, setEspecialistas]         = useState<{ id: string; nome: string }[]>([]);
  // comentários
  /**
   * Pedir variação a partir da avaliação.
   *
   * `podePedir` sai da MESMA função que a RLS aplica (`fn_pode_pedir_variacao`:
   * Gestor de Tráfego ou admin), e não de uma cópia da regra aqui — quando a
   * tela e o banco escrevem a mesma condição em dois lugares, um dos dois
   * envelhece. Esta linha só evita oferecer um botão que a API recusaria.
   */
  const [podePedir, setPodePedir]           = useState(false);
  const [pedidoAberto, setPedidoAberto]     = useState(false);
  const [temPedido, setTemPedido]           = useState(false);

  const [novoComentario, setNovoComentario] = useState('');
  const [postando, setPostando]             = useState(false);
  const [respondendoId, setRespondendoId]   = useState<string | null>(null);
  const [novaResposta, setNovaResposta]     = useState('');

  const loadOpcoes = useCallback(async () => {
    const [{ data }, pj, { data: edData }] = await Promise.all([
      supabase.from('criativo_campos_opcoes').select('campo,valor').order('ordem'),
      fetchProjetos(),
      supabase.from('perfis').select('id,nome,setor:setores(nome)').eq('ativo', true).order('nome'),
    ]);
    if (data) {
      const byField = (campo: string) => data.filter(d => d.campo === campo).map(d => d.valor as string);
      const fv = byField('funil_video');
      if (fv.length) setOpFunilVideo(fv);
      const fmt = byField('formato');
      const plt = byField('plataforma');
      const tst = byField('tipo_teste');
      const niv = byField('nivel_consciencia');
      const sv  = byField('status_veiculacao');
      const av  = byField('avaliacao');
      if (fmt.length)  setOpFormato(fmt);
      if (plt.length)  setOpPlataforma(plt);
      if (tst.length)  setOpTipoTeste(tst);
      if (niv.length)  setOpNivelConsciencia(niv);
      if (sv.length)   setOpStatusVeiculacao(sv);
      if (av.length)   setOpAvaliacao(av);
    }
    setProjetos(pj as { id: string; nome: string }[]);
    if (edData) {
      type PerfComSetor = { id: string; nome: string; setor: { nome: string } | null };
      const all = linhas<PerfComSetor>(edData);
      const filterBy = (s: string) => all.filter(p => p.setor?.nome === s).map(p => ({ id: p.id, nome: p.nome }));
      const allSimple = all.map(p => ({ id: p.id, nome: p.nome }));
      const eds = filterBy('Editor');
      setEditores(eds.length > 0 ? eds : allSimple);
      const cps = filterBy('Copy');
      setCopys(cps.length > 0 ? cps : allSimple);
      const gsts = filterBy('Gestor de Tráfego');
      setGestores(gsts.length > 0 ? gsts : allSimple);
      const esps = filterBy('Especialista');
      setEspecialistas(esps.length > 0 ? esps : allSimple);
    }
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

  const load = useCallback(async (silent = false) => {
    if (!criativoId) return;
    if (!silent) setLoading(true);
    const [{ data: c }, { data: h }] = await Promise.all([
      supabase.from('producoes')
        .select([
          '*',
          'funil:funis(id,nome,produto)',
          'projeto:ofertas_editores!projeto_id(id,nome)',
          'responsavel:perfis!responsavel_id(id,nome)',
          'copy:perfis!copy_id(id,nome)',
          'gestor:perfis!gestor_id(id,nome)',
          'especialista:perfis!especialista_id(id,nome)',
        ].join(','))
        .eq('id', criativoId).single(),
      supabase.from('criativo_historico')
        .select('*, usuario:perfis!usuario_id(nome)')
        .eq('criativo_id', criativoId)
        .order('criado_em', { ascending: false }),
    ]);
    setCriativo(linha<Criativo>(c));
    setHistorico(h ?? []);
    setLoading(false);
  }, [criativoId]);

  useEffect(() => { loadOpcoes(); }, [loadOpcoes]);

  useEffect(() => {
    load();
    loadComentarios();
    setEditing(false);
    setChanges({});
    setShowCloseWarning(false);
  }, [load, loadComentarios]); // nivel is intentionally excluded — it doesn't change independently

  const loadPedido = useCallback(async () => {
    if (!criativoId) { setTemPedido(false); return; }
    const [pode, pedido] = await Promise.all([
      supabase.rpc('fn_pode_pedir_variacao'),
      supabase.from('pedidos_variacao').select('id')
        .eq('producao_id', criativoId).eq('status', 'aberto').maybeSingle(),
    ]);
    setPodePedir(pode.data === true);
    setTemPedido(!!pedido.data);
  }, [criativoId]);

  useEffect(() => { void loadPedido(); }, [loadPedido]);

  const ch     = (k: string, v: string | null | string[]) => setChanges(prev => ({ ...prev, [k]: v }));
  const val    = (k: string): string => {
    if (k in changes) return (changes[k] as string | null) ?? '';
    return ((criativo as unknown as Record<string, unknown> | null)?.[k] as string | null) ?? '';
  };
  const valArr = (k: string): string[] => {
    if (k in changes) return (changes[k] as string[]) ?? [];
    return ((criativo as unknown as Record<string, unknown> | null)?.[k] as string[] | null) ?? [];
  };
  const toggleFunilId = (id: string) => {
    const current = valArr('funil_ids');
    ch('funil_ids', current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  };
  const valFunilVideoArr = (): string[] => {
    const raw = val('funil_video');
    return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  };
  const toggleFunilVideoItem = (item: string) => {
    const current = valFunilVideoArr();
    const next = current.includes(item) ? current.filter(x => x !== item) : [...current, item];
    ch('funil_video', next.length > 0 ? next.join(',') : null);
  };

  const valNivelConscienciaArr = (): string[] => {
    const raw = val('nivel_consciencia');
    return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  };
  const toggleNivelConsciencia = (item: string) => {
    const current = valNivelConscienciaArr();
    const next = current.includes(item) ? current.filter(x => x !== item) : [...current, item];
    ch('nivel_consciencia', next.length > 0 ? next.join(',') : null);
  };

  const handleSave = async () => {
    if (!criativo || Object.keys(changes).length === 0) { setEditing(false); return; }
    const { error } = await supabase.from('producoes').update(changes).eq('id', criativo.id);
    if (error) { toast({ title: 'Erro ao salvar', variant: 'destructive' }); return; }
    const stringify = (v: unknown): string | null =>
      Array.isArray(v) ? (v as string[]).join(',') : (v as string | null | undefined)?.toString() ?? null;
    const entries = Object.entries(changes).map(([campo, valor_novo]) => ({
      criativo_id:    criativo.id,
      usuario_id:     userId,
      tipo_alteracao: 'campo' as const,
      campo_alterado: campo,
      valor_anterior: stringify((criativo as unknown as Record<string, unknown>)[campo]),
      valor_novo:     stringify(valor_novo),
    }));
    if (entries.length) await supabase.from('criativo_historico').insert(entries);
    toast({ title: 'Salvo' });
    setEditing(false);
    setChanges({});
    load(true);
    onUpdate();
  };

  const handleFaseChange = async (novaFase: string) => {
    if (!criativo) return;
    if (!canMoveFaseOut(criativo.fase, nivel)) {
      toast({ title: 'Requer aprovação de um administrador', variant: 'destructive' });
      return;
    }

    /*
      Arquivar pede o porque ANTES de gravar.

      Se `producao_fases.exige_motivo` for falso para o destino, `pedirMotivo`
      devolve '' na hora e nada aparece na tela — o caminho normal nao paga
      nada por esta regra existir.
    */
    const motivo = await pedirMotivo(fases.find(f => f.chave === novaFase));
    if (motivo === null) return;   // desistiu no dialogo: o card fica onde esta

    setMovingFase(true);
    await supabase.from('producoes').update({ fase: novaFase }).eq('id', criativo.id);
    await supabase.from('criativo_historico').insert({
      criativo_id:    criativo.id,
      usuario_id:     userId,
      tipo_alteracao: 'fase',
      campo_alterado: 'fase',
      valor_anterior: criativo.fase,
      valor_novo:     novaFase,
      motivo:         motivo || null,
    });
    /*
      O aviso ao responsável não é mais escrito aqui: quem escreve é o gatilho
      em `producoes`. Esta mesma regra estava em três lugares — aqui, no kanban
      e dentro de `fn_devolver_criativo` — e as três já discordavam entre si.
    */
    setMovingFase(false);
    load(true);
    onUpdate();
  };

  const handleDelete = async () => {
    if (!criativo) return;
    if (!confirm(`Excluir "${criativo.nome}"? Esta ação não pode ser desfeita.`)) return;
    await supabase.from('producoes').delete().eq('id', criativo.id);
    onUpdate();
    onClose();
  };

  /**
   * Duplicar deixou de listar campo a campo.
   *
   * Esta lista tinha ~25 nomes escritos à mão, e havia OUTRA igual no
   * Calendário. As duas já divergiam — só esta gravava no histórico — e nenhuma
   * copiava `video_story_url`, que está preenchido em 80% dos cards: duplicar
   * perdia o vídeo de story sem dizer nada.
   *
   * No banco as colunas são derivadas da própria tabela, então coluna nova
   * passa a ser copiada sozinha. Conferido comparando cópia e original campo a
   * campo: só diferem id, nome e os dois carimbos de data.
   */
  const handleDuplicate = async () => {
    if (!criativo) return;
    const { data, error } = await supabase.rpc('fn_duplicar_criativos', {
      p_ids:     [criativo.id],
      p_usuario: userId,
    });
    const novoId = (data as string[] | null)?.[0];
    if (error || !novoId) {
      toast({ title: 'Erro ao duplicar', description: error?.message, variant: 'destructive' });
      return;
    }
    // O histórico é gravado DENTRO da função, na mesma transação. Escrever aqui
    // seria uma segunda linha para o mesmo fato — e uma que podia falhar
    // sozinha, deixando a cópia sem registro de origem.
    toast({ title: 'Duplicado com sucesso' });
  };

  const handlePostComment = async () => {
    if (!criativo || !novoComentario.trim()) return;
    setPostando(true);
    const texto = novoComentario.trim();
    await supabase.from('criativo_comentarios').insert({
      criativo_id: criativo.id,
      autor_id:    userId,
      texto,
      tipo:        'comentario',
    });
    /*
      As menções saem do gatilho em `criativo_comentarios`, que lê o próprio
      texto do comentário — inclusive "@ana," com a vírgula colada, que o
      `@(\S+)` daqui perdia porque levava a pontuação junto.
    */
    setNovoComentario('');
    setPostando(false);
    loadComentarios();
  };

  const handleEditComment = async (id: string, texto: string) => {
    await supabase.from('criativo_comentarios').update({ texto }).eq('id', id);
    loadComentarios();
  };

  const handleDeleteComment = async (id: string) => {
    await supabase.from('criativo_comentarios').delete().eq('id', id);
    loadComentarios();
  };

  const handlePostReply = async (parentId: string) => {
    if (!criativo || !novaResposta.trim()) return;
    setPostando(true);
    const texto = novaResposta.trim();
    await supabase.from('criativo_comentarios').insert({
      criativo_id: criativo.id,
      autor_id:    userId,
      texto,
      tipo:        'comentario',
      resposta_a:  parentId,
    });
    /*
      Mesma coisa aqui — e a resposta agora avisa também quem está sendo
      respondido, que era o buraco mais óbvio: responder a alguém não produzia
      aviso nenhum, só o @ produzia.
    */
    setNovaResposta('');
    setRespondendoId(null);
    setPostando(false);
    loadComentarios();
  };

  const handleAttemptClose = () => {
    if (editing && Object.keys(changes).length > 0) {
      setShowCloseWarning(true);
    } else {
      onClose();
    }
  };

  const handleDiscardAndClose = () => {
    setShowCloseWarning(false);
    setChanges({});
    setEditing(false);
    onClose();
  };

  if (!criativoId) return null;

  const sheetStyle = expanded ? { width: '100vw', maxWidth: '100vw' } : { width: '40vw', maxWidth: '40vw' };

  if (loading || !criativo) {
    return (
      <>
        <AlertDialog open={showCloseWarning} onOpenChange={setShowCloseWarning}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Alterações não salvas</AlertDialogTitle>
              <AlertDialogDescription>Você tem alterações que ainda não foram salvas. O que deseja fazer?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowCloseWarning(false)}>Continuar editando</AlertDialogCancel>
              <AlertDialogAction className="bg-transparent text-foreground border border-border hover:bg-accent" onClick={handleDiscardAndClose}>Descartar e fechar</AlertDialogAction>
              <AlertDialogAction onClick={async () => { setShowCloseWarning(false); await handleSave(); onClose(); }}>Salvar e fechar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Sheet open onOpenChange={v => !v && handleAttemptClose()}>
          <SheetContent side="right" className="p-0 flex flex-col" style={sheetStyle}>
            <SheetTitle className="sr-only">Carregando o card</SheetTitle>
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Carregando...</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  const canAdvance    = canMoveFaseOut(criativo.fase, nivel);

  /* As fases do seletor saem da tabela `producao_fases`, e nao de uma lista no
     codigo. A fase ATUAL entra sempre — ver `fasesDoTipo`. */
  const fasesDoCard   = fasesDoTipo(fases, criativo.tipo, criativo.fase);
  const noFluxo       = fasesDoCard.filter(f => !f.fora_do_fluxo);
  const saidas        = fasesDoCard.filter(f =>  f.fora_do_fluxo);

  /* "Esta revisao espera aprovacao" pergunta a tabela se a fase E de revisao,
     em vez de comparar com duas chaves escritas a mao. */
  const isRevisaoFase = !!fasesDoCard.find(f => f.chave === criativo.fase)?.e_revisao;

  /*
    Por que este card foi parar aqui.

    Pedir o motivo e nao mostra-lo em lugar nenhum seria a segunda armadilha de
    novo — cadastro sem a coluna de resultado ao lado. Ele fica DEBAIXO do
    campo Fase, e nao so no historico: quem abre um card arquivado quer saber
    por que antes de decidir se reabre.

    Sai do historico que ja esta carregado (ordenado do mais novo para o mais
    velho), entao um card arquivado duas vezes mostra o motivo da ultima.
  */
  const motivoDaFase = historico.find(
    h => h.campo_alterado === 'fase' && h.valor_novo === criativo.fase && h.motivo,
  )?.motivo ?? null;
  const canEdit   = nivel === 'socio';
  const canDelete = nivel === 'socio';

  // ─── layout helpers ──────────────────────────────────────────────────────────

  const slLabel = (txt: string, icon?: ReactNode) => (
    <p className={cn(
      'font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5',
      expanded ? 'text-[13px] mb-3' : 'text-[10.5px] mb-2',
    )}>
      {icon}{txt}
    </p>
  );

  const fieldsPane = (
    <div className="space-y-5">
      {/* Phase navigation */}
      <div>
        {slLabel('Fase')}
        <Select
          value={criativo.fase}
          onValueChange={v => { if (v !== criativo.fase) handleFaseChange(v); }}
          disabled={movingFase}
        >
          <SelectTrigger className={cn(expanded ? 'h-9 text-sm' : 'h-8 text-xs')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {noFluxo.map(f => (
              <SelectItem key={f.chave} value={f.chave}>{f.rotulo}</SelectItem>
            ))}
            {/* Saida nao e degrau: Arquivado logo abaixo de Postado, sem risco,
                leria como "o passo depois de postar". Separadas, leem como o
                que sao — fins de linha, para o card que nao chegou a rodar. */}
            {saidas.length > 0 && <SelectSeparator />}
            {saidas.map(f => (
              <SelectItem key={f.chave} value={f.chave}>{f.rotulo}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isRevisaoFase && !canAdvance && (
          <p className={cn('text-amber-400 mt-1.5', expanded ? 'text-sm' : 'text-[11px]')}>
            Aguardando aprovação do líder ou sócio para avançar.
          </p>
        )}
        {motivoDaFase && (
          <p className={cn('text-muted-foreground mt-1.5', expanded ? 'text-sm' : 'text-[11px]')}>
            Motivo: {motivoDaFase}
          </p>
        )}
      </div>

      <Separator />

      {/* Projeto */}
      <Field label="Projeto" editing={editing}>
        {editing ? (
          <Select value={val('projeto_id') || '_'} onValueChange={v => ch('projeto_id', v === '_' ? null : v)}>
            <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_">—</SelectItem>
              {projetos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <span>{criativo.projeto?.nome ?? '—'}</span>}
      </Field>

      {/* Equipe */}
      <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
        {slLabel('Equipe')}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Especialista" editing={editing}>
            {editing ? (
              <Select value={val('especialista_id') || '_'} onValueChange={v => ch('especialista_id', v === '_' ? null : v)}>
                <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">—</SelectItem>
                  {especialistas.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : <span>{criativo.especialista?.nome ?? '—'}</span>}
          </Field>

          {criativo.tipo !== 'aula' ? (
            <Field label="Copy" editing={editing}>
              {editing ? (
                <Select value={val('copy_id') || '_'} onValueChange={v => ch('copy_id', v === '_' ? null : v)}>
                  <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_">—</SelectItem>
                    {copys.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <span>{criativo.copy?.nome ?? '—'}</span>}
            </Field>
          ) : (
            <Field label="Editor" editing={editing}>
              {editing ? (
                <Select value={val('responsavel_id') || '_'} onValueChange={v => ch('responsavel_id', v === '_' ? null : v)}>
                  <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_">—</SelectItem>
                    {editores.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <span>{criativo.responsavel?.nome ?? criativo.editor_nome_historico ?? '—'}</span>}
            </Field>
          )}

          {criativo.tipo !== 'aula' && (
            <>
              <Field label="Editor" editing={editing}>
                {editing ? (
                  <Select value={val('responsavel_id') || '_'} onValueChange={v => ch('responsavel_id', v === '_' ? null : v)}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {editores.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <span>{criativo.responsavel?.nome ?? criativo.editor_nome_historico ?? '—'}</span>}
              </Field>
              <Field label="Gestor de Tráfego" editing={editing}>
                {editing ? (
                  <Select value={val('gestor_id') || '_'} onValueChange={v => ch('gestor_id', v === '_' ? null : v)}>
                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {gestores.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : <span>{criativo.gestor?.nome ?? '—'}</span>}
              </Field>
            </>
          )}
        </div>
      </div>

      {/* Cronograma */}
      <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
        {slLabel('Cronograma')}
        {/* Um campo no lugar de "Início" + "Prazo (fim)". A leitura mostra o
            período quando existe e a data sozinha quando não — mesma frase
            que o seletor usa, vinda da mesma função. */}
        <Field label="Data" editing={editing}>
          {editing ? (
            <div className="mt-0.5">
              <SeletorDePrazo
                inicio={val('data_inicio') || null}
                prazo={val('data_prazo') || null}
                onChange={(i, p) => { ch('data_inicio', i); ch('data_prazo', p); }}
              />
            </div>
          ) : (
            <span>{criativo.data_inicio || criativo.data_prazo
              ? rotuloDoPrazo(criativo.data_inicio, criativo.data_prazo)
              : '—'}</span>
          )}
        </Field>
      </div>

      {/* Campos específicos por tipo — mesma ordem do form de criação */}
      {criativo.tipo === 'criativo' && (
        <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
          {slLabel('Criativo')}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Funil de Vendas" editing={editing}>
              {editing ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="h-7 text-xs flex-1 flex items-center px-2 rounded-md border border-input bg-background hover:bg-accent transition-colors text-left min-w-0">
                        {valFunilVideoArr().length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : <span className="truncate">{valFunilVideoArr().join(', ')}</span>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-36 p-2" align="start">
                      {opFunilVideo.map(v => (
                        <div key={v} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted cursor-pointer"
                          onClick={() => toggleFunilVideoItem(v)}>
                          <Checkbox checked={valFunilVideoArr().includes(v)} onCheckedChange={() => toggleFunilVideoItem(v)} />
                          <span className="text-xs">{v}</span>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                  <GerenciarOpcoesPopover campo="funil_video" label="Métodos de Venda" onAtualizar={loadOpcoes} />
                </div>
              ) : (
                <span>
                  {criativo.funil_video
                    ? criativo.funil_video.split(',').map(s => s.trim()).filter(Boolean).join(', ')
                    : '—'}
                </span>
              )}
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="h-7 text-xs flex-1 flex items-center px-2 rounded-md border border-input bg-background hover:bg-accent transition-colors text-left min-w-0">
                        {valNivelConscienciaArr().length === 0
                          ? <span className="text-muted-foreground">—</span>
                          : <span className="truncate">{valNivelConscienciaArr().join(', ')}</span>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-2" align="start">
                      {opNivelConsciencia.map(n => (
                        <div key={n} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted cursor-pointer"
                          onClick={() => toggleNivelConsciencia(n)}>
                          <Checkbox checked={valNivelConscienciaArr().includes(n)} onCheckedChange={() => toggleNivelConsciencia(n)} />
                          <span className="text-xs">{n}</span>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                  {nivel === 'socio' && <GerenciarOpcoesPopover campo="nivel_consciencia" label="Nível de Consciência" onAtualizar={loadOpcoes} />}
                </div>
              ) : (
                <span>
                  {criativo.nivel_consciencia
                    ? criativo.nivel_consciencia.split(',').map(s => s.trim()).filter(Boolean).join(', ')
                    : '—'}
                </span>
              )}
            </Field>
            <Field label="Ângulo de Teste" editing={editing}>
              {editing ? (
                <Input className="h-7 text-xs mt-0.5"
                  value={val('angulo_teste')} onChange={e => ch('angulo_teste', e.target.value || null)} />
              ) : <span>{criativo.angulo_teste ?? '—'}</span>}
            </Field>
          </div>
        </div>
      )}

      {criativo.tipo === 'aula' && (
        <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
          {slLabel('Aula')}
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

      {/* Links — always editable inline */}
      <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-2">
        {slLabel('Links')}
        {(['copy_url', 'video_gravado_url', 'video_editado_url'] as const).map(field => {
          const labelMap = { copy_url: 'Copy', video_gravado_url: 'Vídeo Gravado', video_editado_url: 'Vídeo Editado' };
          const raw = (field in changes ? changes[field] as string | null : criativo[field]) ?? '';
          return (
            <div key={field} className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-28 shrink-0">{labelMap[field]}</span>
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <Input
                  className="h-6 text-xs flex-1"
                  placeholder="https://..."
                  value={raw}
                  onChange={e => ch(field, e.target.value || null)}
                  onBlur={async () => {
                    if (!(field in changes)) return;
                    const newVal = changes[field] as string | null;
                    if (newVal === (criativo[field] ?? null)) return;
                    await supabase.from('producoes').update({ [field]: newVal || null }).eq('id', criativo.id);
                    await supabase.from('criativo_historico').insert({
                      criativo_id:    criativo.id,
                      usuario_id:     userId,
                      tipo_alteracao: 'campo',
                      campo_alterado: field,
                      valor_anterior: criativo[field] ?? null,
                      valor_novo:     newVal || null,
                    });
                    setCriativo(prev => prev ? { ...prev, [field]: newVal } : prev);
                    setChanges(prev => { const n = { ...prev }; delete n[field]; return n; });
                    load(true);
                  }}
                />
                {raw && (
                  <a href={raw} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary shrink-0">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Veiculação — só para criativo e VSL */}
      {criativo.tipo !== 'aula' && (
        <div className="rounded-lg border border-border bg-muted/50 p-3 space-y-3">
          {slLabel('Veiculação')}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Status" editing={editing}>
              {editing ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <Select
                    value={val('status_veiculacao') || '_'}
                    onValueChange={v => ch('status_veiculacao', v === '_' ? null : v)}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {opStatusVeiculacao.map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {nivel === 'socio' && <GerenciarOpcoesPopover campo="status_veiculacao" label="Status de Veiculação" onAtualizar={loadOpcoes} />}
                </div>
              ) : (
                <span>{criativo.status_veiculacao ?? '—'}</span>
              )}
            </Field>
            <Field label="Avaliação" editing={editing}>
              {editing ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <Select
                    value={val('avaliacao') || '_'}
                    onValueChange={v => ch('avaliacao', v === '_' ? null : v)}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {opAvaliacao.map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {nivel === 'socio' && <GerenciarOpcoesPopover campo="avaliacao" label="Avaliação" onAtualizar={loadOpcoes} />}
                </div>
              ) : (
                <span>{criativo.avaliacao ?? '—'}</span>
              )}
            </Field>
          </div>

          {/*
            O pedido de variação nasce AQUI, colado na avaliação, porque é o
            mesmo momento: quem acabou de olhar o desempenho e decidir se o
            criativo prestou é quem sabe se vale insistir nele. Um segundo lugar
            para registrar essa decisão seria a primeira armadilha do CLAUDE.md.
          */}
          {podePedir && (
            <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
              {temPedido ? (
                <p className="text-[11px] text-emerald-400/90">
                  Já existe um pedido de variação aberto para este criativo, na esteira do Copy.
                </p>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => setPedidoAberto(true)}>
                    <GitBranch className="mr-1.5 h-3 w-3" />
                    Pedir variação
                  </Button>
                  <span className="text-[10px] text-muted-foreground/60">
                    entra na esteira do Copy com o histórico de verba deste anúncio
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {pedidoAberto && criativo && (
        <PedidoVariacaoModal
          open
          producaoId={criativo.id}
          nome={criativo.nome}
          onClose={() => setPedidoAberto(false)}
          onSalvo={() => void loadPedido()}
        />
      )}

      {/* Notas */}
      <div className="rounded-lg border border-border bg-muted/50 p-3">
        {slLabel('Notas')}
        {editing ? (
          <Textarea className="text-xs resize-none" rows={3}
            value={val('notas')} onChange={e => ch('notas', e.target.value || null)} />
        ) : (
          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {criativo.notas || '—'}
          </p>
        )}
      </div>
    </div>
  );

  const sidePane = (
    <div className="space-y-5">
      {/* Comentários */}
      <div>
        <p className={cn(
          'font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5',
          expanded ? 'text-[13px] mb-3' : 'text-[10.5px] mb-3',
        )}>
          <MessageSquare className={expanded ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
          Comentários
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
                userId={userId}
                respondendoId={respondendoId}
                novaResposta={novaResposta}
                postando={postando}
                perfis={perfis}
                onReply={() => { setRespondendoId(c.id); setNovaResposta(''); }}
                onCancelReply={() => setRespondendoId(null)}
                onNovaRespostaChange={setNovaResposta}
                onPostReply={() => handlePostReply(c.id)}
                onEdit={handleEditComment}
                onDelete={handleDeleteComment}
              />
            ))}
          </div>
        )}

        {/* Nova mensagem */}
        <div className="flex gap-2 items-end">
          <MentionTextarea
            value={novoComentario}
            onChange={setNovoComentario}
            onSubmit={handlePostComment}
            perfis={perfis}
            placeholder="Escreva um comentário... (Ctrl+Enter para enviar, @ para mencionar)"
            rows={expanded ? 4 : 2}
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
  );

  return (
    <>
    {dialogoMotivo}
    <AlertDialog open={showCloseWarning} onOpenChange={setShowCloseWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alterações não salvas</AlertDialogTitle>
          <AlertDialogDescription>
            Você tem alterações que ainda não foram salvas. O que deseja fazer?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setShowCloseWarning(false)}>
            Continuar editando
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-transparent text-foreground border border-border hover:bg-accent"
            onClick={handleDiscardAndClose}
          >
            Descartar e fechar
          </AlertDialogAction>
          <AlertDialogAction onClick={async () => { setShowCloseWarning(false); await handleSave(); onClose(); }}>
            Salvar e fechar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Sheet open onOpenChange={v => !v && handleAttemptClose()}>
      <SheetContent side="right" className="p-0 flex flex-col" style={sheetStyle}>
        {/* Header */}
        <div className={cn(
          'sticky top-0 bg-background border-b flex items-start gap-3 z-10',
          expanded ? 'px-7 py-4' : 'px-5 py-3',
        )}>
          <div className="flex-1 min-w-0">
            {editing ? (
              <>
                <SheetTitle className="sr-only">{criativo.nome}</SheetTitle>
                <Input
                  className={cn('font-semibold', expanded ? 'h-9 text-base' : 'h-7 text-sm')}
                  value={val('nome')}
                  onChange={e => ch('nome', e.target.value)}
                />
              </>
            ) : (
              <SheetTitle asChild>
                <h2 className={cn('font-semibold text-foreground leading-snug', expanded ? 'text-xl' : 'text-sm')}>
                  {criativo.nome}
                </h2>
              </SheetTitle>
            )}
            <div className="flex items-center gap-1.5 mt-1.5">
              <TipoBadge tipo={criativo.tipo} />
              <Badge variant="outline" className={cn('font-normal', expanded ? 'text-xs h-5 px-2' : 'text-[10px] h-4 px-1.5')}>
                {rotuloDaFase(fases, criativo.fase)}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 px-2"
              onClick={() => setExpanded(e => !e)}>
              {expanded
                ? <Minimize2 className="h-3.5 w-3.5" />
                : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
            {editing ? (
              <>
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
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                      onClick={handleDuplicate}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost"
                      className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                      onClick={handleDelete}>
                      Excluir
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Body — two-column when expanded, single-column otherwise */}
        {expanded ? (
          <div className="flex-1 overflow-hidden flex">
            <div className="flex-[0_0_60%] overflow-y-auto px-7 py-6 border-r border-border/40">
              {fieldsPane}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 bg-muted/5">
              {sidePane}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {fieldsPane}
            <Separator />
            {sidePane}
          </div>
        )}
      </SheetContent>
    </Sheet>
    </>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ComentarioItem({
  comentario, userId, respondendoId, novaResposta, postando, perfis,
  onReply, onCancelReply, onNovaRespostaChange, onPostReply, onEdit, onDelete,
}: {
  comentario: Comentario;
  userId: string;
  respondendoId: string | null;
  novaResposta: string;
  postando: boolean;
  perfis: Perfil[];
  onReply: () => void;
  onCancelReply: () => void;
  onNovaRespostaChange: (v: string) => void;
  onPostReply: () => void;
  onEdit: (id: string, texto: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editMode, setEditMode]           = useState(false);
  const [editText, setEditText]           = useState(comentario.texto);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editReplyText, setEditReplyText] = useState('');

  const isSistema   = comentario.tipo === 'sistema';
  const isDevolucao = comentario.tipo === 'devolucao';
  const isMine      = comentario.autor_id === userId;

  function saveEdit() {
    if (editText.trim()) onEdit(comentario.id, editText.trim());
    setEditMode(false);
  }

  function startEditReply(r: Comentario) {
    setEditingReplyId(r.id);
    setEditReplyText(r.texto);
  }

  function saveReplyEdit(id: string) {
    if (editReplyText.trim()) onEdit(id, editReplyText.trim());
    setEditingReplyId(null);
  }

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
          {!isSistema && isMine && !editMode && (
            <div className="flex items-center gap-0.5 ml-1">
              <button
                onClick={() => { setEditText(comentario.texto); setEditMode(true); }}
                className="p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                title="Editar"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={() => onDelete(comentario.id)}
                className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-colors"
                title="Excluir"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
        {editMode ? (
          <div className="flex flex-col gap-1.5 mt-1">
            <Textarea
              autoFocus
              rows={2}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="text-xs resize-none"
            />
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditMode(false)}>
                Cancelar
              </Button>
              <Button size="sm" className="h-6 px-2 text-xs" onClick={saveEdit}>
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <p className="leading-relaxed whitespace-pre-wrap"><TextWithMentions text={comentario.texto} /></p>
        )}
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
                {r.autor_id === userId && editingReplyId !== r.id && (
                  <div className="flex items-center gap-0.5 ml-1">
                    <button
                      onClick={() => startEditReply(r)}
                      className="p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                      title="Editar"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={() => onDelete(r.id)}
                      className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )}
              </div>
              {editingReplyId === r.id ? (
                <div className="flex flex-col gap-1.5 mt-1">
                  <Textarea
                    autoFocus
                    rows={2}
                    value={editReplyText}
                    onChange={e => setEditReplyText(e.target.value)}
                    className="text-xs resize-none"
                  />
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditingReplyId(null)}>
                      Cancelar
                    </Button>
                    <Button size="sm" className="h-6 px-2 text-xs" onClick={() => saveReplyEdit(r.id)}>
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="leading-relaxed whitespace-pre-wrap"><TextWithMentions text={r.texto} /></p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Responder */}
      {!isSistema && (
        respondendoId === comentario.id ? (
          <div className="ml-4 flex gap-2 items-end">
            <MentionTextarea
              autoFocus
              rows={2}
              value={novaResposta}
              onChange={onNovaRespostaChange}
              onSubmit={onPostReply}
              perfis={perfis}
              placeholder="Responder... (Ctrl+Enter para enviar, @ para mencionar)"
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

function TextWithMentions({ text }: { text: string }) {
  const parts = text.split(/(@\S+)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="text-blue-400 font-medium">{part}</span>
        ) : (
          part
        )
      )}
    </>
  );
}

function MentionTextarea({
  value, onChange, onSubmit, perfis, placeholder, rows = 2, className, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  perfis: Perfil[];
  placeholder?: string;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dropdown, setDropdown] = useState<Perfil[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const getMentionRange = (text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = before.match(/@(\w*)$/);
    if (!match) return null;
    return { start: cursor - match[0].length, query: match[1] };
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    const cursor = e.target.selectionStart ?? v.length;
    const range = getMentionRange(v, cursor);
    if (range) {
      const q = range.query.toLowerCase();
      const filtered = perfis.filter(p => !q || p.nome.toLowerCase().includes(q));
      setDropdown(filtered.slice(0, 6));
      setSelectedIdx(0);
    } else {
      setDropdown([]);
    }
  };

  const selectMention = (perfil: Perfil) => {
    const textarea = ref.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const range = getMentionRange(value, cursor);
    if (!range) return;
    const before = value.slice(0, range.start);
    const after = value.slice(cursor);
    onChange(`${before}@${perfil.nome} ${after}`);
    setDropdown([]);
    setTimeout(() => {
      const pos = range.start + perfil.nome.length + 2;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (dropdown.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, dropdown.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (dropdown[selectedIdx]) selectMention(dropdown[selectedIdx]);
        return;
      }
      if (e.key === 'Escape') { setDropdown([]); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSubmit();
  };

  return (
    <div className="relative flex-1">
      <Textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn('text-xs resize-none', className)}
        autoFocus={autoFocus}
      />
      {dropdown.length > 0 && (
        <div className="absolute left-0 right-0 bottom-full mb-1 z-50 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {dropdown.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); selectMention(p); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs transition-colors',
                i === selectedIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              @{p.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, editing, children }: { label: string; editing: boolean; children: ReactNode }) {
  return (
    <div>
      <Label className="text-[9.5px] uppercase tracking-wide text-muted-foreground/50 font-semibold">{label}</Label>
      <div className={cn(editing ? 'text-xs text-foreground' : 'text-[13px] font-medium text-foreground mt-0.5')}>{children}</div>
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
  /* `useFases` guarda a lista em cache de modulo, entao chamar aqui nao custa
     consulta — e o historico passa a mostrar o rotulo que esta no banco, e nao
     uma copia dele escrita no codigo. */
  const { fases } = useFases();

  if (entry.tipo_alteracao === 'criacao') {
    return <span>criou <span className="text-foreground">"{entry.valor_novo}"</span></span>;
  }
  if (entry.tipo_alteracao === 'fase') {
    return (
      <span>
        moveu de <span className="text-foreground">{rotuloDaFase(fases, entry.valor_anterior ?? '')}</span>
        {' → '}
        <span className="text-foreground">{rotuloDaFase(fases, entry.valor_novo ?? '')}</span>
        {/* O motivo fica GRUDADO no movimento. Numa linha separada viraria
            um comentario solto, e ninguem saberia a qual arquivamento ele se
            refere quando o card for arquivado duas vezes. */}
        {entry.motivo && <span className="text-muted-foreground"> — {entry.motivo}</span>}
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
