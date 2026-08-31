import { useEffect, useRef, useState, useMemo } from 'react';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { supabase } from '@/lib/supabase';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Plus, Search, Pencil, Trash2, Calendar, User, Tag, FolderOpen,
  FlaskConical, CheckCircle2, XCircle, MinusCircle, Clock, PauseCircle,
  Sheet, Loader2, BookMarked, Settings2, Layers, Lock,
} from 'lucide-react';
import { AreasSection } from '../components/RadarConfigTab';
import { CATEGORIA_LABEL } from '../categorias';
import { TesteModal } from '@/features/funis/components/TesteModal';
import type { TesteFunil, Funil, Projeto as ProjetoDoFunis } from '@/features/funis/types';

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
  projeto_ids: string[];
  projetos_nomes?: string[];
  responsavel_id: string | null;
  responsavel_nome?: string;
  criado_por: string | null;
  criado_por_nome?: string;
  criado_em: string;
  fonte: string | null;
  fonte_id: string | null;
};

type Projeto = { id: string; nome: string; ativo: boolean };
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
  projeto_ids: [] as string[],
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

/** O que dá para mostrar de um erro que pode ser qualquer coisa. */
function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Componente principal ────────────────────────────────────────────────────

export function RadarContent() {
  const { perfil: authPerfil, user } = useAuth();
  const isAdmin = authPerfil?.is_admin ?? false;
  const podeCriar = authPerfil?.radar_pode_criar !== false;
  const confirm = useConfirm();

  const [areas, setAreas]       = useState<Area[]>([]);
  const [testes, setTestes]     = useState<Teste[]>([]);
  const [perfis, setPerfis]     = useState<PerfilSimples[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading]   = useState(true);

  // filtros
  const [search, setSearch]               = useState('');
  const [filtroArea, setFiltroArea]             = useState('');
  /*
    A tela abre no que está rodando AGORA.

    Abria em tudo, e "tudo" é uma pilha onde os 24 concluídos empurram para
    baixo os 28 em andamento — que são os únicos sobre os quais dá para fazer
    alguma coisa hoje.
  */
  const [filtroStatus, setFiltroStatus]         = useState('em_andamento');
  const [filtroResultado, setFiltroResultado]   = useState('');
  const [filtroProjeto, setFiltroProjeto]       = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');
  const [filtroDataDe, setFiltroDataDe]         = useState('');
  const [filtroDataAte, setFiltroDataAte]       = useState('');

  // modal criar/editar
  const [openForm, setOpenForm]     = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState(blankForm());
  const [saving, setSaving]         = useState(false);

  // detalhe dialog
  const [detalhe, setDetalhe]       = useState<Teste | null>(null);

  /*
    O teste do Funis abre AQUI, sem sair do Radar.

    A primeira versão era um link para `/funis-gestao?aba=testes&teste=…`.
    Funcionava, mas mandava embora: quem só queria marcar o vencedor perdia a
    lista, o filtro e o lugar na rolagem, e voltava por conta própria. É o
    mesmo motivo pelo qual a Produção e a Esteira do Copy montam o card na
    própria tela em vez de navegar.

    O modal é o DO FUNIS, não uma cópia dele — copiar um formulário de 600
    linhas seria a primeira armadilha do CLAUDE.md em escala grande, com as
    duas versões divergindo na primeira regra nova.

    As listas de funis e projetos carregam na primeira vez que alguém abre, e
    não junto com a página: quem entra no Radar para ler não deveria pagar duas
    consultas por um formulário que talvez não abra.
  */
  const [testeFunil, setTesteFunil]   = useState<TesteFunil | null>(null);
  const [ctxFunis, setCtxFunis]       = useState<{ funis: Funil[]; projetos: ProjetoDoFunis[] } | null>(null);
  const [abrindoFunil, setAbrindoFunil] = useState(false);
  const [gerenciarAreas, setGerenciarAreas] = useState(false);

  // sync sheets
  const [syncing, setSyncing] = useState(false);

  // Dispara sync em background sem bloquear a UI (fire & forget)
  const silentSyncSheets = () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/radar-sheets-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      }).catch(() => {}); // falha silenciosa — não interrompe o fluxo do usuário
    });
  };

  // Sync manual com feedback (botão Sheets no header)
  const syncSheets = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/radar-sheets-sync`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast({ title: `Planilha atualizada — ${json.synced} testes exportados` });
    } catch (e: unknown) {
      toast({ title: 'Erro ao sincronizar', description: mensagemDe(e), variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  // ── Load ──────────────────────────────────────────────────────────────────
  /*
    `loading` só na PRIMEIRA carga.

    Toda recarga ligava o "Carregando...": salvar um teste apagava a grade
    inteira e jogava a rolagem para o topo, e quem estava no fim da lista
    perdia o lugar.
  */
  const primeiraCarga = useRef(true);

  const projetosDaEmpresa = useProjetosDaEmpresa();
  const { empresaId } = useFilters();

  const load = async (afterLoad?: (loaded: Teste[]) => void) => {
    if (primeiraCarga.current) setLoading(true);
    /*
      `radar_testes.projeto_ids` é ARRAY: um teste pode tocar mais de um
      projeto. Por isso `overlaps` e não `in` — o teste entra se QUALQUER um
      dos projetos dele for da empresa.

      Teste sem projeto nenhum continua aparecendo: ele não é de ninguém, e
      esconder pesquisa transversal dentro de uma empresa faria perder
      justamente a que vale para as duas.
    */
    let qTestes = supabase.from('radar_testes').select('*').is('deletado_em', null).order('criado_em', { ascending: false });
    if (projetosDaEmpresa) {
      qTestes = qTestes.or(`projeto_ids.ov.{${projetosDaEmpresa.join(',')}},projeto_ids.is.null`);
    }
    let qProjetos = supabase.from('ofertas_editores').select('id, nome, ativo').eq('ativo', true).order('nome');
    if (empresaId) qProjetos = qProjetos.eq('empresa_id', empresaId);
    const [{ data: areasData }, { data: testesData }, { data: perfisData }, { data: projetosData }] = await Promise.all([
      supabase.from('radar_areas').select('*').eq('ativo', true).order('ordem'),
      qTestes,
      supabase.from('perfis').select('id, nome').eq('ativo', true).order('nome'),
      qProjetos,
    ]);
    setAreas(areasData || []);
    setPerfis(perfisData || []);
    setProjetos(projetosData || []);

    const areaMap    = Object.fromEntries((areasData    || []).map((a: Area)          => [a.id, a]));
    const perfilMap  = Object.fromEntries((perfisData   || []).map((p: PerfilSimples) => [p.id, p.nome]));
    const projetoMap = Object.fromEntries((projetosData || []).map((p: Projeto)       => [p.id, p.nome]));

    const loaded = (testesData ?? []).map((t): Teste => ({
      ...t,
      area:             areaMap[t.area_id] ?? null,
      responsavel_nome: perfilMap[t.responsavel_id] ?? null,
      criado_por_nome:  perfilMap[t.criado_por] ?? null,
      projetos_nomes:   (t.projeto_ids || []).map((id: string) => projetoMap[id]).filter(Boolean),
    }));
    setTestes(loaded);
    setLoading(false);
    primeiraCarga.current = false;
    afterLoad?.(loaded);
  };

  useEffect(() => { load(); }, [projetosDaEmpresa, empresaId]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    ── Filtros, em dois andares ─────────────────────────────────────────────

    Os cards viraram o filtro de status, e isso obriga a separar as coisas: se
    eles contassem a lista JÁ filtrada por status, clicar em "Concluídos"
    zeraria "Em andamento" e não haveria mais como voltar — o filtro comeria o
    próprio botão de desfazer.

    Então o primeiro andar é tudo MENOS status e resultado. É ele que os cards
    contam: os números obedecem busca, área, projeto, responsável e período, e
    ficam estáveis enquanto se alterna entre os cards.
  */
  const baseDosCards = useMemo(() => {
    return testes.filter(t => {
      if (search && !t.titulo.toLowerCase().includes(search.toLowerCase())) return false;
      if (filtroArea && t.area_id !== filtroArea) return false;
      if (filtroProjeto && !(t.projeto_ids || []).includes(filtroProjeto)) return false;
      if (filtroResponsavel && t.responsavel_id !== filtroResponsavel) return false;
      /*
        O período compara com o teste INTEIRO, e não só com o começo dele.

        Comparava os dois lados contra `data_inicio`: um teste que começou em
        julho e terminou em agosto sumia de um filtro de agosto, que é
        justamente quando alguém procura o que estava rodando no mês.

        Um teste sem data nenhuma nunca casa com um período — não há como saber.
      */
      if (filtroDataDe || filtroDataAte) {
        const comecou  = t.data_inicio;
        const terminou = t.data_fim ?? t.data_inicio;
        if (!comecou) return false;
        if (filtroDataAte && comecou > filtroDataAte) return false;
        if (filtroDataDe && terminou && terminou < filtroDataDe) return false;
      }
      return true;
    });
  }, [testes, search, filtroArea, filtroProjeto, filtroResponsavel, filtroDataDe, filtroDataAte]);

  /* O segundo andar: o que o card escolheu. */
  const testesFiltrados = useMemo(() => baseDosCards.filter(t => {
    if (filtroStatus && t.status !== filtroStatus) return false;
    if (filtroResultado && t.resultado !== filtroResultado) return false;
    return true;
  }), [baseDosCards, filtroStatus, filtroResultado]);

  /*
    Os cards.

    "Cancelados" só aparece quando existe algum — não há por que oferecer um
    botão que leva a lugar nenhum. Os outros três ficam sempre, inclusive em
    zero: "0 pausados" é informação, e some da tela seria a mesma informação
    dita pior. A regra vem da contagem, não de uma lista escrita aqui, então um
    status novo no enum não precisa que alguém lembre deste arquivo.
  */
  const cards = useMemo(() => {
    const contarStatus = (s: string) => baseDosCards.filter(t => t.status === s).length;

    const doStatus = (chave: string, label: string, color: string, anel: string) => ({
      label, value: contarStatus(chave), color, anel,
      ativo: filtroStatus === chave,
      onClick: () => { setFiltroResultado(''); setFiltroStatus(a => (a === chave ? '' : chave)); },
      nota: null as string | null,
    });

    const concluidos = contarStatus('concluido');
    const lista = [
      doStatus('em_andamento', 'Em andamento', 'text-blue-400',    'border-blue-400/60 ring-1 ring-blue-400/40'),
      doStatus('concluido',    'Concluídos',   'text-emerald-400', 'border-emerald-400/60 ring-1 ring-emerald-400/40'),
      doStatus('pausado',      'Pausados',     'text-yellow-400',  'border-yellow-400/60 ring-1 ring-yellow-400/40'),
    ];
    if (contarStatus('cancelado') > 0) {
      lista.push(doStatus('cancelado', 'Cancelados', 'text-red-400', 'border-red-400/60 ring-1 ring-red-400/40'));
    }

    lista.push({
      label: 'Positivos',
      value: baseDosCards.filter(t => t.resultado === 'positivo').length,
      color: 'text-emerald-400',
      anel:  'border-emerald-400/60 ring-1 ring-emerald-400/40',
      ativo: filtroResultado === 'positivo',
      /* Positivo só existe entre concluídos: manter o status ligado junto daria
         tela vazia toda vez que alguém clicasse vindo de "Em andamento". */
      onClick: () => { setFiltroStatus(''); setFiltroResultado(a => (a === 'positivo' ? '' : 'positivo')); },
      nota: concluidos > 0 ? `de ${concluidos} concluídos` : null,
    });
    return lista;
  }, [baseDosCards, filtroStatus, filtroResultado]);

  /* Os cards já se mostram escolhidos sozinhos; a linha é para o resto. */
  const temOutroFiltro = Boolean(
    search || filtroArea || filtroProjeto || filtroResponsavel || filtroDataDe || filtroDataAte,
  );

  /*
    As áreas agrupadas por categoria, com a contagem de testes de cada uma.

    Das 18 áreas cadastradas, 11 não têm um único teste — e apareciam no filtro
    do mesmo jeito que as usadas. O "· vazia" não as esconde (esconder faria a
    lista mudar de tamanho sozinha), mas avisa antes do clique que não vem nada.
  */
  const areasPorCategoria = useMemo(() => {
    const porArea = new Map<string, number>();
    for (const t of testes) if (t.area_id) porArea.set(t.area_id, (porArea.get(t.area_id) ?? 0) + 1);
    return areas.reduce((acc, a) => {
      (acc[a.categoria] ??= []).push({ ...a, testes: porArea.get(a.id) ?? 0 });
      return acc;
    }, {} as Record<string, (Area & { testes: number })[]>);
  }, [areas, testes]);

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
      projeto_ids: t.projeto_ids || [],
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
      projeto_ids: form.projeto_ids,
      atualizado_em: new Date().toISOString(),
      atualizado_por: user?.id ?? null,
    };

    const { error } = editingId
      ? await supabase.from('radar_testes').update(payload).eq('id', editingId)
      : await supabase.from('radar_testes').insert({ ...payload, criado_por: user?.id });

    setSaving(false);
    if (error) return toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Teste atualizado' : 'Teste criado' });
    setOpenForm(false);
    load((loaded) => { if (isAdmin) silentSyncObsidian(loaded); });
    silentSyncSheets();
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Excluir teste?', description: 'O teste ficará salvo no histórico e na aba "Excluídos" do Google Sheets.' }))) return;
    const { error } = await supabase.from('radar_testes')
      .update({ deletado_em: new Date().toISOString(), deletado_por: user?.id })
      .eq('id', id);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: 'Teste excluído', description: 'Salvo no histórico — não se preocupe.' });
    setDetalhe(null);
    load((loaded) => { if (isAdmin) silentSyncObsidian(loaded); });
    silentSyncSheets();
  };

  // ── Obsidian sync ─────────────────────────────────────────────────────────
  const [syncingObsidian, setSyncingObsidian] = useState(false);

  // Dispara sync Obsidian em background com lista fresquinha (fire & forget)
  const silentSyncObsidian = (list: Teste[]) => {
    // `await` dentro de um try, e não `.then().catch()`: o builder do Supabase
    // é `PromiseLike`, que não tem `.catch`. Funcionava por acaso — `.then()`
    // devolve uma Promise de verdade em tempo de execução — mas o encadeamento
    // não descrevia o que acontece, e um erro na PRIMEIRA consulta caía num
    // `.catch` que o tipo dizia não existir.
    //
    // Continua sendo "dispara e esquece": o Obsidian roda na máquina de quem
    // está usando, pode simplesmente não estar aberto, e falhar aqui não pode
    // atrapalhar o resto da tela. Por isso o catch segue silencioso — de
    // propósito, e agora dito.
    void (async () => {
      try {
        const { data: cfg } = await supabase
          .from('configuracoes_texto')
          .select('valor')
          .eq('chave', 'obsidian_api_key')
          .single();
        if (!cfg?.valor) return;
        await runObsidianSync(cfg.valor, list);
      } catch {
        /* Obsidian fora do ar ou sem chave: acessório, segue o jogo. */
      }
    })();
  };

  const runObsidianSync = async (apiKey: string, list: Teste[]): Promise<{ ok: number; fail: number }> => {
    const OBSIDIAN = 'http://127.0.0.1:27123';
    const headers  = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'text/markdown' };
    const toSlug   = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const fmt = (v: string | null | undefined) => v ? `"${v.replace(/"/g, "'")}"` : '""';

    let ok = 0; let fail = 0;
    for (const t of list) {
      const areaNome = t.area?.nome ?? 'Geral';
      const path = `Radar Alaskan/${areaNome}/${toSlug(t.titulo) || t.id.slice(0, 8)}.md`;
      const fm = ['---', `titulo: ${fmt(t.titulo)}`, `area: ${fmt(areaNome)}`, `status: ${t.status}`,
        `resultado: ${t.resultado ?? ''}`, `projetos: [${(t.projetos_nomes ?? []).map(p => `"${p}"`).join(', ')}]`,
        `tags: [${(t.tags ?? []).join(', ')}]`, `data_inicio: ${t.data_inicio ?? ''}`,
        `data_fim: ${t.data_fim ?? ''}`,
        `criado_em: ${t.criado_em ? new Date(t.criado_em).toLocaleDateString('pt-BR') : ''}`, '---'].join('\n');
      const body = [`# ${t.titulo}\n`,
        ...(t.hipotese    ? [`## Hipótese\n${t.hipotese}\n`]        : []),
        ...(t.metodologia ? [`## Metodologia\n${t.metodologia}\n`]  : []),
        ...(t.conclusao   ? [`## Conclusão\n${t.conclusao}\n`]      : []),
        ...(t.aprendizado ? [`## 💡 Aprendizado\n${t.aprendizado}\n`] : []),
      ].join('\n');
      try {
        const res = await fetch(`${OBSIDIAN}/vault/${encodeURIComponent(path)}`,
          { method: 'PUT', headers, body: `${fm}\n\n${body}` }
        );
        if (res.ok || res.status === 204) ok++; else fail++;
      } catch { fail++; }
    }
    return { ok, fail };
  };

  const syncObsidian = async () => {
    setSyncingObsidian(true);
    try {
      const { data: cfg } = await supabase
        .from('configuracoes_texto')
        .select('valor')
        .eq('chave', 'obsidian_api_key')
        .single();
      if (!cfg?.valor) throw new Error('Chave do Obsidian não configurada.');

      const { ok, fail } = await runObsidianSync(cfg.valor, testes);

      if (fail === 0) {
        toast({ title: `Obsidian atualizado — ${ok} notas sincronizadas` });
      } else {
        toast({
          title: `Sync parcial: ${ok} ok, ${fail} falhas`,
          description: fail === testes.length
            ? 'Verifique se o Obsidian está aberto e o plugin Local REST API está ativo.'
            : 'Algumas notas não foram atualizadas.',
          variant: 'destructive',
        });
      }
    } catch (e: unknown) {
      toast({ title: 'Erro no sync Obsidian', description: mensagemDe(e), variant: 'destructive' });
    } finally {
      setSyncingObsidian(false);
    }
  };

  /*
    A MESMA regra que a RLS aplica no banco.

    Era so `isAdmin || criado_por === user.id`, e 33 dos 44 testes de funil
    tem `criado_por` nulo porque a origem tambem tem. "Sem dono" virava "so
    admin" por acidente de `null === undefined` ser falso -- e o botao Editar
    sumia justamente nos testes onde falta preencher area, projeto e
    aprendizado, que sao os campos que so existem aqui.

    O espelho do Funis segue a origem: quem enxerga o teste la pode anota-lo
    aqui. Os campos que pertencem ao Funis continuam travados no formulario,
    com o cadeado.
  */
  /*
    Quem aparece no rodapé do card.

    Mostrava só o responsável — um campo que se preenche à mão e que 38 dos 44
    espelhos do Funis não têm. O card ficava sem autor nenhum, mesmo quando o
    banco sabia quem criou o teste.

    Responsável primeiro, porque é quem toca; quem criou entra como segunda
    linha de defesa, e diz "criado por" para não se passar por responsável.
    Onde nem um nem outro existem — 11 dos 52 testes, porque a origem no Funis
    também não tem criador — continua vazio, que é a verdade.
  */
  const autorDe = (t: Teste): { nome: string; rotulo: string } | null =>
    t.responsavel_nome ? { nome: t.responsavel_nome, rotulo: '' }
    : t.criado_por_nome ? { nome: t.criado_por_nome, rotulo: 'criado por ' }
    : null;

  async function abrirNoFunis(fonteId: string) {
    setAbrindoFunil(true);
    try {
      const [{ data: teste }, contexto] = await Promise.all([
        supabase.from('testes_funis').select('*').eq('id', fonteId).maybeSingle(),
        ctxFunis ? Promise.resolve(ctxFunis) : (async () => {
          const [f, pr] = await Promise.all([
            supabase.from('funis').select('*').order('nome'),
            supabase.from('ofertas_editores').select('id,nome,empresa_id,ativo').eq('ativo', true).order('nome'),
          ]);
          const c = {
            funis:    (f.data  ?? []) as unknown as Funil[],
            projetos: (pr.data ?? []) as unknown as ProjetoDoFunis[],
          };
          setCtxFunis(c);
          return c;
        })(),
      ]);
      void contexto;
      if (!teste) {
        /* Aqui o toast funciona: sai de um clique, não do primeiro efeito. */
        return toast({
          title: 'Teste não encontrado no Funis',
          description: 'Ele pode ter sido excluído lá.',
          variant: 'destructive',
        });
      }
      /* Fecha o detalhe antes: dois diálogos empilhados é pior que a troca. */
      setDetalhe(null);
      setTesteFunil(teste as unknown as TesteFunil);
    } finally {
      setAbrindoFunil(false);
    }
  }

  const podeEditar = (t: Teste) =>
    isAdmin
    || t.criado_por === user?.id
    || t.criado_por === null
    || t.fonte === 'funis';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Central de testes e aprendizados da empresa
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={syncSheets} disabled={syncing} title="Exportar para Google Sheets">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />}
              <span className="hidden sm:inline ml-1">{syncing ? 'Sincronizando...' : 'Sheets'}</span>
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={syncObsidian} disabled={syncingObsidian} title="Sincronizar com Obsidian">
              {syncingObsidian ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookMarked className="h-4 w-4" />}
              <span className="hidden sm:inline ml-1">{syncingObsidian ? 'Sincronizando...' : 'Obsidian'}</span>
            </Button>
          )}
          {podeCriar && (
            <Button onClick={openNew} className="shrink-0">
              <Plus className="h-4 w-4 mr-1" /> Novo teste
            </Button>
          )}
        </div>
      </div>

      {/* ── Os números, que também são o filtro de status ── */}
      {temOutroFiltro && (
        <p className="text-[11px] text-muted-foreground mb-2">
          Os números abaixo contam os {baseDosCards.length} testes do filtro, de {testes.length} no total.
        </p>
      )}
      {/* `flex-wrap` e não grade fixa: o número de cards varia com os dados. */}
      <div className="flex flex-wrap gap-3 mb-6">
        {cards.map(s => (
          <button
            key={s.label}
            onClick={s.onClick}
            aria-pressed={s.ativo}
            title={s.ativo
              ? `Mostrando só ${s.label.toLowerCase()} — clique para ver tudo`
              : `Ver só ${s.label.toLowerCase()}`}
            className={cn(
              'min-w-[140px] flex-1 rounded-lg border bg-card px-4 py-3 text-left transition-colors',
              s.ativo ? s.anel : 'border-border hover:border-border/80 hover:bg-card/70',
            )}
          >
            <div className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</div>
            <div className={cn('text-xs mt-0.5', s.ativo ? 'text-foreground' : 'text-muted-foreground')}>
              {s.label}
            </div>
            {s.nota && <div className="text-[10px] text-muted-foreground/60">{s.nota}</div>}
          </button>
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
            {Object.entries(areasPorCategoria).map(([cat, lista]) => (
              <div key={cat}>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {CATEGORIA_LABEL[cat] || cat}
                </div>
                {lista.map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.icone} {a.nome}
                    {a.testes === 0 && <span className="text-muted-foreground/50"> · vazia</span>}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
        {/*
          Os selects de Status e Resultado sairam daqui: os cards acima fazem as
          duas coisas, com o número do lado. Mantê-los seria dois controles para
          o mesmo estado na mesma tela — e, pior, os cards contam a lista SEM
          status, então mexer no select não mexeria nos números logo acima dele.
          Um filtro que não move o resumo que está colado nele é um filtro que
          ensina a desconfiar do resumo.
        */}
        <Select value={filtroProjeto || 'all'} onValueChange={v => setFiltroProjeto(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="Projeto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            {projetos.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroResponsavel || 'all'} onValueChange={v => setFiltroResponsavel(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="Responsável" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo mundo</SelectItem>
            {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <DateRangeFilter
          de={filtroDataDe} ate={filtroDataAte}
          onChangeDe={setFiltroDataDe} onChangeAte={setFiltroDataAte}
        />
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
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {t.area ? `${t.area.icone} ${t.area.nome}` : '—'}
                  </span>
                  {t.fonte === 'funis' && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                      <Layers className="h-2.5 w-2.5" />
                      Funis
                    </span>
                  )}
                </div>
                <StatusBadge status={t.status} />
              </div>

              {/* título */}
              <p className="text-sm font-medium leading-snug mb-2 line-clamp-2">{t.titulo}</p>

              {/* resultado */}
              {t.resultado && <div className="mb-2"><ResultadoBadge resultado={t.resultado} /></div>}

              {/* projetos */}
              {t.projetos_nomes && t.projetos_nomes.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {t.projetos_nomes.map(nome => (
                    <span key={nome} className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                      <FolderOpen className="h-2.5 w-2.5" />{nome}
                    </span>
                  ))}
                </div>
              )}

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
                {(() => {
                  const autor = autorDe(t);
                  return autor && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <User className="h-3 w-3" />{autor.rotulo}{autor.nome}
                    </span>
                  );
                })()}
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
                  {detalhe.fonte === 'funis' && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                      <Layers className="h-2.5 w-2.5" />
                      Funis
                    </span>
                  )}
                  <StatusBadge status={detalhe.status} />
                  {detalhe.resultado && <ResultadoBadge resultado={detalhe.resultado} />}
                </div>
                <DialogTitle className="text-base leading-snug text-left">{detalhe.titulo}</DialogTitle>
              </DialogHeader>

              {/*
                O aviso mandava editar "lá" e não dizia onde.

                Achar o card num quadro de 44 é trabalho suficiente para a
                pessoa desistir e deixar o teste como está — que é exatamente
                como 4 deles ficaram meses parados em "rodando". O link leva
                direto ao card, com o modal já aberto.
              */}
              {detalhe.fonte === 'funis' && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
                  <Lock className="h-3 w-3 shrink-0" />
                  <span className="min-w-0">
                    Sincronizado via módulo Funis — título, hipótese, datas e resultado se alteram lá.
                  </span>
                  {detalhe.fonte_id && (
                    <button
                      onClick={() => void abrirNoFunis(detalhe.fonte_id!)}
                      disabled={abrindoFunil}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-1 font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-60"
                    >
                      {abrindoFunil
                        ? <><Loader2 className="h-3 w-3 animate-spin" /> Abrindo…</>
                        : <><Pencil className="h-3 w-3" /> Editar no Funis</>}
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-4 text-sm mt-2">

                {/* Datas + responsável */}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
                  {detalhe.data_inicio && (
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Início: {fmtDate(detalhe.data_inicio)}</span>
                  )}
                  {detalhe.data_fim && (
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Fim: {fmtDate(detalhe.data_fim)}</span>
                  )}
                  {(() => {
                    const autor = autorDe(detalhe);
                    return autor && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" /> {autor.rotulo}{autor.nome}
                      </span>
                    );
                  })()}
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

                {detalhe.projetos_nomes && detalhe.projetos_nomes.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Projetos</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detalhe.projetos_nomes.map(nome => (
                        <span key={nome} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">
                          <FolderOpen className="h-3 w-3" />{nome}
                        </span>
                      ))}
                    </div>
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

          {/* Lock notice for Funis-synced tests */}
          {editingId && testes.find(t => t.id === editingId)?.fonte === 'funis' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2 mb-2">
              <Lock className="h-3 w-3 shrink-0" />
              Campos marcados com 🔒 são gerenciados pelo módulo Funis. Edite o teste lá para atualizá-los.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Título */}
            <div className="col-span-2">
              <Label>
                {editingId && testes.find(t => t.id === editingId)?.fonte === 'funis' ? '🔒 ' : ''}
                Título <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.titulo}
                onChange={e => setForm({ ...form, titulo: e.target.value })}
                placeholder="Ex: Teste de hook com pergunta direta nos 3s"
                className="mt-1"
                disabled={!!(editingId && testes.find(t => t.id === editingId)?.fonte === 'funis')}
              />
            </div>

            {/* Área */}
            <div>
              <div className="flex items-center justify-between">
                <Label>Área</Label>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setGerenciarAreas(true)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Settings2 className="h-3 w-3" />Gerenciar
                  </button>
                )}
              </div>
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
            {(() => {
              const isFunis = !!(editingId && testes.find(t => t.id === editingId)?.fonte === 'funis');
              return (<>
                <div>
                  <Label>{isFunis ? '🔒 ' : ''}Data de início</Label>
                  <Input type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} className="mt-1" disabled={isFunis} />
                </div>
                <div>
                  <Label>{isFunis ? '🔒 ' : ''}Data de fim</Label>
                  <Input type="date" value={form.data_fim} onChange={e => setForm({ ...form, data_fim: e.target.value })} className="mt-1" disabled={isFunis} />
                </div>
                <div>
                  <Label>{isFunis ? '🔒 ' : ''}Status</Label>
                  <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as Teste['status'] })} disabled={isFunis}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{isFunis ? '🔒 ' : ''}Resultado</Label>
                  <Select
                    value={form.resultado || ''}
                    onValueChange={v => setForm({ ...form, resultado: v as Teste['resultado'] })}
                    disabled={isFunis || form.status !== 'concluido'}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={form.status !== 'concluido' ? 'Apenas para concluídos' : 'Selecione...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RESULTADO_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>{isFunis ? '🔒 ' : ''}Hipótese</Label>
                  <Textarea value={form.hipotese} onChange={e => setForm({ ...form, hipotese: e.target.value })}
                    placeholder="O que você acredita que vai acontecer e por quê?" className="mt-1 min-h-[80px]" disabled={isFunis} />
                </div>
              </>);
            })()}

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

            {/* Projetos */}
            <div className="col-span-2">
              <Label>Projetos <span className="text-xs text-muted-foreground">(pode selecionar mais de um)</span></Label>
              {projetos.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-2 italic">Nenhuma oferta cadastrada. Adicione em Configurações → Empresas e Ofertas.</p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {projetos.map(p => (
                    <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={form.projeto_ids.includes(p.id)}
                        onCheckedChange={checked => {
                          setForm({
                            ...form,
                            projeto_ids: checked
                              ? [...form.projeto_ids, p.id]
                              : form.projeto_ids.filter(id => id !== p.id),
                          });
                        }}
                      />
                      <span className="text-sm">{p.nome}</span>
                    </label>
                  ))}
                </div>
              )}
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

      {/*
        O formulário do Funis, montado aqui.

        `key` no id força o modal a renascer a cada teste: ele carrega os
        campos num efeito de montagem, e reaproveitar a instância mostraria o
        teste anterior por um quadro.

        Ao salvar, o gatilho no banco já atualizou o espelho — o `load()` é só
        para a tela ver o que o banco já sabe.
      */}
      {ctxFunis && (
        <TesteModal
          key={testeFunil?.id ?? 'nenhum'}
          open={!!testeFunil}
          onClose={() => setTesteFunil(null)}
          onSaved={() => { setTesteFunil(null); load(); }}
          teste={testeFunil}
          funis={ctxFunis.funis}
          projetos={ctxFunis.projetos}
        />
      )}

      {/* ── Gerenciar Áreas ── */}
      <Dialog open={gerenciarAreas} onOpenChange={v => { if (!v) { setGerenciarAreas(false); load(); } }}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Gerenciar Áreas</DialogTitle></DialogHeader>
          <AreasSection />
        </DialogContent>
      </Dialog>
    </>
  );
}

