import { paraYmd } from '@/lib/datas';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Plus, Copy, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiFilter } from './MultiFilter';
import { supabase, linhas, linha } from '@/lib/supabase';
import { fetchFunis, fetchPerfis, fetchProjetos } from '@/lib/dataCache';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import type { Criativo, ProducaoNivel, Funil, Perfil } from './types';
import { FASES_MAP, TIPO_COR, FASES, FASES_CONCLUIDAS, prazoEfetivo } from './constants';
import { CriativoDrawer } from './CriativoDrawer';
import { useAusencias, pontoDoTipo, rotuloDoTipo, type Ausencia } from '@/features/producao/ausencias';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { CriativoFormModal } from './CriativoFormModal';
import { SeletorDePrazo } from './SeletorDePrazo';
import { registrarMudancas } from '../registrarHistorico';

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  somenteSetor?: boolean;
  fixedField?: 'responsavel_id' | 'copy_id' | 'gestor_id' | 'especialista_id';
  fixedValue?: string;
  fasesVisiveis?: string[];
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Teto para a tela não travar. Se bater nele, a tela avisa em vez de cortar
 *  calado — ver o estado `truncado`. */
const LIMITE_DE_CARDS = 2000;

/** Onde termina o cabeçalho de um dia: `p-1.5` (6) + o número `h-5` (20) +
 *  `mb-1` (4). É por aqui que as barras de período começam, para nunca mais
 *  passarem por cima da data. */
const ALTURA_DO_CABECALHO = 30;

/** As fases que não atrasam, no formato que o PostgREST espera.
 *  Derivado de `FASES_CONCLUIDAS` e não escrito à mão: uma fase nova entra
 *  aqui sozinha, em vez de ficar de fora em silêncio. */
const FASES_ENCERRADAS_SQL = `(${[...FASES_CONCLUIDAS, 'bloqueado'].join(',')})`;
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function buildCalendarGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let i = 0; i < first.getDay(); i++) days.push(new Date(year, month, -first.getDay() + 1 + i));
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) days.push(new Date(year, month + 1, i));
  return days;
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(ymd: string, delta: number): string {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return toYMD(d);
}

function daysDiff(from: string, to: string): number {
  return Math.round(
    (new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000,
  );
}


type SpanEntry = {
  criativo: Criativo;
  startCol: number;
  endCol: number;
  isFirst: boolean;
  isLast: boolean;
  lane: number;
};

type PreviewMap = Record<string, { data_inicio?: string; data_prazo?: string }>;

function getSpanningForWeek(weekDays: Date[], spanning: Criativo[], previewMap: PreviewMap): SpanEntry[] {
  const weekStart = toYMD(weekDays[0]);
  const weekEnd   = toYMD(weekDays[6]);
  const raw: Omit<SpanEntry, 'lane'>[] = [];

  for (const c of spanning) {
    const pm     = previewMap[c.id] ?? {};
    const cStart = pm.data_inicio ?? c.data_inicio!;
    const cEnd   = pm.data_prazo  ?? c.data_prazo!;
    if (cEnd < weekStart || cStart > weekEnd) continue;

    const effStart = cStart >= weekStart ? cStart : weekStart;
    const effEnd   = cEnd   <= weekEnd   ? cEnd   : weekEnd;
    const sIdx = weekDays.findIndex(d => toYMD(d) === effStart);
    const eIdx = weekDays.findIndex(d => toYMD(d) === effEnd);

    raw.push({
      criativo: c,
      startCol: (sIdx >= 0 ? sIdx : 0) + 1,
      endCol:   (eIdx >= 0 ? eIdx : 6) + 2,
      isFirst:  cStart >= weekStart,
      isLast:   cEnd   <= weekEnd,
    });
  }

  raw.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

  const laneEnds: number[] = [];
  return raw.map(e => {
    let lane = laneEnds.findIndex(end => end <= e.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e.endCol;
    return { ...e, lane };
  });
}

// ── DraggableCalCard ──────────────────────────────────────────────────────────

function DraggableCalCard({
  criativo, todayYMD, selecionando, isSelected, onOpen, onToggle, onResizeRight,
}: {
  criativo: Criativo;
  todayYMD: string;
  selecionando: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onResizeRight: (targetYmd: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `cal-${criativo.id}`,
    data: { criativo },
  });

  // `(data_prazo ?? '') < todayYMD` dizia que TODO card sem prazo estava
  // atrasado: string vazia é menor que qualquer data. Como só 4,9% dos cards
  // têm prazo, o vermelho de atraso cobria quase o calendário inteiro — e um
  // aviso que aparece sempre é um aviso que ninguém lê.
  const prazo   = prazoEfetivo(criativo.data_prazo, criativo.data_inicio);
  const isLate  = !!prazo && prazo < todayYMD && !FASES_CONCLUIDAS.has(criativo.fase);
  const tipoCor = isLate
    ? 'bg-red-500/20 text-red-300 border-red-500/30'
    : (TIPO_COR[criativo.tipo] ?? 'bg-primary/10 text-primary border-primary/20');

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Find which day cell is under the pointer
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dayEl = el?.closest('[data-date]') as HTMLElement | null;
    if (!dayEl?.dataset.date) return;
    const targetYmd = dayEl.dataset.date;
    const originalYmd = criativo.data_prazo ?? criativo.data_inicio;
    if (targetYmd && originalYmd && targetYmd > originalYmd) {
      await onResizeRight(targetYmd);
    }
  };

  const editor  = criativo.responsavel?.nome ?? criativo.editor_nome_historico;
  const fase    = FASES_MAP[criativo.fase] ?? criativo.fase;
  const funil   = criativo.funil?.nome ?? criativo.funil_video ?? null;
  const projeto = criativo.projeto?.nome ?? null;

  return (
    <div
      ref={setNodeRef}
      data-criativo-id={criativo.id}
      style={transform ? { transform: CSS.Transform.toString(transform) } : undefined}
      {...attributes}
      {...listeners}
      className={cn(
        'relative group/card touch-none select-none',
        isDragging && 'opacity-40',
        isSelected && 'ring-1 ring-primary rounded',
      )}
    >
      <button
        onClick={(e) => {
          if (selecionando || e.shiftKey) onToggle();
          else onOpen();
        }}
        className={cn(
          'w-full text-left rounded px-1 pt-0.5 pb-1 border block transition-opacity hover:opacity-75',
          tipoCor,
        )}
      >
        <span className="font-medium text-[11px] leading-tight truncate block pr-1">{criativo.nome}</span>
        <span className="text-[10px] opacity-70 leading-tight truncate block">{fase}</span>
        {projeto && <span className="text-[10px] opacity-60 leading-tight truncate block">{projeto}</span>}
        {funil   && <span className="text-[10px] opacity-55 leading-tight truncate block">{funil}</span>}
        {criativo.tipo_teste && <span className="text-[10px] opacity-50 leading-tight truncate block">{criativo.tipo_teste}</span>}
        {criativo.especialista?.nome && <span className="text-[10px] opacity-50 leading-tight truncate block">{criativo.especialista.nome}</span>}
        {editor  && <span className="text-[10px] opacity-50 leading-tight truncate block">{editor}</span>}
      </button>
      {/* Right edge resize handle — visible on hover */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/card:opacity-100 hover:bg-white/30 rounded-r touch-none z-10"
        onPointerDown={handleResizePointerDown}
        onPointerUp={handleResizePointerUp}
      />
    </div>
  );
}

/**
 * A tira de ausências de um dia.
 *
 * Compacta de propósito: a célula do dia é pequena e o que manda nela são os
 * cards. Feriado e recesso viram uma faixa com o nome, porque valem para todo
 * mundo; folga vira o primeiro nome da pessoa, que é o que se procura ao
 * escolher em quem encostar trabalho.
 *
 * Passando de três, o resto vira "+N" — com todos os nomes no `title`. Uma
 * célula de calendário com sete nomes empilhados deixa de mostrar o calendário.
 */
function TiraDeAusencias({ ausencias, perfis }: {
  ausencias?: Ausencia[];
  perfis: Perfil[];
}) {
  if (!ausencias?.length) return null;

  const nomeDe = (id: string | null) => {
    if (!id) return null;
    const p = perfis.find(x => x.id === id);
    // Primeiro nome: "Jaqueline Coelho" não cabe numa célula de calendário, e
    // quem lê já sabe de quem se trata pelo primeiro.
    return p?.nome?.split(' ')[0] ?? null;
  };

  /* O que para todo mundo vem primeiro: muda o dia inteiro, não só o de uma
     pessoa. */
  const ordenadas = [...ausencias].sort((a, b) => Number(b.paraTodos) - Number(a.paraTodos));
  const mostrar = ordenadas.slice(0, 3);
  const resto   = ordenadas.length - mostrar.length;

  const descricao = ordenadas
    .map(a => a.paraTodos
      ? `${rotuloDoTipo(a.tipo)}: ${a.titulo}`
      : `${rotuloDoTipo(a.tipo)} — ${nomeDe(a.pessoa_id) ?? a.titulo}`)
    .join(' · ');

  return (
    <div className="mb-1 flex flex-col gap-0.5" title={descricao}>
      {mostrar.map(a => (
        <span
          key={a.id}
          className={cn(
            'flex items-center gap-1 rounded px-1 py-px text-[9px] leading-tight',
            a.paraTodos
              ? 'bg-muted text-muted-foreground'
              : 'bg-teal-500/10 text-teal-300',
          )}
        >
          <span className={cn('h-1 w-1 shrink-0 rounded-full', pontoDoTipo(a.tipo))} />
          <span className="truncate">
            {a.paraTodos ? a.titulo : (nomeDe(a.pessoa_id) ?? a.titulo)}
          </span>
        </span>
      ))}
      {resto > 0 && (
        <span className="px-1 text-[9px] leading-tight text-muted-foreground/60">+{resto}</span>
      )}
    </div>
  );
}

// ── DroppableDay ──────────────────────────────────────────────────────────────

function DroppableDay({ ymd, disabled, children }: { ymd: string; disabled?: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${ymd}`, disabled });
  return (
    <div
      ref={setNodeRef}
      className={cn('flex flex-col gap-1 flex-1 min-w-0', isOver && !disabled && 'bg-primary/5 rounded')}
    >
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CalendarioView({ nivel, setorId, userId, somenteSetor, fixedField, fixedValue, fasesVisiveis }: Props) {
  const { toast } = useToast();
  const confirmar = useConfirm();
  const now = new Date();

  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [criativos, setCriativos]     = useState<Criativo[]>([]);
  const [funis, setFunis]             = useState<Funil[]>([]);
  const [perfis, setPerfis]           = useState<Perfil[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [filtroProjeto, setFiltroProjeto] = useState<string[]>([]);
  const [filtroTipo, setFiltroTipo]       = useState<string[]>([]);
  const [filtroResp, setFiltroResp]       = useState<string[]>([]);
  const [filtroFase, setFiltroFase]       = useState<string[]>([]);
  const [filtroAval, setFiltroAval]       = useState<string[]>([]);
  const [filtroFormato, setFiltroFormato] = useState<string[]>([]);
  const [filtroStatus, setFiltroStatus]   = useState<string[]>([]);
  const [busca, setBusca]                 = useState('');
  const [projetos, setProjetos]           = useState<{ id: string; nome: string }[]>([]);
  const [opAvaliacao, setOpAvaliacao]     = useState<string[]>([]);
  const [opFormato, setOpFormato]         = useState<string[]>([]);
  const [opStatus, setOpStatus]           = useState<string[]>([]);
  const [createDate, setCreateDate]   = useState<string | null>(null);

  // DnD single-day
  const [activeId, setActiveId] = useState<string | null>(null);

  // Resize spanning bars
  const [previewMap, setPreviewMap] = useState<PreviewMap>({});
  const resizeRef      = useRef<{ criativoId: string; edge: 'left' | 'right' } | null>(null);
  const weekOverlayRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Select mode / rubber band
  const [truncado, setTruncado]       = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * "Estou selecionando" é ter alguma coisa selecionada — e não um segundo
   * estado ao lado.
   *
   * Havia um `selectMode` separado, e ele NUNCA era desligado ao desmarcar o
   * último card. A sequência que travava o calendário: shift+clique liga o
   * modo, shift+clique de novo desmarca e deixa `selectedIds` vazio, mas o modo
   * fica ligado — e a barra de seleção some, porque ela exige `size > 0`. A
   * partir daí, clicar num card o SELECIONAVA em vez de abrir, sem nada na tela
   * dizendo por quê. Dois estados para um conceito, que é a armadilha nº 1 do
   * CLAUDE.md em forma de estado de tela.
   */
  const selecionando = selectedIds.size > 0;
  const [bulkFase, setBulkFase]       = useState('');
  const [bulkResp, setBulkResp]       = useState('');
  const [soAtrasados, setSoAtrasados] = useState(false);
  const [atrasados, setAtrasados]     = useState(0);
  const [bulkData, setBulkData]       = useState<{ inicio: string | null; prazo: string | null } | null>(null);
  const rubberStartRef = useRef<{ x: number; y: number; scrollX: number; scrollY: number } | null>(null);
  const rubberElRef    = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  /*
    A grade do mês e quem falta nela — declaradas AQUI, e não junto do resto do
    render, porque o arrasto precisa consultá-las antes de mover o card.

    A janela é a da GRADE e não a do mês: a primeira e a última semana mostram
    dias do mês vizinho, e uma folga cair justo ali é o caso mais fácil de
    esquecer — é a virada do mês, quando ninguém confere.
  */
  const days = buildCalendarGrid(year, month);
  const ausenciasPorDia = useAusencias(toYMD(days[0]), toYMD(days[days.length - 1]));

  /**
   * O que impede alguém de trabalhar num dia: a folga DELE, ou um dia em que a
   * empresa inteira para.
   *
   * A folga de outra pessoa não entra — é informação da tira, não motivo de
   * aviso. Perguntar por folga alheia treinaria a pessoa a clicar "sim" sem
   * ler, e aí o aviso que importa passa junto.
   */
  const impedimentosNoDia = useCallback((ymd: string, responsavelId?: string | null) => {
    const doDia = ausenciasPorDia.get(ymd) ?? [];
    return doDia.filter(a => a.paraTodos || (responsavelId && a.pessoa_id === responsavelId));
  }, [ausenciasPorDia]);

  /**
   * Pergunta antes de largar trabalho num dia em que ele não vai ser feito.
   *
   * PERGUNTA, e não impede: às vezes é de propósito — a pessoa volta e pega, ou
   * o feriado não vale para quem está naquele card. Bloquear obrigaria a mover
   * duas vezes, ou a mexer na folga para conseguir mexer no card.
   *
   * Devolve verdadeiro quando pode seguir.
   */
  const podeSoltarNoDia = useCallback(async (
    alvos: { nome: string; ymd: string; responsavelId?: string | null }[],
  ) => {
    const conflitos = alvos
      .map(a => ({ ...a, impedimentos: impedimentosNoDia(a.ymd, a.responsavelId) }))
      .filter(a => a.impedimentos.length > 0);

    if (conflitos.length === 0) return true;

    const dia = (ymd: string) =>
      new Date(ymd + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

    /* Os três primeiros por extenso e o resto contado: a lista inteira de um
       lote de vinte viraria um diálogo rolável que ninguém lê. */
    const linhas = conflitos.slice(0, 3).map(c => {
      const motivos = c.impedimentos
        .map(i => i.paraTodos ? `${rotuloDoTipo(i.tipo)}: ${i.titulo}` : rotuloDoTipo(i.tipo))
        .join(' e ');
      return `${c.nome} → ${dia(c.ymd)} (${motivos})`;
    });
    const resto = conflitos.length - linhas.length;

    return confirmar({
      title: conflitos.length === 1
        ? 'Esse dia não é de trabalho'
        : `${conflitos.length} cards caem em dia sem trabalho`,
      description: linhas.join(' · ') + (resto > 0 ? ` e mais ${resto}` : '')
        + '. Mover mesmo assim?',
      confirmText: 'Mover',
      /* O padrao do `useConfirm` e destrutivo -- `destructive !== false` --, e
         o botao saia vermelho. Mover card para dia de folga nao destroi nada:
         e uma escolha, as vezes proposital. Vermelho aqui gastaria o sinal que
         a exclusao precisa ter. */
      destructive: false,
    });
  }, [impedimentosNoDia, confirmar]);

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadAux = useCallback(async () => {
    const [fs, ps, pr, { data: opA }, { data: opF }, { data: opS }] = await Promise.all([
      fetchFunis(),
      fetchPerfis(),
      fetchProjetos(),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'avaliacao').order('ordem'),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'formato').order('ordem'),
      supabase.from('criativo_campos_opcoes').select('campo,valor').eq('campo', 'status_veiculacao').order('ordem'),
    ]);
    setFunis(fs);
    setPerfis(ps);
    setProjetos(pr);
    if (opA?.length) setOpAvaliacao(opA.map(d => d.valor as string));
    else setOpAvaliacao(['Sem dados', 'Validado', 'Não validado']);
    if (opF?.length) setOpFormato(opF.map(d => d.valor as string));
    if (opS?.length) setOpStatus(opS.map(d => d.valor as string));
  }, []);

  /**
   * Quantos cards estão atrasados — em toda a base, não no mês na tela.
   *
   * A cor vermelha do card só aparece se o card estiver num mês que alguém
   * abriu. Um card parado desde junho é vermelho em junho, e ninguém volta a
   * junho. Este número é o que faz o atraso existir sem depender de quem
   * navegou até onde.
   */
  const projetosDaEmpresa = useProjetosDaEmpresa();

  const contarAtrasados = useCallback(async () => {
  /* `undefined` = ainda não sei de quem são os projetos. Consultar agora
     mostraria as duas empresas por um instante — e num painel de produção
     esse instante basta para alguém mexer no card errado. */
    if (projetosDaEmpresa === undefined) return;
    const hoje = toYMD(new Date());
    let q = supabase
      .from('producoes')
      .select('id', { count: 'exact', head: true })
      .or(`data_prazo.lt.${hoje},and(data_prazo.is.null,data_inicio.lt.${hoje})`)
      .not('fase', 'in', FASES_ENCERRADAS_SQL);

    // O mesmo recorte de acesso da lista: quem só vê o próprio trabalho não
    // pode receber a contagem do trabalho dos outros.
    if (fixedField && fixedValue)       q = q.eq(fixedField, fixedValue);
    else if (nivel === 'membro')        q = q.eq('responsavel_id', userId);
    if (fasesVisiveis?.length)          q = q.in('fase', fasesVisiveis);
    if (projetosDaEmpresa)              q = q.in('projeto_id', projetosDaEmpresa);

    const { count } = await q;
    setAtrasados(count ?? 0);
  }, [fixedField, fixedValue, nivel, userId, fasesVisiveis, projetosDaEmpresa]);

  const loadCriativos = useCallback(async () => {
    if (projetosDaEmpresa === undefined) return;
    setLoading(true);
    const windowStart = new Date(year, month - 1, 1);
    const windowEnd   = new Date(year, month + 2, 0);
    const fmt = paraYmd;
    const hoje = toYMD(new Date());

    let q = supabase
      .from('producoes')
      .select([
        'id,nome,tipo,fase,funil_video,data_inicio,data_prazo,editor_nome_historico,funil_ids,tipo_teste',
        'funil:funis(id,nome,produto)',
        'projeto:ofertas_editores!projeto_id(id,nome)',
        'responsavel:perfis!responsavel_id(id,nome)',
        'especialista:perfis!especialista_id(id,nome)',
      ].join(','))
      .not('fase', 'in', '(arquivado,bloqueado)')
      .order('data_inicio', { nullsFirst: false })
      .limit(LIMITE_DE_CARDS);

    if (soAtrasados) {
      // Atraso não cabe na janela de três meses do calendário: por definição
      // ele está no passado, e os mais antigos estão fora dela. Aqui a janela
      // sai e entra a condição de atraso — o mesmo `coalesce(prazo, início)`
      // que `prazoEfetivo` faz na tela, escrito como o PostgREST entende.
      q = q
        .or(`data_prazo.lt.${hoje},and(data_prazo.is.null,data_inicio.lt.${hoje})`)
        .not('fase', 'in', FASES_ENCERRADAS_SQL);
    } else {
      q = q
        .or(`data_prazo.gte.${fmt(windowStart)},and(data_prazo.is.null,data_inicio.gte.${fmt(windowStart)})`)
        .or(`data_prazo.lte.${fmt(windowEnd)},and(data_prazo.is.null,data_inicio.lte.${fmt(windowEnd)})`);
    }

    if (fixedField && fixedValue) {
      q = q.eq(fixedField, fixedValue);
    } else if (nivel === 'membro') {
      q = q.eq('responsavel_id', userId);
    } else if (somenteSetor && setorId) {
      const { data: sp } = await supabase.from('perfis').select('id').eq('setor_id', setorId);
      const ids = sp?.map(p => p.id) ?? [];
      if (ids.length) q = q.in('responsavel_id', ids);
    }

    if (fasesVisiveis?.length) q = q.in('fase', fasesVisiveis);
    /* Os dois convivem: a empresa restringe o universo, o filtro de projeto
       escolhe dentro dele. Dois `in` sobre a mesma coluna é interseção. */
    if (projetosDaEmpresa) q = q.in('projeto_id', projetosDaEmpresa);
    if (filtroProjeto.length) q = q.in('projeto_id', filtroProjeto);
    if (filtroTipo.length)    q = q.in('tipo', filtroTipo);
    if (filtroFase.length)    q = q.in('fase', filtroFase);
    if (filtroAval.length)    q = q.in('avaliacao', filtroAval);
    if (filtroFormato.length) q = q.in('formato', filtroFormato);
    if (filtroStatus.length)  q = q.in('status_veiculacao', filtroStatus);
    if (filtroResp.length) {
      const ids = filtroResp.join(',');
      q = q.or(`responsavel_id.in.(${ids}),especialista_id.in.(${ids}),copy_id.in.(${ids}),gestor_id.in.(${ids})`);
    }

    const { data, error } = await q;
    if (error) {
      // Falhava em silêncio: erro de rede ou de filtro deixava o calendário
      // vazio, e vazio se lê como "não há nada nesse mês".
      toast({ title: 'Não consegui carregar o calendário', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const linhasLidas = linhas<Criativo>(data);
    // O `limit` existe para a tela não travar, mas cortar sem avisar faz o
    // calendário mentir: some card e nada na tela diz que sumiu.
    setTruncado(linhasLidas.length >= LIMITE_DE_CARDS);
    setCriativos(linhasLidas);
    setLoading(false);
  }, [nivel, setorId, userId, somenteSetor, fixedField, fixedValue, fasesVisiveis, year, month, filtroProjeto, filtroTipo, filtroFase, filtroResp, filtroAval, filtroFormato, filtroStatus, toast, soAtrasados]);

  useEffect(() => { loadAux(); }, [loadAux]);
  // A contagem de atrasados se refaz junto: mudar fase ou data de um card
  // muda esse número, e um número velho ali seria pior do que nenhum.
  useEffect(() => { contarAtrasados(); }, [contarAtrasados, criativos]);
  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  // ── DnD: single-day cards ─────────────────────────────────────────────────

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const criativoId = (active.id as string).replace('cal-', '');
    const targetYmd  = (over.id as string).replace('day-', '');
    const criativo   = criativos.find(c => c.id === criativoId);
    if (!criativo || !targetYmd) return;

    // Use data_prazo if it exists, otherwise data_inicio as the reference date
    const cardDate = criativo.data_prazo ?? criativo.data_inicio;
    if (!cardDate || cardDate === targetYmd) return;

    const delta = daysDiff(cardDate, targetYmd);
    if (delta === 0) return;

    // Bulk move: drag a selected card → move all selected by the same delta
    if (selecionando && selectedIds.has(criativoId)) {
      /* Cada card do lote vai para o SEU dia — o delta é o mesmo, o destino
         não. Conferir só o dia onde o mouse soltou deixaria passar os outros. */
      const alvos = criativos
        .filter(c => selectedIds.has(c.id) && (c.data_prazo || c.data_inicio))
        .map(c => ({
          nome: c.nome,
          ymd: addDays((c.data_prazo ?? c.data_inicio)!, delta),
          responsavelId: c.responsavel?.id ?? null,
        }));
      if (!(await podeSoltarNoDia(alvos))) return;

      const patches = criativos
        .filter(c => selectedIds.has(c.id) && (c.data_prazo || c.data_inicio))
        .map(c => {
          const p: Record<string, string> = {};
          if (c.data_prazo) {
            p.data_prazo = addDays(c.data_prazo, delta);
            if (c.data_inicio) p.data_inicio = addDays(c.data_inicio, delta);
          } else if (c.data_inicio) {
            p.data_inicio = addDays(c.data_inicio, delta);
          }
          return { id: c.id, patch: p };
        });

      const antesDe = new Map(criativos.map(c => [c.id, { ...c }]));
      setCriativos(prev => prev.map(c => {
        const p = patches.find(x => x.id === c.id);
        return p ? { ...c, ...p.patch } : c;
      }));
      await Promise.all(patches.map(({ id, patch }) =>
        supabase.from('producoes').update(patch).eq('id', id),
      ));
      await registrarMudancas(
        patches.map(({ id, patch }) => ({ id, antes: antesDe.get(id) ?? {}, patch })), userId);
      return;
    }

    if (!(await podeSoltarNoDia([{
      nome: criativo.nome,
      ymd: targetYmd,
      responsavelId: criativo.responsavel?.id ?? null,
    }]))) return;

    // Single card move — only update the field(s) that already exist
    const patch: Record<string, string> = {};
    if (criativo.data_prazo) {
      patch.data_prazo = targetYmd;
      if (criativo.data_inicio) patch.data_inicio = addDays(criativo.data_inicio, delta);
    } else {
      patch.data_inicio = targetYmd;
    }

    setCriativos(prev => prev.map(c => c.id === criativoId ? { ...c, ...patch } : c));
    const { error } = await supabase.from('producoes').update(patch).eq('id', criativoId);
    if (error) {
      toast({ title: 'Erro ao mover criativo', variant: 'destructive' });
      setCriativos(prev => prev.map(c =>
        c.id === criativoId ? { ...c, data_prazo: criativo.data_prazo, data_inicio: criativo.data_inicio } : c,
      ));
      return;
    }
    await registrarMudancas([{ id: criativoId, antes: { ...criativo }, patch }], userId);
  }, [criativos, selecionando, selectedIds, toast, userId, podeSoltarNoDia]);

  // ── Resize: spanning bars ─────────────────────────────────────────────────

  const saveResize = useCallback(async (
    criativo: Criativo,
    newInicio: string | undefined,
    newPrazo: string | undefined,
  ) => {
    const patch: Record<string, string> = {};
    if (newInicio !== undefined) patch.data_inicio = newInicio;
    if (newPrazo  !== undefined) patch.data_prazo  = newPrazo;
    if (!Object.keys(patch).length) return;

    const finalInicio = newInicio ?? criativo.data_inicio ?? '';
    const finalPrazo  = newPrazo  ?? criativo.data_prazo  ?? '';
    if (finalInicio && finalPrazo && finalInicio > finalPrazo) {
      toast({ title: 'Data de início deve ser anterior ao prazo', variant: 'destructive' });
      return;
    }

    setCriativos(prev => prev.map(c => c.id === criativo.id ? { ...c, ...patch } : c));
    const { error } = await supabase.from('producoes').update(patch).eq('id', criativo.id);
    if (error) {
      toast({ title: 'Erro ao salvar datas', variant: 'destructive' });
      setCriativos(prev => prev.map(c =>
        c.id === criativo.id ? { ...c, data_inicio: criativo.data_inicio, data_prazo: criativo.data_prazo } : c,
      ));
      return;
    }
    await registrarMudancas([{ id: criativo.id, antes: { ...criativo }, patch }], userId);
  }, [toast, userId]);

  // ── Rubber band ──────────────────────────────────────────────────────────

  const handleCalPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('[data-criativo-id]')) return;
    if ((e.target as Element).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Guarda também a rolagem do momento: o ponto inicial é em coordenadas de
    // TELA, e se a página rolar durante o arrasto o conteúdo se move enquanto
    // ele fica parado — o retângulo passa a selecionar a faixa errada.
    rubberStartRef.current = { x: e.clientX, y: e.clientY, scrollY: window.scrollY, scrollX: window.scrollX };
    if (rubberElRef.current) {
      Object.assign(rubberElRef.current.style, {
        display: 'block', left: `${e.clientX}px`, top: `${e.clientY}px`, width: '0px', height: '0px',
      });
    }
  }, []);

  /** O ponto inicial corrigido pelo quanto a página rolou desde que ele foi
   *  marcado — sem isso o retângulo descola do conteúdo ao rolar. */
  const inicioAgora = () => {
    const r0 = rubberStartRef.current!;
    return {
      sx: r0.x - (window.scrollX - r0.scrollX),
      sy: r0.y - (window.scrollY - r0.scrollY),
    };
  };

  const handleCalPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rubberStartRef.current) return;
    const { sx, sy } = inicioAgora();
    if (rubberElRef.current) {
      Object.assign(rubberElRef.current.style, {
        left: `${Math.min(sx, e.clientX)}px`,
        top:  `${Math.min(sy, e.clientY)}px`,
        width:  `${Math.abs(e.clientX - sx)}px`,
        height: `${Math.abs(e.clientY - sy)}px`,
      });
    }
  }, []);

  const limparSelecao = useCallback(() => {
    setSelectedIds(new Set());
    setBulkFase('');
    setBulkResp('');
    setBulkData(null);
  }, []);

  /** Marca ou desmarca um card. Sem ligar modo nenhum: o modo É o conjunto. */
  const alternar = useCallback((id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  /**
   * Fim do laço, com semântica que existe em qualquer gerenciador de arquivos:
   * arrastar SUBSTITUI a seleção, `Shift` SOMA à que já existe.
   *
   * Antes o laço só somava — um segundo arrasto noutro canto acumulava com o
   * primeiro, sem jeito de recomeçar a não ser clicando no vazio. E o clique
   * no vazio só limpava se ele tivesse menos de 4px de tremida: com 5px virava
   * um laço que não selecionava nada E não limpava nada, que é o "às vezes
   * buga" mais difícil de descrever.
   */
  const handleCalPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rubberStartRef.current) return;
    const { sx, sy } = inicioAgora();
    rubberStartRef.current = null;
    if (rubberElRef.current) rubberElRef.current.style.display = 'none';

    const minX = Math.min(sx, e.clientX), maxX = Math.max(sx, e.clientX);
    const minY = Math.min(sy, e.clientY), maxY = Math.max(sy, e.clientY);

    // 4px era pouco para a mão de quem clica com pressa. 8px cobre a tremida
    // sem transformar um arrasto de verdade em clique.
    if (maxX - minX < 8 && maxY - minY < 8) {
      if (selecionando) limparSelecao();
      return;
    }

    // Só os cards DESTE calendário: `document.querySelectorAll` pegaria também
    // os de outra instância na mesma tela — o Meu Painel renderiza dois.
    const raiz = e.currentTarget;
    const next = e.shiftKey ? new Set(selectedIds) : new Set<string>();
    raiz.querySelectorAll('[data-criativo-id]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY) {
        next.add((el as HTMLElement).dataset.criativoId!);
      }
    });
    setSelectedIds(next);
  }, [selectedIds, selecionando, limparSelecao]);

  // `Esc` cancela. Era preciso acertar um clique no vazio para sair da seleção,
  // e num calendário cheio quase não há vazio para acertar.
  useEffect(() => {
    if (!selecionando) return;
    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); limparSelecao(); }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [selecionando, limparSelecao]);

  // ── Bulk apply ────────────────────────────────────────────────────────────

  const applyBulk = useCallback(async () => {
    if (!bulkFase && !bulkResp && !bulkData) return;
    const ids = [...selectedIds];
    // `string | null` e não `string`: mudar a data em lote pode significar
    // APAGAR o prazo — um dia único grava `data_prazo = null`, e um patch que
    // só aceita string não teria como dizer isso.
    const patch: Record<string, string | null> = {};
    if (bulkFase) patch.fase = bulkFase;
    if (bulkResp) patch.responsavel_id = bulkResp;
    if (bulkData) {
      patch.data_inicio = bulkData.inicio;
      patch.data_prazo  = bulkData.prazo;
    }

    const antesDoLote = new Map(criativos.map(c => [c.id, { ...c }]));
    setCriativos(prev => prev.map(c => ids.includes(c.id) ? { ...c, ...patch } : c));
    const { error } = await supabase.from('producoes').update(patch).in('id', ids);
    if (error) {
      toast({ title: 'Erro ao aplicar alterações', variant: 'destructive' });
      loadCriativos();
    } else {
      await registrarMudancas(
        ids.map(id => ({ id, antes: antesDoLote.get(id) ?? {}, patch })), userId);
      toast({ title: `${ids.length} criativo${ids.length !== 1 ? 's' : ''} atualizado${ids.length !== 1 ? 's' : ''}` });
      limparSelecao();
      // A data mudou, então o card pode ter saído do dia em que estava
      // desenhado: sem recarregar, ele ficaria na célula antiga até um F5.
      loadCriativos();
    }
  }, [selectedIds, bulkFase, bulkResp, bulkData, toast, loadCriativos, limparSelecao,
      criativos, userId]);

  /** Os nomes do que está prestes a sumir, para a confirmação poder mostrá-los.
   *  Corta em 8 para o diálogo não virar uma lista rolável. */
  const nomesSelecionados = useCallback((ids: string[]) => {
    const nomes = ids
      .map(id => criativos.find(c => c.id === id)?.nome)
      .filter((n): n is string => !!n);
    const mostrar = nomes.slice(0, 8).join(', ');
    const resto   = nomes.length - 8;
    return resto > 0
      ? `${mostrar} e mais ${resto}. Esta ação não pode ser desfeita.`
      : `${mostrar}. Esta ação não pode ser desfeita.`;
  }, [criativos]);

  /**
   * A SEGUNDA implementação de "duplicar" morava aqui, com a mesma lista de ~25
   * campos escrita de novo — e já divergindo da outra: esta não gravava
   * histórico nenhum. Agora as duas chamam a mesma função, que deriva as
   * colunas da própria tabela.
   */
  const handleBulkDuplicate = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const { data, error } = await supabase.rpc('fn_duplicar_criativos', {
      p_ids: ids, p_usuario: userId,
    });
    if (error) {
      toast({ title: 'Erro ao duplicar', description: error.message, variant: 'destructive' });
      return;
    }
    const n = (data as string[] | null)?.length ?? 0;
    toast({ title: `${n} criativo${n !== 1 ? 's' : ''} duplicado${n !== 1 ? 's' : ''}` });
    limparSelecao();
    // `selectMode` deixou de existir: limpar o conjunto JÁ sai do modo.
    loadCriativos();
  }, [selectedIds, userId, toast, loadCriativos, limparSelecao]);

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    // `confirm()` do navegador era o único no projeto que ainda não usava
    // `useConfirm` — e logo no gesto mais perigoso da tela. A diferença não é
    // estética: a caixa nativa não diz QUAIS cards vão sumir, e aqui pode
    // haver dezenas selecionados por um arrasto que pegou mais do que se viu.
    const ok = await confirmar({
      title: `Excluir ${ids.length} criativo${ids.length !== 1 ? 's' : ''}?`,
      description: nomesSelecionados(ids),
      confirmText: 'Excluir',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('producoes').delete().in('id', ids);
    if (error) { toast({ title: 'Erro ao excluir', variant: 'destructive' }); return; }
    toast({ title: `${ids.length} criativo${ids.length !== 1 ? 's' : ''} excluído${ids.length !== 1 ? 's' : ''}` });
    limparSelecao();
    // `selectMode` deixou de existir: limpar o conjunto JÁ sai do modo.
    loadCriativos();
  }, [selectedIds, toast, loadCriativos, limparSelecao, confirmar, nomesSelecionados]);

  // ── Calendar data ─────────────────────────────────────────────────────────

  const todayYMD = toYMD(now);

  const buscaLower = busca.toLowerCase();
  const displayCriativos = buscaLower
    ? criativos.filter(c => c.nome.toLowerCase().includes(buscaLower))
    : criativos;

  const spanning: Criativo[] = [];
  const byDate: Record<string, Criativo[]> = {};

  for (const c of displayCriativos) {
    if (c.data_inicio && c.data_prazo && c.data_inicio < c.data_prazo) {
      spanning.push(c);
    } else {
      const key = c.data_prazo ?? c.data_inicio;
      if (key) (byDate[key] = byDate[key] ?? []).push(c);
    }
  }

  // Sort each day's cards alphabetically/numerically by name
  for (const key of Object.keys(byDate)) {
    byDate[key].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));


  const activeCriativo = activeId
    ? criativos.find(c => c.id === activeId.replace('cal-', ''))
    : null;

  /** Quantos filtros estão de pé. A busca conta: ela some do campo quando a
   *  linha quebra, e some da cabeça de quem digitou faz meia hora. */
  const filtrosAtivos =
    (busca ? 1 : 0) + [filtroProjeto, filtroTipo, filtroFase, filtroResp,
      filtroAval, filtroFormato, filtroStatus].filter(f => f.length > 0).length;

  const limparFiltros = () => {
    setBusca('');
    setFiltroProjeto([]); setFiltroTipo([]); setFiltroFase([]); setFiltroResp([]);
    setFiltroAval([]); setFiltroFormato([]); setFiltroStatus([]);
  };

  /** Os atrasados em lista, do mais parado para o mais recente — a ordem em
   *  que se resolve, não a ordem alfabética. */
  const listaAtrasados = soAtrasados
    ? [...displayCriativos].sort((a, b) =>
        (prazoEfetivo(a.data_prazo, a.data_inicio) ?? '').localeCompare(
          prazoEfetivo(b.data_prazo, b.data_inicio) ?? ''))
    : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Rubber band overlay — updated imperatively to avoid re-renders */}
      <div
        ref={rubberElRef}
        style={{ display: 'none', position: 'fixed', zIndex: 50 }}
        className="pointer-events-none border border-primary/50 bg-primary/10 rounded-sm"
      />

      {/*
        A barra era uma fila só: busca, sete filtros, legenda e a navegação do
        mês, tudo em `flex-wrap`. Numa tela estreita isso quebrava em duas
        linhas arbitrárias — a navegação do mês, que é o controle mais usado,
        ia parar no fim da fila atrás de sete filtros.

        Agora são duas linhas com papéis diferentes: em cima, ONDE estou e o
        que precisa de atenção; embaixo, o que estou procurando. Cada uma
        quebra dentro de si sem embaralhar a outra.
      */}

      {/* Linha 1 — mês, atrasados, legenda */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={prevMonth} disabled={soAtrasados}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className={cn('text-sm font-medium min-w-[130px] text-center', soAtrasados && 'text-muted-foreground/40')}>
            {MESES[month]} {year}
          </span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={nextMonth} disabled={soAtrasados}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!soAtrasados && (year !== now.getFullYear() || month !== now.getMonth()) && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs ml-1"
              onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}>
              Hoje
            </Button>
          )}
        </div>

        {/* Os atrasados só ficavam vermelhos DENTRO do mês em que caíam, e
            ninguém volta a junho para descobrir que junho tem card parado.
            Este número não depende de quem navegou até onde. */}
        {atrasados > 0 && (
          <button
            onClick={() => setSoAtrasados(v => !v)}
            aria-pressed={soAtrasados}
            className={cn(
              'flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium border transition-colors',
              soAtrasados
                ? 'bg-red-500/20 text-red-300 border-red-500/40'
                : 'bg-red-500/5 text-red-400/80 border-red-500/20 hover:bg-red-500/10',
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            {atrasados} atrasado{atrasados !== 1 ? 's' : ''}
            {soAtrasados && <span className="text-red-300/60">· voltar ao mês</span>}
          </button>
        )}

        <div className="flex-1" />

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-blue-500/20 border border-blue-500/30" />Criativo</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-purple-500/20 border border-purple-500/30" />VSL</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-green-500/20 border border-green-500/30" />Aula</div>
          <div className="flex items-center gap-1.5 pl-2 border-l border-border/40">
            <div className="w-6 h-2 rounded-sm bg-blue-500/20 border border-blue-500/30" />Período
          </div>
        </div>
      </div>

      {/* Linha 2 — busca e filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="h-8 pl-8 w-44 text-xs"
          />
        </div>

        <MultiFilter
          label="Todos os projetos"
          options={projetos}
          value={filtroProjeto}
          onChange={setFiltroProjeto}
          width="w-40"
        />
        <MultiFilter
          label="Tipo"
          options={[
            { id: 'criativo', nome: 'Criativo' },
            { id: 'vsl',      nome: 'VSL' },
            { id: 'aula',     nome: 'Aula' },
          ]}
          value={filtroTipo}
          onChange={setFiltroTipo}
          width="w-40"
        />
        <MultiFilter
          label="Fase"
          options={FASES.map(f => ({ id: f.key, nome: f.label }))}
          value={filtroFase}
          onChange={setFiltroFase}
          width="w-40"
        />
        {nivel !== 'membro' && (
          <MultiFilter
            label="Responsável"
            options={perfis.map(p => ({ id: p.id, nome: p.nome }))}
            value={filtroResp}
            onChange={setFiltroResp}
            width="w-40"
          />
        )}
        {opAvaliacao.length > 0 && (
          <MultiFilter
            label="Avaliação"
            options={opAvaliacao.map(a => ({ id: a, nome: a }))}
            value={filtroAval}
            onChange={setFiltroAval}
            width="w-40"
          />
        )}
        {opFormato.length > 0 && (
          <MultiFilter
            label="Formato"
            options={opFormato.map(a => ({ id: a, nome: a }))}
            value={filtroFormato}
            onChange={setFiltroFormato}
            width="w-40"
          />
        )}
        {opStatus.length > 0 && (
          <MultiFilter
            label="Status"
            options={opStatus.map(a => ({ id: a, nome: a }))}
            value={filtroStatus}
            onChange={setFiltroStatus}
            width="w-40"
          />
        )}

        {/* Limpar só aparece quando há o que limpar — e diz quantos, porque
            um filtro esquecido numa linha que quebrou é o motivo mais comum
            de "sumiu tudo". */}
        {filtrosAtivos > 0 && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={limparFiltros}>
            Limpar {filtrosAtivos} filtro{filtrosAtivos !== 1 ? 's' : ''}
          </Button>
        )}

        {/* Cortar em silêncio faz o calendário mentir: sumiria card e nada na
            tela diria que sumiu. Melhor dizer, e dizer o que fazer. */}
        {truncado && (
          <span className="text-[11px] text-amber-500/90">
            mostrando os primeiros {LIMITE_DE_CARDS} — use os filtros para ver o resto
          </span>
        )}
      </div>

      {soAtrasados ? (
        /* Lista, e não grade: atraso atravessa meses, e uma grade de um mês
           só conseguiria mostrar os atrasados daquele mês — que é exatamente
           o problema que este modo existe para resolver. Os cards continuam
           selecionáveis, porque a ação que se quer aqui é justamente pegar
           vários e remarcar a data de uma vez. */
        <div className="border border-border rounded-lg divide-y divide-border/60">
          {loading && listaAtrasados.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">Carregando…</p>
          )}
          {!loading && listaAtrasados.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Nada atrasado por aqui.
            </p>
          )}
          {listaAtrasados.map(c => {
            const prazo   = prazoEfetivo(c.data_prazo, c.data_inicio);
            const dias    = prazo ? daysDiff(prazo, todayYMD) : 0;
            const marcado = selectedIds.has(c.id);
            return (
              <button
                key={c.id}
                data-criativo-id={c.id}
                onClick={e => {
                  if (selecionando || e.shiftKey) alternar(c.id);
                  else setSelectedId(c.id);
                }}
                className={cn(
                  'w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40',
                  marcado && 'bg-primary/10',
                )}
              >
                <span className="w-16 shrink-0 text-xs font-medium text-red-400 tabular-nums">
                  {dias} dia{dias !== 1 ? 's' : ''}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{c.nome}</span>
                  <span className="text-[11px] text-muted-foreground truncate block">
                    {FASES_MAP[c.fase] ?? c.fase}
                    {c.projeto?.nome && <> · {c.projeto.nome}</>}
                    {(c.responsavel?.nome ?? c.editor_nome_historico) && <> · {c.responsavel?.nome ?? c.editor_nome_historico}</>}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                  {prazo && new Date(prazo + 'T00:00:00').toLocaleDateString('pt-BR')}
                </span>
              </button>
            );
          })}
        </div>
      ) : loading && criativos.length === 0 ? (
        <div className="border border-border rounded-lg overflow-hidden animate-pulse">
          <div className="grid grid-cols-7 bg-muted/30 border-b border-border">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="py-2 flex justify-center">
                <div className="h-2.5 w-6 bg-muted rounded" />
              </div>
            ))}
          </div>
          {[...Array(5)].map((_, ri) => (
            <div key={ri} className="grid grid-cols-7 divide-x divide-border border-b border-border last:border-b-0">
              {[...Array(7)].map((_, ci) => (
                <div key={ci} className="p-1.5 min-h-[90px]">
                  <div className="h-4 w-4 bg-muted rounded-full mb-2" />
                  {(ri * 7 + ci) % 3 === 0 && <div className="h-5 bg-muted/70 rounded mb-1" />}
                  {(ri * 7 + ci) % 5 === 0 && <div className="h-5 bg-muted/50 rounded" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div
            className="border border-border rounded-lg overflow-hidden"
            onPointerDown={handleCalPointerDown}
            onPointerMove={handleCalPointerMove}
            onPointerUp={handleCalPointerUp}
          >
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 bg-muted/30 border-b border-border">
              {DIAS_SEMANA.map(d => (
                <div key={d} className="text-[10.5px] font-semibold text-muted-foreground text-center py-2 uppercase tracking-wide">
                  {d}
                </div>
              ))}
            </div>

            {/* Week rows */}
            <div className="divide-y divide-border">
              {weeks.map((weekDays, wIdx) => {
                const spanEntries = getSpanningForWeek(weekDays, spanning, previewMap);
                const laneCount   = spanEntries.length > 0
                  ? spanEntries.reduce((m, e) => Math.max(m, e.lane), 0) + 1
                  : 0;
                const LANE_H    = 62;
                const spanOffset = laneCount > 0 ? laneCount * LANE_H + 4 : 0;

                return (
                  <div key={wIdx} className="relative">
                    {/* Barras de período.
                        Ficavam em `top-0.5`, ou seja, coladas no alto da
                        semana — e como o `paddingTop` da célula empurrava o
                        número do dia para baixo delas, a barra passava POR
                        CIMA da data. Descendo o overlay para depois do
                        cabeçalho, o dia volta a ser a primeira coisa da
                        célula e a barra fica onde o card fica. */}
                    {laneCount > 0 && (
                      <div
                        ref={el => { if (el) weekOverlayRefs.current.set(wIdx, el); else weekOverlayRefs.current.delete(wIdx); }}
                        className="absolute left-0 right-0 grid grid-cols-7 z-10"
                        style={{ top: ALTURA_DO_CABECALHO, gridTemplateRows: `repeat(${laneCount}, ${LANE_H}px)` }}
                      >
                        {spanEntries.map(e => {
                          const pm       = previewMap[e.criativo.id] ?? {};
                          const effPrazo  = pm.data_prazo  ?? e.criativo.data_prazo!;
                          const effInicio = pm.data_inicio ?? e.criativo.data_inicio!;
                          const isLate   = effPrazo < todayYMD && !FASES_CONCLUIDAS.has(e.criativo.fase);
                          const tipoCor  = isLate
                            ? 'bg-red-500/20 text-red-300 border-red-500/30'
                            : (TIPO_COR[e.criativo.tipo] ?? 'bg-primary/10 text-primary border-primary/20');
                          const editorName = e.criativo.responsavel?.nome ?? e.criativo.editor_nome_historico;

                          const makeHandle = (edge: 'left' | 'right') => ({
                            onPointerDown: (evt: React.PointerEvent<HTMLDivElement>) => {
                              evt.stopPropagation();
                              evt.currentTarget.setPointerCapture(evt.pointerId);
                              resizeRef.current = { criativoId: e.criativo.id, edge };
                            },
                            onPointerMove: (evt: React.PointerEvent<HTMLDivElement>) => {
                              if (!evt.currentTarget.hasPointerCapture(evt.pointerId)) return;
                              const overlayEl = weekOverlayRefs.current.get(wIdx);
                              if (!overlayEl) return;
                              const rect   = overlayEl.getBoundingClientRect();
                              const colIdx = Math.max(0, Math.min(6, Math.floor((evt.clientX - rect.left) / (rect.width / 7))));
                              const newYmd = toYMD(weekDays[colIdx]);
                              setPreviewMap(prev => ({
                                ...prev,
                                [e.criativo.id]: edge === 'right'
                                  ? { ...prev[e.criativo.id], data_prazo:  newYmd }
                                  : { ...prev[e.criativo.id], data_inicio: newYmd },
                              }));
                            },
                            onPointerUp: async (evt: React.PointerEvent<HTMLDivElement>) => {
                              if (!evt.currentTarget.hasPointerCapture(evt.pointerId)) return;
                              evt.currentTarget.releasePointerCapture(evt.pointerId);
                              const cur = previewMap[e.criativo.id];
                              if (cur) {
                                await saveResize(
                                  e.criativo,
                                  edge === 'left'  ? cur.data_inicio : undefined,
                                  edge === 'right' ? cur.data_prazo  : undefined,
                                );
                              }
                              setPreviewMap(prev => { const n = { ...prev }; delete n[e.criativo.id]; return n; });
                              resizeRef.current = null;
                            },
                          });

                          return (
                            <div
                              key={`${e.criativo.id}-w${wIdx}`}
                              data-criativo-id={e.criativo.id}
                              className={cn(
                                'relative flex items-center text-[10.5px] border h-[58px] self-center overflow-hidden',
                                tipoCor,
                                // O anel de selecionado também faltava aqui: o
                                // card entrava no laço e não mostrava que tinha
                                // entrado.
                                selectedIds.has(e.criativo.id) && 'ring-1 ring-primary',
                                e.isFirst ? 'rounded-l-[3px] ml-0.5' : 'rounded-l-none border-l-0 ml-0',
                                e.isLast  ? 'rounded-r-[3px] mr-0.5' : 'rounded-r-none border-r-0 mr-0',
                              )}
                              style={{ gridColumn: `${e.startCol} / ${e.endCol}`, gridRow: `${e.lane + 1}` }}
                            >
                              {/* Left resize handle */}
                              {e.isFirst && (
                                <div
                                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 hover:bg-white/20 rounded-l-[3px] touch-none"
                                  {...makeHandle('left')}
                                />
                              )}

                              {/* Content.
                                  O clique aqui SÓ abria — este é o card de
                                  período, desenhado por um caminho diferente do
                                  card de dia único, e a seleção nunca chegou
                                  nele. O efeito para quem usa era arbitrário:
                                  shift+clique selecionava um card e abria
                                  outro, e a diferença entre os dois (ter ou não
                                  intervalo de datas) é invisível na tela. */}
                              <button
                                onClick={(ev) => {
                                  if (selecionando || ev.shiftKey) alternar(e.criativo.id);
                                  else setSelectedId(e.criativo.id);
                                }}
                                className="flex-1 flex flex-col justify-center px-1.5 overflow-hidden hover:opacity-75 h-full gap-px"
                                title={[e.criativo.nome, FASES_MAP[e.criativo.fase] ?? e.criativo.fase, e.criativo.projeto?.nome, e.criativo.funil?.nome ?? e.criativo.funil_video, editorName].filter(Boolean).join(' · ')}
                              >
                                {e.isFirst ? (
                                  <>
                                    <span className="font-medium text-[10.5px] truncate leading-tight">{e.criativo.nome}</span>
                                    <span className="text-[9.5px] opacity-70 truncate leading-tight">{FASES_MAP[e.criativo.fase] ?? e.criativo.fase}</span>
                                    {e.criativo.projeto?.nome && <span className="text-[9.5px] opacity-60 truncate leading-tight">{e.criativo.projeto.nome}</span>}
                                    {(e.criativo.funil?.nome ?? e.criativo.funil_video) && <span className="text-[9.5px] opacity-55 truncate leading-tight">{e.criativo.funil?.nome ?? e.criativo.funil_video}</span>}
                                    {e.criativo.tipo_teste && <span className="text-[9.5px] opacity-50 truncate leading-tight">{e.criativo.tipo_teste}</span>}
                                    {e.criativo.especialista?.nome && <span className="text-[9.5px] opacity-50 truncate leading-tight">{e.criativo.especialista.nome}</span>}
                                    {editorName && <span className="text-[9.5px] opacity-50 truncate leading-tight">{editorName}</span>}
                                  </>
                                ) : (
                                  editorName && <span className="text-[9px] opacity-60 truncate leading-tight">{editorName}</span>
                                )}
                              </button>

                              {/* Right resize handle */}
                              {e.isLast && (
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 hover:bg-white/20 rounded-r-[3px] touch-none"
                                  {...makeHandle('right')}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Day cells */}
                    <div className="grid grid-cols-7 divide-x divide-border">
                      {weekDays.map((day, dIdx) => {
                        const ymd            = toYMD(day);
                        const isCurrentMonth = day.getMonth() === month;
                        const isToday        = ymd === todayYMD;
                        const isPast         = ymd < todayYMD;
                        const items = byDate[ymd] ?? [];

                        return (
                          <div
                            key={dIdx}
                            data-date={ymd}
                            className={cn('p-1.5 flex flex-col group/day', !isCurrentMonth && 'bg-muted/10')}
                            style={{ minHeight: `${90 + spanOffset}px` }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={cn(
                                'text-[11px] font-semibold px-1 rounded-full w-5 h-5 flex items-center justify-center',
                                isToday
                                  ? 'bg-primary text-primary-foreground'
                                  : isPast
                                    ? 'text-muted-foreground/40'
                                    : isCurrentMonth
                                      ? 'text-foreground'
                                      : 'text-muted-foreground/30',
                              )}>
                                {day.getDate()}
                              </span>
                              {nivel !== 'membro' && isCurrentMonth && selectedIds.size === 0 && (
                                // Estava em `opacity-0` até passar o mouse: um
                                // botão que só existe para quem já sabia que
                                // ele existia. Agora fica visível, discreto, e
                                // escurece no hover.
                                <button
                                  onClick={() => setCreateDate(ymd)}
                                  title={`Novo item em ${day.getDate()}`}
                                  aria-label={`Novo item em ${day.getDate()}`}
                                  className="text-muted-foreground/40 hover:text-foreground hover:bg-accent transition-colors h-4 w-4 flex items-center justify-center rounded"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              )}
                            </div>

                            {/*
                              Quem não trabalha neste dia — antes dos cards, e
                              não depois, porque é uma condição do DIA: ela vale
                              para tudo que estiver embaixo. Depois da lista,
                              seria uma nota de rodapé que ninguém lê antes de
                              arrastar um card para cá.
                            */}
                            <TiraDeAusencias
                              ausencias={ausenciasPorDia.get(ymd)}
                              perfis={perfis}
                            />

                            {/* O lugar que as barras de período ocupam nesta
                                semana. Vazio quando não há nenhuma. */}
                            {spanOffset > 0 && <div style={{ height: spanOffset }} aria-hidden />}

                            <DroppableDay ymd={ymd}>
                              {items.map(c => (
                                <DraggableCalCard
                                  key={c.id}
                                  criativo={c}
                                  todayYMD={todayYMD}
                                  selecionando={selecionando}
                                  isSelected={selectedIds.has(c.id)}
                                  onOpen={() => setSelectedId(c.id)}
                                  onToggle={() => alternar(c.id)}
                                  onResizeRight={async (targetYmd) => {
                                    const original = c.data_prazo ?? c.data_inicio ?? ymd;
                                    await saveResize(c, original, targetYmd);
                                  }}
                                />
                              ))}
                            </DroppableDay>

                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCriativo && (
              <div className="w-40 rotate-1 shadow-xl opacity-95 pointer-events-none">
                <div className={cn(
                  'rounded px-1.5 py-0.5 text-[10.5px] border font-medium truncate',
                  TIPO_COR[activeCriativo.tipo] ?? 'bg-primary/10 text-primary border-primary/20',
                )}>
                  {activeCriativo.nome}
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Bulk action bar */}
      {selecionando && (
        <div className="sticky bottom-4 z-40 flex flex-wrap items-center justify-center gap-2 bg-card border border-border rounded-lg shadow-lg px-4 py-2 mx-auto w-fit max-w-full">
          {/* `flex-wrap` e `max-w-full`: com o seletor de data a barra passou
              a caber justo, e numa tela estreita o "Aplicar" saía pela
              direita — o botão que a barra existe para oferecer. */}
          <span className="text-sm font-medium">
            {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="w-px h-4 bg-border mx-1" />
          <Select value={bulkFase || '_'} onValueChange={v => setBulkFase(v === '_' ? '' : v)}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Mudar fase" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_">Fase...</SelectItem>
              {FASES.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bulkResp || '_'} onValueChange={v => setBulkResp(v === '_' ? '' : v)}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_">Responsável...</SelectItem>
              {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Data em lote — o mesmo seletor do formulário, então a regra do
              clique e do arrasto é uma só na área inteira. Só que aqui ele
              não grava sozinho: espera o Aplicar, como os outros dois. */}
          <div className="w-40">
            <SeletorDePrazo
              inicio={bulkData?.inicio ?? null}
              prazo={bulkData?.prazo ?? null}
              onChange={(inicio, prazo) => setBulkData(inicio ? { inicio, prazo } : null)}
              className="h-7"
            />
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={applyBulk} disabled={!bulkFase && !bulkResp && !bulkData}>
            Aplicar
          </Button>
          {nivel === 'socio' && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleBulkDuplicate}>
                <Copy className="h-3 w-3" />Duplicar
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-red-400 hover:text-red-300" onClick={handleBulkDelete}>
                <Trash2 className="h-3 w-3" />Excluir
              </Button>
            </>
          )}
        </div>
      )}

      <CriativoFormModal
        open={createDate !== null}
        onClose={() => setCreateDate(null)}
        onCreated={() => { loadCriativos(); setCreateDate(null); }}
        userId={userId}
        funis={funis}
        perfis={perfis}
        defaultDate={createDate ?? undefined}
      />

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={loadCriativos}
        nivel={nivel}
        userId={userId}
        funis={funis}
        perfis={perfis}
      />
    </div>
  );
}
