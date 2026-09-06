import { todasAsLinhas } from '@/lib/supabase';
import { paraYmd } from '@/lib/datas';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Search, CalendarIcon, GitBranch, Ruler, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { cn } from '@/lib/utils';
import { fetchProjetos, fetchFunis } from '@/lib/dataCache';
import { useToast } from '@/hooks/use-toast';
import { MultiFilter } from '@/features/producao/components/MultiFilter';
import { CriativoDrawer } from '@/features/producao/components/CriativoDrawer';
import { useMetricasDoAd, TiraDeMetricas, LegendaFontes } from '@/features/criativos/metricasDoAd';
import { PedidoVariacaoModal } from '@/features/producao/components/PedidoVariacaoModal';
import type { Perfil, Funil } from '@/features/producao/components/types';

/*
  A grade da lista, escrita uma vez.

  Ela aparece no cabeçalho e em cada linha; com a largura repetida nos dois
  lugares, acrescentar coluna significa acertar dois literais iguais — e o dia
  em que só um for acertado, o cabeçalho desalinha das linhas em silêncio.
*/
/*
  O nome tem PISO, e projeto e editor cedem no lugar dele.

  Com `1fr` puro e as outras colunas fixas, a coluna do nome ficava com 92px
  numa janela de 959 -- e tres criativos diferentes ("AD 002 H01 V01", "H02",
  "H03") apareciam todos como "AD 002 H0...". Numa tela de avaliacao, nao
  distinguir um AD do outro e o defeito mais caro possivel.

  140px cabe o codigo inteiro. Projeto e editor viram `1fr` com piso menor
  porque truncar "Velas Lembrancinhas" ainda deixa reconhecer o projeto;
  truncar o codigo do AD nao deixa reconhecer nada.
*/
/*
  Em `style`, e nao em classe do Tailwind.

  O Tailwind varre o codigo procurando strings LITERAIS: uma classe montada
  por template literal -- `grid-cols-[${COLS}]` -- nunca chega ao CSS, e a
  grade simplesmente nao existe. Ou se escreve o literal duas vezes (o que o
  comentario acima proibe, com razao) ou se sai do Tailwind para esta
  propriedade. A segunda opcao mantem UM lugar definindo as colunas.

  36px: o atalho e so o icone. Com rotulo escrito ele custava 72px e comia a
  largura da coluna NOME, que passava a mostrar "AD 00..." -- trocar o nome do
  criativo por um botao e o oposto do que o atalho existe para fazer.
*/
const COLS_BASE = 'minmax(140px,1.6fr) minmax(80px,1fr) minmax(80px,1fr) 120px 120px';

const grade = (comAtalho: boolean) => ({
  gridTemplateColumns: comAtalho ? `${COLS_BASE} 36px` : COLS_BASE,
});

interface CriativoPostado {
  id: string;
  nome: string;
  tipo: string;
  fase: string;
  formato: string | null;
  status_veiculacao: string | null;
  avaliacao: string | null;
  responsavel_id: string | null;
  projeto_id: string | null;
  funil_ids: string[];
  responsavel: { id: string; nome: string } | null;
  projeto: { id: string; nome: string } | null;
  data_inicio: string | null;
  data_postagem: string | null;
  /* O que o META diz dos anuncios deste card — nao o que alguem marcou.
     Ver `vw_producao_estado_ads` e o bloco ESTADO_ADS abaixo. */
  estado_ads: string | null;
  /* O ultimo dia em que algum anuncio do card realmente GASTOU. E o fato;
     o estado acima e o que a Meta reporta AGORA. Os dois respondem coisas
     diferentes — "esta ligado?" e "quando parou?" — e se confirmam: dos 62
     cards no ar, 54 gastaram ontem ou hoje; dos 342 parados, 1. */
  ultimo_gasto: string | null;
  data_ref: string | null;
}

interface Props {
  userId: string;
}

function isPendente(c: CriativoPostado): boolean {
  const semAvaliacao = !c.avaliacao || c.avaliacao === 'Sem dados';
  // Rodando sem avaliação → precisa ser avaliado
  const rodandoSemDados = c.status_veiculacao === 'Rodando' && semAvaliacao;
  // Sem status E sem avaliação → completamente em branco
  const completamenteVazio = !c.status_veiculacao && !c.avaliacao;
  return rodandoSemDados || completamenteVazio;
}

const STATUS_COR: Record<string, string> = {
  'Rodando':   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Pausado':   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'Encerrado': 'bg-muted/60 text-muted-foreground border-border',
  'Bloqueado': 'bg-red-500/10 text-red-400 border-red-500/20',
  'Arquivado': 'bg-muted/40 text-muted-foreground/60 border-border/50',
};

/**
 * O CRIVO: os números que separam validado de escalado.
 *
 * Fica na tela porque é aqui que a decisão é tomada, e número que mora numa
 * conversa não sobrevive à terceira avaliação — some, e cada pessoa passa a
 * usar a régua que lembra.
 *
 * MEDIDO, não arbitrado. 782 ADs e R$ 242.143 de mídia entre 01/06 e 04/09 de
 * 2026, com receita e vendas da PAYT. Nunca do Meta: a janela de atribuição de
 * 7 dias credita venda de backend ao anúncio de topo e infla o ROAS de quem
 * está no começo do funil.
 *
 * DE ONDE SAI CADA NÚMERO
 *
 * 1,6 é o empate DE VERDADE: taxa da Payt 6,1% + reembolso 1,7% + Simples 9%
 * + 14% de imposto sobre a mídia + os R$ 25.000/mês de custo fixo. Sem o custo
 * fixo daria 1,37, e foi por isso que a primeira versão desta conta estava
 * errada — validava no empate, e aí escalar levava para o vermelho.
 *
 * 2,5 é a única régua que sobrevive à escala. Medido: quando o AD ganha verba,
 * o ROAS cai para ~63% do que era no teste (80% dos ADs caem). Os que passaram
 * em 2,5 renderam 1,64 depois — acima do empate. Os de 2,0 renderam 1,60, os
 * de 1,6 renderam 1,49: os dois abaixo. A 3,0 piora (1,45), que é ruído de
 * amostra pequena, não sinal.
 *
 * 6 e 10 vendas são sobre CONFIANÇA, não sobre lucro. Com 4 vendas a decisão
 * acerta 71% — quase cara-ou-coroa. Com 6, acerta 86%. E a dispersão do ROAS
 * só fecha em 10 vendas: o desvio cai de 1,54 para 0,32. ROAS 3,0 com 3 vendas
 * é sorte, e escalar sorte custa caro.
 *
 * QUANDO REFAZER: se a taxa da Payt, o Simples ou o custo fixo mudarem, o 1,6
 * muda junto. A data está na tela de propósito — régua sem data envelhece em
 * silêncio, que é a terceira armadilha do CLAUDE.md.
 */
const CRIVO = {
  medidoEm: '06/09/2026',
  empate: '1,6',
  linhas: [
    { nivel: 'Validado', vendas: 6,  roas: '1,6', cor: 'text-emerald-400',
      significa: 'se paga — mantém no ar e pede variação' },
    { nivel: 'Escalado', vendas: 10, roas: '2,5', cor: 'text-primary',
      significa: 'aguenta verba — pode aumentar o orçamento' },
  ],
};

function TabelaDoCrivo() {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Ruler className="h-3.5 w-3.5" />
          Crivo
        </span>

        {CRIVO.linhas.map(l => (
          <span key={l.nivel} className="flex items-baseline gap-2 text-xs">
            <span className={cn('font-medium', l.cor)}>{l.nivel}</span>
            {/* Os dois números juntos e em tabular: é assim que a pessoa
                compara com a linha que está avaliando, sem procurar. */}
            <span className="tabular-nums text-foreground">
              {l.vendas} vendas · ROAS {l.roas}
            </span>
            <span className="text-muted-foreground">{l.significa}</span>
          </span>
        ))}

        <button
          onClick={() => setAberto(v => !v)}
          className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          de onde vem
          <ChevronDown className={cn('h-3 w-3 transition-transform', aberto && 'rotate-180')} />
        </button>
      </div>

      {aberto && (
        <div className="border-t border-border px-4 py-3 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <span className="text-foreground">Vendas e ROAS da Payt</span>, nunca do Meta —
            a janela de 7 dias do Meta credita venda de backend ao anúncio de topo.
          </p>
          <p>
            <span className="text-foreground">ROAS {CRIVO.empate} é o empate real:</span>{' '}
            taxa da Payt 6,1% + reembolso 1,7% + Simples 9% + 14% de imposto sobre a mídia
            + R$ 25.000/mês de custo fixo. Sem o custo fixo daria 1,37, e aí validar seria
            validar no zero.
          </p>
          <p>
            <span className="text-foreground">2,5 para escalar</span> porque escalar derruba
            o ROAS para ~63% do que era no teste — 80% dos ADs caem. Medido: quem passou em
            2,5 rendeu 1,64 depois; quem passou em 2,0 rendeu 1,60 e em 1,6 rendeu 1,49,
            os dois abaixo do empate.
          </p>
          <p>
            <span className="text-foreground">6 e 10 vendas são sobre confiança:</span>{' '}
            com 4 vendas a decisão acerta 71%, com 6 acerta 86%, e a dispersão do ROAS só
            fecha em 10 (desvio cai de 1,54 para 0,32). ROAS alto com 3 vendas é sorte.
          </p>
          <p className="pt-1 text-muted-foreground/60">
            Medido em {CRIVO.medidoEm} sobre 782 ADs e R$ 242.143 de mídia (01/06 a 04/09).
            Se a taxa da Payt, o Simples ou o custo fixo mudarem, o {CRIVO.empate} muda junto.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * O que o Meta diz dos anúncios do card, e como isso aparece.
 *
 * `status_veiculacao` — a coluna ao lado — é o que ELA marcou. Este é o fato.
 * Os dois divergem, e a divergência é cara:
 *
 *   marcado "Encerrado", ativo no Meta   24 cards, R$ 5.691,62 em 7 dias
 *   marcado "Rodando", pausado no Meta   29 cards, R$   652,52 em 7 dias
 *
 * O primeiro é dinheiro saindo num criativo que ela considera encerrado. Sem
 * esta coluna não havia como ver isso sem abrir o Business Manager.
 *
 * Vem de `effective_status` e nunca de `status`: o segundo é só o botão do
 * anúncio e ignora campanha ou conjunto pausados — divergem em 4.825 dos 8.123
 * anúncios, e usar o errado mostraria quase tudo como ativo.
 */
const ESTADO_ADS: Record<string, { rotulo: string; cor: string; titulo: string }> = {
  ativo:        { rotulo: 'no ar',       cor: 'text-emerald-400',
                  titulo: 'Pelo menos um anúncio deste card está entregando agora' },
  pausado:      { rotulo: 'parado',      cor: 'text-muted-foreground',
                  titulo: 'Todos os anúncios estão pausados — no anúncio, no conjunto ou na campanha' },
  reprovado:    { rotulo: 'reprovado',   cor: 'text-destructive',
                  titulo: 'A Meta recusou o anúncio' },
  com_problema: { rotulo: 'com problema', cor: 'text-warning',
                  titulo: 'A Meta sinalizou problema no anúncio' },
  sem_anuncio:  { rotulo: 'sem anúncio', cor: 'text-muted-foreground/50',
                  titulo: 'Nenhum anúncio ligado a este card, ou o anúncio sumiu da API' },
};

/** Data curta para caber na célula: "05/09". Ano só quando não é o atual. */
function diaCurto(iso: string): string {
  const [a, m, d] = iso.split('-');
  const esteAno = String(new Date().getFullYear());
  return a === esteAno ? `${d}/${m}` : `${d}/${m}/${a.slice(2)}`;
}

/** A marcação dela contradiz o Meta? É o caso que custa dinheiro. */
function contradiz(marcado: string | null, estado: string | null): boolean {
  if (!marcado || !estado) return false;
  if (marcado === 'Rodando')   return estado === 'pausado' || estado === 'sem_anuncio';
  if (marcado === 'Encerrado') return estado === 'ativo';
  if (marcado === 'Pausado')   return estado === 'ativo';
  return false;
}

const AVAL_COR: Record<string, string> = {
  'Validado':     'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Não validado': 'bg-red-500/10 text-red-400 border-red-500/20',
  'Sem dados':    'bg-muted/60 text-muted-foreground border-border',
};

export function AvaliacaoView({ userId }: Props) {
  /*
    O número de cada AD, da vida inteira do anúncio.

    Sem período: avaliar um criativo pelo mês corrente reprovaria todo AD que
    estreou ontem, e a pergunta aqui é "esta peça funcionou?", não "quanto ela
    rendeu em agosto".
  */
  const { metricas } = useMetricasDoAd(null, null);

  const { toast } = useToast();

  const [criativos, setCriativos]     = useState<CriativoPostado[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState<string | null>(null);
  const [opStatus, setOpStatus]       = useState<string[]>(['Rodando', 'Pausado', 'Encerrado', 'Bloqueado', 'Arquivado']);
  const [opAvaliacao, setOpAvaliacao] = useState<string[]>(['Sem dados', 'Validado', 'Não validado']);
  const [opFormato, setOpFormato]     = useState<string[]>([]);
  const [projetos, setProjetos]       = useState<{ id: string; nome: string }[]>([]);
  const [perfis, setPerfis]           = useState<Perfil[]>([]);
  const [funis, setFunis]             = useState<Funil[]>([]);
  const [selectedId, setSelectedId]   = useState<string | null>(null);

  const [busca, setBusca]                 = useState('');
  const [filtroProjeto, setFiltroProjeto] = useState<string[]>([]);
  const [filtroTipo, setFiltroTipo]       = useState<string[]>([]);
  const [filtroEditor, setFiltroEditor]   = useState<string[]>([]);
  const [filtroAval, setFiltroAval]       = useState<string[]>([]);
  const [filtroFormato, setFiltroFormato] = useState<string[]>([]);
  const [filtroStatus, setFiltroStatus]   = useState<string[]>([]);
  const [filtroFunil, setFiltroFunil]     = useState<string[]>([]);
  const [preset, setPreset]               = useState<'this' | 'last' | 'custom'>('this');
  const [dateRange, setDateRange]         = useState<DateRange | undefined>();
  const [calOpen, setCalOpen]             = useState(false);
  /*
    O atalho de pedir variação, sem precisar abrir o card.

    A ação já existia — dentro do card, embaixo da avaliação, que é onde a
    decisão nasce. O que faltava era o caminho curto: nesta lista a pessoa
    avalia dez criativos seguidos, e abrir e fechar o card para pedir variação
    de um deles quebra o ritmo da revisão.

    É o MESMO modal e a MESMA regra de permissão — `fn_pode_pedir_variacao`, a
    função que a RLS aplica. Não há cópia da condição aqui: escrever "é gestor
    de tráfego ou admin" numa segunda tela seria a versão que envelhece.
  */
  const [podePedir, setPodePedir]       = useState(false);
  const [comPedido, setComPedido]       = useState<Set<string>>(new Set());
  const [pedindo, setPedindo]           = useState<{ id: string; nome: string } | null>(null);
  const [somentePendentes, setSomentePendentes] = useState(false);
  /* Só os cards em que a marcação dela contradiz a Meta. São 53 hoje, e o
     lado caro são os 24 marcados "Encerrado" que gastaram R$ 5.691,62 em
     sete dias. Sem este filtro eles ficam espalhados entre 2.837 linhas. */
  const [somenteContradicao, setSomenteContradicao] = useState(false);
  const [mostrarInativos, setMostrarInativos]   = useState(false);

  /*
    Quem já tem pedido aberto vem numa consulta só, e não uma por linha.

    São 148 criativos na tela; perguntar por card seriam 148 idas ao banco para
    desenhar uma lista.
  */
  const carregarPedidos = useCallback(async () => {
    const [pode, abertos] = await Promise.all([
      supabase.rpc('fn_pode_pedir_variacao'),
      supabase.from('pedidos_variacao').select('producao_id').eq('status', 'aberto'),
    ]);
    setPodePedir(pode.data === true);
    setComPedido(new Set(((abertos.data ?? []) as { producao_id: string }[]).map(x => x.producao_id)));
  }, []);

  useEffect(() => { void carregarPedidos(); }, [carregarPedidos]);

  // `toISOString()` em toda linha aqui — e a última dupla é a que doía: as
  // datas vêm do calendário, onde a escolhida pode carregar a hora atual. Às
  // 21h, escolher "26" mandava 27 para a consulta.
  const { dateStart, dateEnd } = useMemo(() => {
    const now = new Date();
    if (preset === 'this') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { dateStart: paraYmd(s), dateEnd: paraYmd(e) };
    }
    if (preset === 'last') {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateStart: paraYmd(s), dateEnd: paraYmd(e) };
    }
    const s = dateRange?.from ? paraYmd(dateRange.from) : '';
    const e = dateRange?.to   ? paraYmd(dateRange.to)   : '';
    return { dateStart: s, dateEnd: e };
  }, [preset, dateRange]);

  const rangeLabel = useMemo(() => {
    if (!dateRange?.from) return 'Selecionar período';
    const from = format(dateRange.from, 'dd/MM/yy', { locale: ptBR });
    const to   = dateRange.to ? format(dateRange.to, 'dd/MM/yy', { locale: ptBR }) : '…';
    return `${from} → ${to}`;
  }, [dateRange]);

  const loadOpcoes = useCallback(async () => {
    const [{ data: opS }, { data: opA }, { data: opF }, pj, { data: pf }, fs] = await Promise.all([
      supabase.from('criativo_campos_opcoes').select('valor').eq('campo', 'status_veiculacao').order('ordem'),
      supabase.from('criativo_campos_opcoes').select('valor').eq('campo', 'avaliacao').order('ordem'),
      supabase.from('criativo_campos_opcoes').select('valor').eq('campo', 'formato').order('ordem'),
      fetchProjetos(),
      supabase.from('perfis')
        .select('id,nome,is_admin,cargo_id,setor_id,cargo:cargos(id,nome),setor:setores(id,nome),ativo')
        .eq('ativo', true).order('nome'),
      fetchFunis(),
    ]);
    if (opS?.length) setOpStatus(opS.map(d => d.valor as string));
    if (opA?.length) setOpAvaliacao(opA.map(d => d.valor as string));
    if (opF?.length) setOpFormato(opF.map(d => d.valor as string));
    setProjetos(pj);
    setPerfis((pf ?? []) as Perfil[]);
    setFunis(fs as Funil[]);
  }, []);

  const projetosDaEmpresa = useProjetosDaEmpresa();

  const load = useCallback(async () => {
    /* undefined = ainda não sei de quem são os projetos; consultar agora
       mostraria as duas empresas por um instante. */
    if (projetosDaEmpresa === undefined) return;
    setLoading(true);

    // Constrói query base com os filtros do momento; chamada duas vezes para paginar
    const mkQuery = () => {
      let q = supabase
        .from('producoes')
        .select('id,nome,tipo,fase,formato,data_inicio,status_veiculacao,avaliacao,responsavel_id,projeto_id,funil_ids,responsavel:perfis!responsavel_id(id,nome),projeto:ofertas_editores!projeto_id(id,nome)')
        .order('nome');
      q = q.eq('fase', 'postado');
      if (!mostrarInativos) q = q.not('fase', 'in', '(arquivado,bloqueado)');
      if (projetosDaEmpresa) q = q.in('projeto_id', projetosDaEmpresa);
      if (filtroProjeto.length) q = q.in('projeto_id', filtroProjeto);
      if (filtroTipo.length)    q = q.in('tipo', filtroTipo);
      if (filtroEditor.length)  q = q.in('responsavel_id', filtroEditor);
      if (filtroAval.length)    q = q.in('avaliacao', filtroAval);
      if (filtroFormato.length) q = q.in('formato', filtroFormato);
      if (filtroStatus.length)  q = q.in('status_veiculacao', filtroStatus);
      return q;
    };

    // Eram duas páginas fixas de mil. Com 2.916 cards postados, 916 nunca
    // chegavam a esta tela — e é a tela onde se decide o que foi validado.
    const { linhas: crs } = await todasAsLinhas<CriativoPostado>((de, ate) => mkQuery().range(de, ate));
    if (!crs.length) { setCriativos([]); setLoading(false); return; }

    // Historico em chunks de 300 IDs para evitar URL muito longa
    const ids = crs.map(c => c.id);
    const CHUNK = 300;
    const histResults = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
        supabase.from('criativo_historico')
          .select('criativo_id,criado_em')
          .in('criativo_id', ids.slice(i * CHUNK, (i + 1) * CHUNK))
          .eq('campo_alterado', 'fase')
          .eq('valor_novo', 'postado')
          .order('criado_em', { ascending: true }),
      )
    );
    const hist = histResults.flatMap(r => r.data ?? []);

    /* O estado dos anúncios, em blocos pelo mesmo motivo do histórico: uma URL
       com 2.837 ids não passa. */
    const estadoResults = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
        supabase.from('vw_producao_estado_ads')
          .select('producao_id,estado,ultimo_gasto')
          .in('producao_id', ids.slice(i * CHUNK, (i + 1) * CHUNK)),
      ),
    );
    const estadoMap: Record<string, { estado: string; ultimo_gasto: string | null }> = {};
    for (const r of estadoResults) {
      for (const e of (r.data ?? []) as
           { producao_id: string; estado: string; ultimo_gasto: string | null }[]) {
        estadoMap[e.producao_id] = { estado: e.estado, ultimo_gasto: e.ultimo_gasto };
      }
    }

    const postMap: Record<string, string> = {};
    for (const h of hist) {
      if (!postMap[h.criativo_id]) postMap[h.criativo_id] = h.criado_em.slice(0, 10);
    }

    setCriativos(crs.map(c => {
      const data_postagem = postMap[c.id] ?? null;
      const raw = c as unknown as CriativoPostado;
      return {
        ...raw,
        data_postagem,
        data_ref: data_postagem ?? raw.data_inicio ?? null,
        estado_ads: estadoMap[c.id]?.estado ?? null,
        ultimo_gasto: estadoMap[c.id]?.ultimo_gasto ?? null,
      };
    }));
    setLoading(false);
  }, [filtroProjeto, filtroTipo, filtroEditor, filtroAval, filtroFormato, filtroStatus, mostrarInativos, projetosDaEmpresa]);

  useEffect(() => { loadOpcoes(); }, [loadOpcoes]);
  useEffect(() => { load(); }, [load]);

  const handleChange = async (
    c: CriativoPostado,
    campo: 'status_veiculacao' | 'avaliacao',
    valor: string | null,
  ) => {
    setSaving(c.id + campo);
    const valorAnterior = c[campo];
    setCriativos(prev => prev.map(x => x.id === c.id ? { ...x, [campo]: valor } : x));
    try {
      const { error } = await supabase.from('producoes').update({ [campo]: valor }).eq('id', c.id);
      if (error) throw error;
      await supabase.from('criativo_historico').insert({
        criativo_id:    c.id,
        usuario_id:     userId,
        tipo_alteracao: 'campo',
        campo_alterado: campo,
        valor_anterior: valorAnterior ?? null,
        valor_novo:     valor ?? null,
      });
    } catch {
      setCriativos(prev => prev.map(x => x.id === c.id ? { ...x, [campo]: valorAnterior } : x));
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  /* A lista com TODOS os filtros menos o de contradição. É sobre ela que o
     contador do botão é medido — um contador tem de prometer o que entrega.

     Na primeira versão eu contei sobre a lista inteira: o botão dizia "(60)" e
     clicar não mostrava nada, porque os contraditórios são de agosto e o
     período aberto era setembro. */
  const baseCriativos = useMemo(() => {
    const buscaLower = busca.toLowerCase();
    return criativos.filter(c => {
      if (!c.data_ref) return false; // sem data de início nem de postagem: ocultar
      if (dateStart && c.data_ref < dateStart) return false;
      if (dateEnd   && c.data_ref > dateEnd)   return false;
      if (somentePendentes && !isPendente(c)) return false;
      if (buscaLower && !c.nome.toLowerCase().includes(buscaLower)) return false;
      if (filtroFunil.length && !filtroFunil.some(f => (c.funil_ids ?? []).includes(f))) return false;
      return true;
    });
  }, [criativos, dateStart, dateEnd, somentePendentes, busca, filtroFunil]);

  const qtdContradicao = useMemo(
    () => baseCriativos.filter(c => contradiz(c.status_veiculacao, c.estado_ads)).length,
    [baseCriativos],
  );

  const displayCriativos = useMemo(
    () => somenteContradicao
      ? baseCriativos.filter(c => contradiz(c.status_veiculacao, c.estado_ads))
      : baseCriativos,
    [baseCriativos, somenteContradicao],
  );

  const total        = displayCriativos.length;
  const pendentes    = displayCriativos.filter(isPendente).length;
  const validados    = displayCriativos.filter(c => c.avaliacao === 'Validado').length;
  const naoValidados = displayCriativos.filter(c => c.avaliacao === 'Não validado').length;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        {/* Linha 1 — filtros de categoria */}
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
            label="Tipo"
            options={[
              { id: 'criativo', nome: 'Criativo' },
              { id: 'vsl',      nome: 'VSL' },
              { id: 'aula',     nome: 'Aula' },
            ]}
            value={filtroTipo}
            onChange={setFiltroTipo}
            width="w-32"
          />
          <MultiFilter
            label="Todos os projetos"
            options={projetos}
            value={filtroProjeto}
            onChange={setFiltroProjeto}
            width="w-44"
          />
          <MultiFilter
            label="Editor"
            options={perfis.map(p => ({ id: p.id, nome: p.nome }))}
            value={filtroEditor}
            onChange={setFiltroEditor}
            width="w-40"
          />
          <MultiFilter
            label="Avaliação"
            options={opAvaliacao.map(a => ({ id: a, nome: a }))}
            value={filtroAval}
            onChange={setFiltroAval}
            width="w-36"
          />
          {opFormato.length > 0 && (
            <MultiFilter
              label="Formato"
              options={opFormato.map(a => ({ id: a, nome: a }))}
              value={filtroFormato}
              onChange={setFiltroFormato}
              width="w-36"
            />
          )}
          <MultiFilter
            label="Status"
            options={opStatus.map(a => ({ id: a, nome: a }))}
            value={filtroStatus}
            onChange={setFiltroStatus}
            width="w-36"
          />
          {funis.length > 0 && (
            <MultiFilter
              label="Funil"
              options={funis.map(f => ({ id: f.id, nome: f.nome }))}
              value={filtroFunil}
              onChange={setFiltroFunil}
              width="w-44"
            />
          )}
        </div>

        {/* Linha 2 — período + toggles */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md border border-border overflow-hidden">
            {(['last', 'this', 'custom'] as const).map((p, i) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={cn(
                  'h-8 px-3 text-xs transition-colors whitespace-nowrap',
                  i > 0 && 'border-l border-border',
                  preset === p
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                {p === 'last' ? 'Mês passado' : p === 'this' ? 'Este mês' : 'Personalizado'}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <button className={cn(
                  'h-8 px-3 rounded-md border text-xs flex items-center gap-1.5 transition-colors',
                  dateRange?.from
                    ? 'border-primary text-foreground bg-primary/5'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {rangeLabel}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={r => { setDateRange(r); if (r?.from && r?.to) setCalOpen(false); }}
                  numberOfMonths={2}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>
          )}

          <button
            onClick={() => setSomentePendentes(v => !v)}
            className={cn(
              'h-8 px-3 rounded-md border text-xs transition-colors',
              somentePendentes
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            Só pendentes
          </button>
          {/* Ao lado de "Só pendentes" porque é a mesma classe de pergunta:
              "o que eu preciso olhar agora?". O contador vai no rótulo — um
              filtro que pode devolver zero deve dizer isso ANTES do clique. */}
          <button
            onClick={() => setSomenteContradicao(v => !v)}
            title="Cards em que o status marcado contradiz o que a Meta diz dos anúncios"
            className={cn(
              'h-8 px-3 rounded-md border text-xs transition-colors',
              somenteContradicao
                ? 'bg-warning/10 border-warning/30 text-warning'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            ⚠ Só contraditórios{qtdContradicao > 0 && ` (${qtdContradicao})`}
          </button>
          <button
            onClick={() => setMostrarInativos(v => !v)}
            className={cn(
              'h-8 px-3 rounded-md border text-xs transition-colors',
              mostrarInativos
                ? 'bg-muted border-border text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            {mostrarInativos ? 'Ocultar arquivados' : 'Ver arquivados'}
          </button>
        </div>
      </div>

      <TabelaDoCrivo />

      {/* Resumo pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">
          {total} criativos
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          {pendentes} pendentes
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          {validados} validados
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          {naoValidados} não validados
        </span>
        {total > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">
            {Math.round((validados / total) * 100)}% taxa de validação
          </span>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />Carregando...
        </div>
      ) : displayCriativos.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          Nenhum criativo encontrado.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          {/* A coluna do atalho só existe para quem pode pedir: uma coluna
              vazia em toda linha para o resto da equipe é largura gasta a
              dizer "isto não é para você". */}
          <div
            style={grade(podePedir)}
            className="grid gap-3 px-4 py-2 bg-muted/30 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <span>Nome</span>
            <span>Projeto</span>
            <span>Editor</span>
            <span>Status</span>
            <span>Avaliação</span>
            {podePedir && <span className="text-right" title="Pedir variação">Var.</span>}
          </div>

          {displayCriativos.map(c => {
            const pendente = isPendente(c);
            return (
              /*
                A linha virou um envelope: a grade por dentro, a tira de números
                por BAIXO dela, na largura inteira.

                A primeira versão pôs a tira dentro da coluna do nome — que é
                `1fr` e estreita. Os oito números empilharam um por linha e cada
                AD virou um bloco de nove linhas: o mesmo muro de texto que a
                fila da Esteira tinha. Número lado a lado se compara; número
                empilhado se lê um por um.
              */
              <div
                key={c.id}
                className={cn(
                  'border-b border-border/50 last:border-0 text-sm transition-colors',
                  pendente ? 'bg-amber-500/5' : '',
                )}
              >
              <div style={grade(podePedir)} className="grid gap-3 px-4 pt-2.5 items-center">
                <div className="min-w-0">
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className="font-medium truncate text-foreground hover:text-primary hover:underline text-left w-full"
                  >
                    {c.nome}
                  </button>
                  {c.data_ref && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {c.data_postagem ? 'Postado' : 'Início'}{' '}
                      {new Date(c.data_ref + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </p>
                  )}

                </div>

                <span className="text-xs text-muted-foreground truncate">
                  {c.projeto?.nome ?? '—'}
                </span>

                <span className="text-xs text-muted-foreground truncate">
                  {c.responsavel?.nome ?? '—'}
                </span>

                <div className="relative">
                  <select
                    value={c.status_veiculacao ?? ''}
                    onChange={e => handleChange(c, 'status_veiculacao', e.target.value || null)}
                    disabled={saving === c.id + 'status_veiculacao'}
                    className={cn(
                      'w-full text-xs rounded-md border px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring transition-colors appearance-none cursor-pointer',
                      c.status_veiculacao ? STATUS_COR[c.status_veiculacao] ?? 'border-border' : 'border-border text-muted-foreground',
                    )}
                  >
                    <option value="">—</option>
                    {opStatus.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {saving === c.id + 'status_veiculacao' && (
                    <div className="absolute inset-y-0 right-1.5 flex items-center pointer-events-none">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {/* O fato, embaixo da marcação. Quando os dois se contradizem,
                      o aviso é o que importa — e não o rótulo. */}
                  {c.estado_ads && ESTADO_ADS[c.estado_ads] && (
                    <div
                      className={cn(
                        'mt-0.5 truncate text-[10px]',
                        contradiz(c.status_veiculacao, c.estado_ads)
                          ? 'text-warning'
                          : ESTADO_ADS[c.estado_ads].cor,
                      )}
                      title={
                        contradiz(c.status_veiculacao, c.estado_ads)
                          ? `Você marcou "${c.status_veiculacao}", mas a Meta diz ${ESTADO_ADS[c.estado_ads].rotulo}`
                          : ESTADO_ADS[c.estado_ads].titulo
                      }
                    >
                      {contradiz(c.status_veiculacao, c.estado_ads) && '⚠ '}
                      {ESTADO_ADS[c.estado_ads].rotulo}
                      {/* A data do ULTIMO GASTO, que responde "quando parou?".
                          Sem ela, "parado" nao diz se foi ontem ou em junho —
                          e essa diferenca muda o que fazer com o criativo. */}
                      {c.ultimo_gasto
                        ? ` · ${diaCurto(c.ultimo_gasto)}`
                        : c.estado_ads !== 'sem_anuncio' && ' · nunca gastou'}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <select
                    value={c.avaliacao ?? ''}
                    onChange={e => handleChange(c, 'avaliacao', e.target.value || null)}
                    disabled={saving === c.id + 'avaliacao'}
                    className={cn(
                      'w-full text-xs rounded-md border px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring transition-colors appearance-none cursor-pointer',
                      c.avaliacao ? AVAL_COR[c.avaliacao] ?? 'border-border' : 'border-border text-muted-foreground',
                    )}
                  >
                    <option value="">—</option>
                    {opAvaliacao.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {saving === c.id + 'avaliacao' && (
                    <div className="absolute inset-y-0 right-1.5 flex items-center pointer-events-none">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>

                {podePedir && (
                  <div className="flex justify-end">
                    {comPedido.has(c.id) ? (
                      /* Já pedido: o estado é dito, e o botão não volta a
                         aparecer. Dois pedidos para o mesmo criativo virariam
                         duas entradas na esteira do Copy. */
                      <span
                        title="Variação já pedida — está na esteira do Copy"
                        className="grid h-6 w-6 place-items-center rounded-md border border-success/30 bg-success/10 text-success"
                      >
                        <GitBranch className="h-3 w-3" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPedindo({ id: c.id, nome: c.nome })}
                        title="Pedir variação deste criativo"
                        aria-label="Pedir variação"
                        className="grid h-6 w-6 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <GitBranch className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/*
                Os números embaixo do AD, que é onde a decisão acontece.

                Quem marca "Validado" ou "Não validado" precisava abrir o Meta
                Ads noutra aba, achar o anúncio e voltar — e na prática avaliava
                de memória.
              */}
              <TiraDeMetricas m={metricas.get(c.id)} className="px-4 pb-2.5 pt-1" />
              </div>
            );
          })}
        </div>
      )}

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={() => { void load(); void carregarPedidos(); }}
        nivel="socio"
        userId={userId}
        funis={funis}
        perfis={perfis}
      />

      {/* O mesmo modal que o card usa. Nada foi reescrito: o atalho muda de
          onde a ação é alcançada, não o que ela faz nem o que ela pergunta. */}
      {pedindo && (
        <PedidoVariacaoModal
          open
          producaoId={pedindo.id}
          nome={pedindo.nome}
          onClose={() => setPedindo(null)}
          onSalvo={() => { setPedindo(null); void carregarPedidos(); }}
        />
      )}
    </div>
  );
}
