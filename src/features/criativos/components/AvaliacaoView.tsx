import { todasAsLinhas } from '@/lib/supabase';
import { paraYmd } from '@/lib/datas';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Search, CalendarIcon, GitBranch, Check } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/formatters';
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
import { situacaoDe, rodaComoAnuncio, marcacaoQueOMetaSugere } from '@/features/ads/situacao';
/* A régua saiu desta tela e foi para o banco (migração 20261009a). O que sobra
   aqui é o desenho; os números e a prosa vêm de `vw_crivo_vigente`. */
import { TabelaDoCrivo, useCrivo } from '@/features/criativos/crivo';
import {
  aRevisar, corDaAvaliacao, origemDe, reguaDiscorda, type Sugestao,
} from '@/features/criativos/avaliacao';
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
  /* Quem pôs o valor em `avaliacao`: nulo (a régua ainda não olhou), 'humano',
     'automatico' ou 'fora_do_escopo'. Ver `@/features/criativos/avaliacao`. */
  avaliacao_origem: string | null;
  responsavel_id: string | null;
  projeto_id: string | null;
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

/**
 * Este card espera o olhar dela?
 *
 * ── O que isto substituiu, e por que precisava sair ───────────────────────
 *
 * Era `isPendente`: `!avaliacao || avaliacao === 'Sem dados'`, mais a exigência
 * de a marcação ser 'Rodando' ou vazia. Dois defeitos, e o segundo só apareceu
 * quando a régua passou a escrever:
 *
 * 1. Ele ADIVINHAVA pendência a partir do valor. "Sem dados" é veredito
 *    legítimo — criativo que não gastou um ticket não tem o que ser julgado —, e
 *    contá-lo como pendência faria a pílula crescer justamente quando a
 *    automação estivesse funcionando. Dos 3.004 criativos postados, 2.669 caem
 *    em "Sem dados" pela régua: a fila teria nascido com dois mil e seiscentos.
 * 2. Ele misturava marcação com avaliação. `status_veiculacao` é a intenção dela
 *    sobre a veiculação e não diz nada sobre a avaliação ter sido revisada.
 *
 * Agora a pergunta é de PROCEDÊNCIA, que é a única coisa que responde "alguém
 * olhou isto?" sem adivinhar — e é filtrável no servidor, o que importa numa
 * lista de três mil linhas.
 */
function precisaRevisar(c: CriativoPostado): boolean {
  return aRevisar(c.avaliacao_origem);
}

const STATUS_COR: Record<string, string> = {
  'Rodando':   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Pausado':   'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'Encerrado': 'bg-muted/60 text-muted-foreground border-border',
  'Bloqueado': 'bg-red-500/10 text-red-400 border-red-500/20',
  'Arquivado': 'bg-muted/40 text-muted-foreground/60 border-border/50',
};


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
 * O RÓTULO NÃO MORA MAIS AQUI
 *
 * Havia um `ESTADO_ADS` neste arquivo com vocabulário próprio — ativo, pausado,
 * reprovado, com_problema —, e `vw_meta_status` já classificava os mesmos
 * anúncios com outro: rodando, parado, barrado_pelo_pai. Dois mapas para a
 * mesma pergunta, a primeira armadilha, e eles já divergiam: 109 anúncios
 * `ADSET_PAUSED` eram chamados de "parado" aqui, escondendo o único grupo que
 * pede ação — alguém LIGOU o anúncio e o conjunto acima está desligado.
 *
 * Agora `vw_producao_estado_ads` devolve o mesmo vocabulário da view, e o rótulo
 * sai de `situacaoDe` em `@/features/ads/situacao` — um mapa só, servindo a tela
 * do Meta Ads e esta. Na prática, 87 cards saíram de "parado" para "Pai pausado".
 */

/** Data curta para caber na célula: "05/09". Ano só quando não é o atual. */
function diaCurto(iso: string): string {
  const [a, m, d] = iso.split('-');
  const esteAno = String(new Date().getFullYear());
  return a === esteAno ? `${d}/${m}` : `${d}/${m}/${a.slice(2)}`;
}

/**
 * A marcação dela contradiz o Meta? É o caso que custa dinheiro.
 *
 * `parado_recente` entrou em 24/09/2026 junto com o selo âmbar: é a mesma
 * afirmação que `parado` — alguém desligou —, só que recente. Fora da lista,
 * a contradição pararia de ser acusada justamente nos casos mais quentes, que
 * é o oposto do que esta tela existe para fazer.
 *
 * `ALGUEM_DESLIGOU` existe porque o vocabulário novo separa o que o antigo
 * juntava: "parado" é o anúncio desligado e "barrado_pelo_pai" é o conjunto
 * desligado por cima dele. Os dois contradizem quem marcou "Rodando", e omitir
 * o segundo perderia 5 dos 8 casos.
 *
 * Fora da lista de propósito: `ativo_sem_entregar` e `em_analise`. Nesses dois o
 * anúncio ESTÁ ligado — quem marcou "Rodando" não errou, a entrega é que não
 * saiu. Acusar contradição ali mandaria a pessoa desmarcar o que está certo.
 */
const ALGUEM_DESLIGOU = ['parado', 'parado_recente', 'barrado_pelo_pai', 'sem_anuncio'];

function contradiz(marcado: string | null, estado: string | null): boolean {
  if (!marcado || !estado) return false;
  if (marcado === 'Rodando')   return ALGUEM_DESLIGOU.includes(estado);
  if (marcado === 'Encerrado') return estado === 'rodando';
  if (marcado === 'Pausado')   return estado === 'rodando';
  return false;
}


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
  /* Sem fallback literal: a lista antiga tinha três valores e não tinha
     "Escalado", que existe na tabela e em 19 cards. Enquanto o campo era só
     digitado o preço era um selo sem cor; agora a régua ESCREVE o nível, e um
     fallback incompleto some com a opção justo quando a máquina acabou de
     usá-la. Lista vazia faz a tela mostrar vazio, que é visível. */
  const [opAvaliacao, setOpAvaliacao] = useState<string[]>([]);
  const [opFormato, setOpFormato]     = useState<string[]>([]);
  /* O que cada opção quer dizer, de `criativo_campos_opcoes.significa`. Vale
     para marcação e avaliação juntas: os valores não colidem entre os dois
     campos, e um mapa só evita escolher qual consultar em cada `title`. */
  const [significado, setSignificado] = useState<Map<string, string>>(new Map());
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
  const [pedindo, setPedindo]           = useState<{ id: string; nome: string; tipo: string } | null>(null);
  const [somenteARevisar, setSomenteARevisar] = useState(false);
  /* O que a régua pensa de cada card, por `producao_id`. Separado de
     `criativos` de propósito: a sugestão é opinião da máquina e o valor
     gravado é o que vale — juntar os dois num objeto só faria alguém mostrar
     um no lugar do outro. */
  const [sugestoes, setSugestoes] = useState<Map<string, Sugestao>>(new Map());
  /* Os cards que ELA aprovou e cujos anúncios estão morrendo nos últimos 7
     dias. Vem de `vw_criativo_virou_contra`, que não escreve nada. */
  const [virouContra, setVirouContra] = useState<
    { producao_id: string; nome: string; avaliacao: string; gasto_7d: number;
      pior_roas: number; melhor_roas_antes: number }[]
  >([]);
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

  /* O aviso dos cards que ela validou e que viraram contra. Consulta própria e
     sem filtro de período: a pergunta é "o que está sangrando AGORA", e um
     filtro de mês esconderia justamente o card que começou a sangrar ontem.

     Em `useCallback` para o drawer poder recarregá-lo: quando ela corrige a
     avaliação de um card listado aqui, ele tem de sair do aviso na hora. Um
     aviso que continua acusando depois de resolvido é a forma mais rápida de
     o olho parar de ver o aviso. */
  const carregarVirouContra = useCallback(async () => {
    const { data } = await supabase
      .from('vw_criativo_virou_contra')
      .select('producao_id,nome,avaliacao,gasto_7d,pior_roas,melhor_roas_antes')
      .order('gasto_7d', { ascending: false });
    setVirouContra((data ?? []) as typeof virouContra);
  }, []);

  useEffect(() => { void carregarVirouContra(); }, [carregarVirouContra]);

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
    /* `significa` vem junto: o sentido de cada palavra mora na tabela do
       vocabulário desde 20261010b, e não num comentário de componente.
       "Pausado" e "Encerrado" descrevem o mesmo fato — o anúncio não está no
       ar — e pedem ações opostas; sem a definição à mão, cada pessoa usa a que
       supõe, e foi assim que 2.119 cards foram para "Encerrado" contra 39 em
       "Pausado". */
    const [{ data: opS }, { data: opA }, { data: opF }, pj, { data: pf }, fs] = await Promise.all([
      supabase.from('criativo_campos_opcoes').select('valor,significa').eq('campo', 'status_veiculacao').order('ordem'),
      supabase.from('criativo_campos_opcoes').select('valor,significa').eq('campo', 'avaliacao').order('ordem'),
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
    setSignificado(new Map([
      ...(opS ?? []).map(d => [d.valor as string, (d.significa as string | null) ?? '']),
      ...(opA ?? []).map(d => [d.valor as string, (d.significa as string | null) ?? '']),
    ] as [string, string][]));
    setProjetos(pj);
    setPerfis((pf ?? []) as Perfil[]);
    setFunis(fs as Funil[]);
  }, []);

  /*
    Os níveis que APROVAM, lidos da régua vigente.

    Servem para uma coisa só nesta tela, e ela é a definição que ela deu em
    09/10/2026: "Pausado é quando o anúncio está com boa performance mas não
    está rodando, e devemos voltar a rodar". Saber se o card vai bem é o que
    separa um parado que é PENDÊNCIA de um parado que ACABOU.

    Vem da tabela e não de `['Validado','Escalado']` escrito aqui: um nível novo
    no crivo amanhã já entra nesta regra sozinho.
  */
  const { niveis: niveisDoCrivo } = useCrivo();
  const niveisQueAprovam = useMemo(
    () => new Set(niveisDoCrivo.map(n => n.nivel)),
    [niveisDoCrivo],
  );

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
        .select('id,nome,tipo,fase,formato,data_inicio,status_veiculacao,avaliacao,avaliacao_origem,responsavel_id,projeto_id,responsavel:perfis!responsavel_id(id,nome),projeto:ofertas_editores!projeto_id(id,nome)')
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

    /* O veredito da régua, nos mesmos blocos e pelo mesmo motivo.

       Ele NÃO é o valor da avaliação: é o que a régua pensa, que pode divergir
       do que está gravado. Para card 'automatico' os dois coincidem; para card
       'humano' a divergência é exatamente o que a tela precisa mostrar, sem
       mexer em nada. */
    const sugResults = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
        supabase.from('avaliacao_sugerida')
          .select('producao_id,sugestao,motivo,no_escopo,decidido_em')
          .in('producao_id', ids.slice(i * CHUNK, (i + 1) * CHUNK)),
      ),
    );
    const sugMap = new Map<string, Sugestao>();
    for (const r of sugResults) {
      for (const s of (r.data ?? []) as Sugestao[]) sugMap.set(s.producao_id, s);
    }
    setSugestoes(sugMap);

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
    const origemAnterior = c.avaliacao_origem;
    /* Mexer na avaliação é confirmá-la: o valor passa a ser dela, e a régua
       para de poder sobrescrever. A marcação não carrega procedência porque
       ela nunca foi derivada — sempre foi intenção. */
    const vira = campo === 'avaliacao'
      ? { avaliacao: valor, avaliacao_origem: 'humano' as const }
      : { status_veiculacao: valor };
    setCriativos(prev => prev.map(x => x.id === c.id ? { ...x, ...vira } : x));
    try {
      const { error } = await supabase.from('producoes').update(vira).eq('id', c.id);
      if (error) throw error;
      await supabase.from('criativo_historico').insert({
        criativo_id:    c.id,
        usuario_id:     userId,
        tipo_alteracao: 'campo',
        campo_alterado: campo,
        valor_anterior: valorAnterior ?? null,
        valor_novo:     valor ?? null,
      });
      /* Trocar a avaliação pode tirar o card do aviso lá de cima — ele lista só
         quem está em nível de aprovação. Recarregar aqui é o que faz o bloco
         sumir no mesmo gesto em que o problema foi resolvido. */
      if (campo === 'avaliacao') void carregarVirouContra();
    } catch {
      setCriativos(prev => prev.map(x => x.id === c.id
        ? { ...x, [campo]: valorAnterior, avaliacao_origem: origemAnterior } : x));
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  /**
   * "Está certo" — confirma a avaliação automática sem mudar o valor.
   *
   * Isto não é o mesmo que trocar o valor por ele mesmo: o que muda é a
   * PROCEDÊNCIA, e é ela que tira o card da fila e impede a régua de reescrever
   * na passada seguinte. Sem este botão, concordar com a máquina exigiria
   * selecionar o mesmo valor no `select` — um gesto que não existe.
   *
   * O histórico registra `avaliacao_origem` como campo alterado, e não
   * `avaliacao`: o valor não mudou, e inventar uma linha dizendo que mudou
   * poluiria a prova de toque humano que `20261009b` usou para separar os 393
   * julgamentos reais da carga.
   */
  const confirmar = async (c: CriativoPostado) => {
    if (!c.avaliacao) return;
    setSaving(c.id + 'avaliacao');
    const origemAnterior = c.avaliacao_origem;
    setCriativos(prev => prev.map(x => x.id === c.id ? { ...x, avaliacao_origem: 'humano' } : x));
    try {
      const { error } = await supabase.from('producoes')
        .update({ avaliacao_origem: 'humano' }).eq('id', c.id);
      if (error) throw error;
      await supabase.from('criativo_historico').insert({
        criativo_id:    c.id,
        usuario_id:     userId,
        tipo_alteracao: 'campo',
        campo_alterado: 'avaliacao_origem',
        valor_anterior: origemAnterior ?? null,
        valor_novo:     'humano',
      });
    } catch {
      setCriativos(prev => prev.map(x => x.id === c.id ? { ...x, avaliacao_origem: origemAnterior } : x));
      toast({ title: 'Erro ao confirmar', variant: 'destructive' });
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
      if (somenteARevisar && !precisaRevisar(c)) return false;
      if (buscaLower && !c.nome.toLowerCase().includes(buscaLower)) return false;
      return true;
    });
  }, [criativos, dateStart, dateEnd, somenteARevisar, busca]);

  const qtdContradicao = useMemo(
    () => baseCriativos.filter(c => contradiz(c.status_veiculacao, c.estado_ads)).length,
    [baseCriativos],
  );

  const displayCriativos = useMemo(() => {
    const lista = somenteContradicao
      ? baseCriativos.filter(c => contradiz(c.status_veiculacao, c.estado_ads))
      : baseCriativos;

    /* Na fila "a revisar", o DINHEIRO manda na ordem.

       A ordem alfabética serve para procurar um AD pelo nome, que é o que a
       lista completa faz. Mas revisar é outra tarefa: medido na base histórica,
       os cards em que a régua se recusa a decidir carregam R$ 264 mil — 64% de
       toda a verba — e em ordem de nome eles ficam espalhados entre três mil
       linhas. Quem revisa de cima para baixo tem de encontrar primeiro o que
       custa mais. */
    if (!somenteARevisar) return lista;
    return [...lista].sort((a, b) =>
      (metricas.get(b.id)?.investimento ?? 0) - (metricas.get(a.id)?.investimento ?? 0));
  }, [baseCriativos, somenteContradicao, somenteARevisar, metricas]);

  const total        = displayCriativos.length;
  const qtdARevisar  = displayCriativos.filter(precisaRevisar).length;
  const validados    = displayCriativos.filter(c => c.avaliacao === 'Validado').length;
  const escalados    = displayCriativos.filter(c => c.avaliacao === 'Escalado').length;
  const naoValidados = displayCriativos.filter(c => c.avaliacao === 'Não validado').length;
  /* Quantas vezes a régua discorda de um valor que ELA confirmou. Não é alarme
     — inclui o sentido bom, em que ela reprovou e os números passaram a
     aprovar —, e por isso vira chip e não bloco âmbar. */
  const qtdDiscorda  = displayCriativos.filter(
    c => reguaDiscorda(c.avaliacao, c.avaliacao_origem, sugestoes.get(c.id))).length;

  /*
    A TAXA mede anúncio; a LISTA mostra tudo que precisa ser avaliado.

    São duas coisas, e antes eram uma: `validados / total` usava como
    denominador a fila inteira, que inclui as VSLs e a aula em fase 'postado'.
    E o crivo logo acima é régua de MÍDIA: ROAS é receita sobre verba, e VSL
    não gasta verba. Dezenove delas ainda assim entravam no numerador.

    A fila continua com todas: VSL segue sendo avaliada, por decisão dela em
    21/09/2026 — o que muda é que o julgamento da VSL não se mistura mais com a
    taxa do anúncio. Ver `rodaComoAnuncio`.
  */
  const daTaxa        = displayCriativos.filter(c => rodaComoAnuncio(c.tipo));
  const validadosAnun = daTaxa.filter(c => c.avaliacao === 'Validado').length;
  const foraDaTaxa    = total - daTaxa.length;

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
          {/* "Marcação" e não "Status" pelo mesmo motivo do cabeçalho: o filtro
              peneira pelo que alguém digitou, não pelo que a Meta diz. */}
          <MultiFilter
            label="Marcação"
            options={opStatus.map(a => ({ id: a, nome: a }))}
            value={filtroStatus}
            onChange={setFiltroStatus}
            width="w-36"
          />
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

          {/* Era "Só pendentes", e pendência era adivinhada do valor. Agora é
              procedência: quem a régua escreveu e ninguém confirmou, mais quem
              ela ainda não olhou. Ordena por verba quando ligado. */}
          <button
            onClick={() => setSomenteARevisar(v => !v)}
            title="Avaliação que a régua escreveu e ninguém confirmou ainda. Ligado, a lista vem em ordem de verba."
            className={cn(
              'h-8 px-3 rounded-md border text-xs transition-colors',
              somenteARevisar
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            Só a revisar{qtdARevisar > 0 && ` (${qtdARevisar})`}
          </button>
          {/* Ao lado de "Só a revisar" porque é a mesma classe de pergunta:
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

      {/*
        O aviso dos cards que ELA aprovou e que viraram contra.

        Âmbar e não vermelho: pelo CLAUDE.md o vermelho é a marca e o que se
        PERDE, e aqui nada se perdeu ainda — está escorrendo. E ele diz
        explicitamente que nada foi alterado, porque a primeira pergunta de
        quem vê isto é "o sistema mexeu no que eu decidi?".

        Vem de `vw_criativo_virou_contra`, que compara os últimos 7 dias contra
        os 7 anteriores. A régua da tela julga a VIDA INTEIRA do anúncio, então
        ela continua aprovando um card de ROAS acumulado bom enquanto a semana
        desaba — este bloco existe exatamente para cobrir esse ponto cego.
      */}
      {virouContra.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-xs font-medium text-warning">
            {virouContra.length === 1
              ? '1 criativo que você aprovou deixou de se pagar'
              : `${virouContra.length} criativos que você aprovou deixaram de se pagar`}
            <span className="font-normal text-muted-foreground"> · nada foi alterado</span>
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {virouContra.slice(0, 5).map(v => (
              <li key={v.producao_id} className="text-[11px] text-muted-foreground">
                {/* Clicável, e abrindo o MESMO drawer da lista.

                    O aviso diz qual card está sangrando; sem o caminho para
                    ele, a pessoa tem de copiar o nome, voltar, limpar o filtro
                    de período (o aviso não tem período, a lista tem) e buscar.
                    Quatro passos entre ver o problema e poder agir nele — e o
                    card pode nem estar na lista filtrada, porque o aviso olha
                    os últimos 7 dias e a lista olha o mês escolhido. */}
                <button
                  onClick={() => setSelectedId(v.producao_id)}
                  className="text-foreground transition-colors hover:text-primary hover:underline"
                >
                  {v.nome}
                </button>
                {' '}está “{v.avaliacao}” e nos últimos 7 dias gastou{' '}
                <span className="tabular-nums text-foreground">{formatCurrency(v.gasto_7d)}</span>
                {' '}com ROAS{' '}
                <span className="tabular-nums text-warning">{formatNumber(v.pior_roas)}</span>
                {v.melhor_roas_antes > 0 && (
                  <> (era <span className="tabular-nums">{formatNumber(v.melhor_roas_antes)}</span>)</>
                )}
              </li>
            ))}
          </ul>
          {virouContra.length > 5 && (
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              e outros {virouContra.length - 5}.
            </p>
          )}
        </div>
      )}

      {/* Resumo pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">
          {/* "peças" quando a fila tem VSL ou aula: chamá-las de criativo é o
              mesmo engano que punha as duas na taxa. */}
          {total} {foraDaTaxa > 0 ? 'peças' : 'criativos'}
        </span>
        {/* Azul e não âmbar: "a revisar" é fila, não problema. Âmbar e vermelho
            ficam para o que custa dinheiro — o bloco acima e os contraditórios. */}
        <span
          className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
          title="Avaliação automática que ninguém confirmou, mais os cards que a régua ainda não olhou."
        >
          {qtdARevisar} a revisar
        </span>
        {qtdDiscorda > 0 && (
          <span
            className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border"
            title="Cards que você confirmou e em que a régua chegaria a outro veredito. Nada foi alterado."
          >
            {qtdDiscorda} com régua discordando
          </span>
        )}
        {escalados > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
            {escalados} escalados
          </span>
        )}
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          {validados} validados
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          {naoValidados} não validados
        </span>
        {daTaxa.length > 0 && (
          <span
            className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border"
            title={foraDaTaxa > 0
              ? `Sobre ${daTaxa.length} criativos. ${foraDaTaxa} VSL/aula ficam de fora: o crivo mede ROAS, e elas não gastam mídia.`
              : undefined}
          >
            {Math.round((validadosAnun / daTaxa.length) * 100)}% taxa de validação
            {foraDaTaxa > 0 && (
              <span className="text-muted-foreground/60"> · dos {daTaxa.length} criativos</span>
            )}
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
            {/*
              Era "Status", e o nome é metade do problema: ao lado de ROAS e CPA
              reais, "Status" se lê como fato. Ele é o que ALGUÉM MARCOU, e em
              16/09/2026 errava em 9 dos 28 cards marcados "Pausado" que tinham
              anúncio no ar. O fato é a linha de baixo, derivada da Meta.
            */}
            <span title="O que você marcou. O que a Meta diz aparece logo abaixo de cada marcação.">
              Marcação
            </span>
            <span>Avaliação</span>
            {podePedir && <span className="text-right" title="Pedir variação">Var.</span>}
          </div>

          {displayCriativos.map(c => {
            const pendente = precisaRevisar(c);
            const sug = sugestoes.get(c.id);
            const discorda = reguaDiscorda(c.avaliacao, c.avaliacao_origem, sug);
            const proc = origemDe(c.avaliacao_origem);
            /*
              A marcação que o fato SUGERE, calculada aqui e aplicada embaixo.

              Duas linhas separadas, e não uma expressão dentro do `onClick`,
              por causa de `status-veiculacao-e-intencao.test.ts`: ele reprova
              qualquer literal do vocabulário da Meta a menos de três linhas de
              uma menção a `status_veiculacao`. Os literais ficam todos em
              `marcacaoQueOMetaSugere`, num arquivo que não cita a marcação —
              a separação é a própria regra, escrita como estrutura.

              E o valor só vira botão se ESTIVER nas opções vindas de
              `criativo_campos_opcoes`: renomear o nível no banco faz o botão
              desaparecer, em vez de gravar algo que não é opção.

              `vaiBem` é o que faz um criativo aprovado que parou ser oferecido
              como "Pausado" (pendência de retomar) em vez de "Encerrado".
            */
            const vaiBem = !!c.avaliacao && niveisQueAprovam.has(c.avaliacao);
            const sugerida = marcacaoQueOMetaSugere(c.estado_ads, vaiBem);
            const podeCorrigirMarcacao = !!sugerida
              && sugerida !== c.status_veiculacao
              && opStatus.includes(sugerida)
              && contradiz(c.status_veiculacao, c.estado_ads);
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
                    /* A definição vem do banco. Sem ela, "Pausado" e
                       "Encerrado" parecem sinônimos — descrevem o mesmo fato e
                       pedem ações opostas. */
                    title={c.status_veiculacao ? significado.get(c.status_veiculacao) : undefined}
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
                  {c.estado_ads && situacaoDe(c.estado_ads) && (
                    <div
                      className={cn(
                        'mt-0.5 truncate text-[10px]',
                        contradiz(c.status_veiculacao, c.estado_ads)
                          ? 'text-warning'
                          : situacaoDe(c.estado_ads)!.texto,
                      )}
                      title={
                        contradiz(c.status_veiculacao, c.estado_ads)
                          ? `Você marcou "${c.status_veiculacao}", mas a Meta diz ${situacaoDe(c.estado_ads)!.rotulo}`
                          : situacaoDe(c.estado_ads)!.explica
                      }
                    >
                      {contradiz(c.status_veiculacao, c.estado_ads) && '⚠ '}
                      {situacaoDe(c.estado_ads)!.rotulo}
                      {/* A data do ULTIMO GASTO, que responde "quando parou?".
                          Sem ela, "parado" nao diz se foi ontem ou em junho —
                          e essa diferenca muda o que fazer com o criativo. */}
                      {c.ultimo_gasto
                        ? ` · ${diaCurto(c.ultimo_gasto)}`
                        : c.estado_ads !== 'sem_anuncio' && ' · nunca gastou'}
                    </div>
                  )}
                  {/*
                    O atalho de concordar com o fato, num clique.

                    A marcação continua sendo INTENÇÃO dela: nada aqui deriva
                    nada, o botão só oferece. A contradição continua sendo
                    acusada enquanto ela não decidir, e é ela que decide —
                    foi essa divergência que achou 24 cards dados por
                    encerrados gastando R$ 5.691,62 em sete dias.

                    Usa o `handleChange` que já existe: UPDATE, histórico,
                    rollback otimista e toast de erro, sem uma linha nova de
                    escrita.
                  */}
                  {podeCorrigirMarcacao && (
                    <button
                      type="button"
                      onClick={() => void handleChange(c, 'status_veiculacao', sugerida)}
                      disabled={saving === c.id + 'status_veiculacao'}
                      /* A dica muda com o que está sendo oferecido: "Pausado"
                         não é "o Meta discorda", é "este aqui ia bem e parou —
                         é para voltar". A definição sai da tabela. */
                      title={significado.get(sugerida!) ?? 'A Meta discorda da sua marcação.'}
                      className="mt-0.5 rounded border border-warning/40 px-1 text-[10px] text-warning transition-colors hover:bg-warning/10"
                    >
                      marcar {sugerida}
                    </button>
                  )}
                </div>

                <div className="relative">
                  <select
                    value={c.avaliacao ?? ''}
                    onChange={e => handleChange(c, 'avaliacao', e.target.value || null)}
                    disabled={saving === c.id + 'avaliacao'}
                    title={c.avaliacao ? significado.get(c.avaliacao) : undefined}
                    className={cn(
                      'w-full text-xs rounded-md border px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring transition-colors appearance-none cursor-pointer',
                      c.avaliacao ? corDaAvaliacao(c.avaliacao) : 'border-border text-muted-foreground',
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

                  {/*
                    A PROCEDÊNCIA, embaixo do valor — mesma estrutura da
                    marcação, que mostra o fato embaixo dela.

                    Sem isto o selo "Validado" de um card é indistinguível
                    entre três coisas muito diferentes: julgamento dela, régua
                    automática ainda não revisada, e herança da importação. Era
                    exatamente essa confusão que deixava 133 cards marcados
                    "Validado" sem nunca ter rodado anúncio.
                  */}
                  <div className="mt-0.5 flex items-center gap-1">
                    <span
                      className={cn('rounded border px-1 text-[10px] leading-4', proc.selo)}
                      title={proc.explica}
                    >
                      {proc.rotulo}
                    </span>

                    {/* Confirmar: muda a PROCEDÊNCIA, não o valor. É o que tira
                        o card da fila e impede a régua de reescrever. */}
                    {pendente && c.avaliacao && (
                      <button
                        type="button"
                        onClick={() => void confirmar(c)}
                        disabled={saving === c.id + 'avaliacao'}
                        title="Está certo — confirma esta avaliação e tira o card da fila"
                        aria-label="Confirmar avaliação"
                        className="grid h-4 w-4 place-items-center rounded border border-border text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-400"
                      >
                        <Check className="h-2.5 w-2.5" />
                      </button>
                    )}

                    {/*
                      A régua discorda do que ela confirmou. Aviso, nunca troca:
                      `fn_avaliar_criativos` tem guarda para não tocar valor
                      humano, e a tela respeita a mesma regra.

                      ── Duas correções de 10/10/2026, vistas na tela ────────

                      Era `régua: {sugestao}` numa coluna de 120px, e virava
                      "régua: N..." — um aviso truncado no ponto exato em que
                      ele ia dizer alguma coisa. Agora é um selo curto, e o
                      veredito vai inteiro na dica.

                      E a dica citava o `motivo` ("as duas fontes chegam ao
                      mesmo veredito"), que explica a CONFIANÇA da régua e não
                      a divergência com ela — lido ali, soava desconexo. O que
                      responde "por que a régua discorda de mim?" são os
                      números que ela usou. São os mesmos da tira de métricas
                      logo abaixo, e tê-los aqui evita cruzar a linha com o
                      olho para conferir.
                    */}
                    {discorda && (
                      <span
                        className="shrink-0 rounded border border-border bg-secondary px-1 text-[10px] leading-4 text-muted-foreground"
                        title={
                          `A régua diria “${sug!.sugestao}”, e você marcou “${c.avaliacao}”. `
                          + `Ela olhou: ${metricas.get(c.id)?.vendas ?? 0} vendas e ROAS `
                          + `${formatNumber(metricas.get(c.id)?.roas ?? 0)} pela Payt. `
                          + 'Nada foi alterado — a régua não sobrescreve o que você decidiu.'
                        }
                      >
                        ⚠ régua
                      </span>
                    )}

                    {/* E quando ela se recusou a decidir, o motivo fica à mão:
                        são os cards em que Payt e Meta discordam, e eles
                        carregam a maior parte da verba. */}
                    {!discorda && pendente && sug && sug.sugestao === null && (
                      <span
                        className="truncate text-[10px] text-muted-foreground/70"
                        title={sug.motivo}
                      >
                        fontes discordam
                      </span>
                    )}
                  </div>
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
                        onClick={() => setPedindo({ id: c.id, nome: c.nome, tipo: c.tipo })}
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
        onUpdate={() => { void load(); void carregarPedidos(); void carregarVirouContra(); }}
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
          tipoDaPeca={pedindo.tipo}
          onClose={() => setPedindo(null)}
          onSalvo={() => { setPedindo(null); void carregarPedidos(); }}
        />
      )}
    </div>
  );
}
