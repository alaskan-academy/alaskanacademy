import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { ChevronLeft, ChevronRight, AlertTriangle, Check, Lock } from 'lucide-react';
import { AnalisesNav } from '../components/AnalisesNav';
import { ListaMetricas, LinhaMetrica, LinhaTripla } from '../components/ListaMetricas';
import { TabelaItens } from '../components/TabelaItens';
import { ListaAcoes, AcoesFeitas, Acao } from '../components/ListaAcoes';
import { BlocoVsl, BlocoTsl } from '../components/BlocoPagina';
import { BlocoUpsell } from '../components/BlocoUpsell';
import { AvisoPlanilha } from '../components/AvisoPlanilha';
import { MetricasDoRev, distanciaDoMeta, baseAnteriorFragil, LIMITE_DISTANCIA } from '../metricas';
import { RetencaoVsl, buscarRetencao } from '../retencao';
import { exportarRodada, ResultadoEspelho } from '../exportar';
import { EstadoEspelho } from '../components/EstadoEspelho';
import {
  Janela, PERIODOS, PERSONALIZADO, janelaDeDias, janelaAnterior, diasDaJanela, formatarData,
} from '../periodo';

/**
 * A rodada de análise — a tela onde moram as 3 horas quinzenais.
 *
 * A tese do módulo é que aquelas 3 horas são DIGITAÇÃO, não análise: abrir a
 * planilha do funil, transcrever investimento, faturamento, vendas, conversões,
 * cada order bump. Quase tudo já está no banco.
 *
 * A ORDEM é a dela: Resultado e Ofertas primeiro — o veredito e o que foi
 * vendido —, e daí para baixo o funil na sequência em que ele acontece, clique
 * → página → checkout → venda. Uma métrica por linha, em coluna única, porque
 * a versão em cartões era "meio confusa, pouca leitura scan".
 *
 * A regra que decide se este módulo deu certo: se sobrar campo numérico para
 * preencher, ele falhou — voltou a ser a planilha.
 */

interface RevDaRodada {
  id: string;
  rev: string;
  projeto: string | null;
  vendas: number;
  metodo: string | null;
  vsl_id: string | null;
}

const pct  = (n: number) => `${n.toFixed(1)}%`;
const pct2 = (n: number) => `${n.toFixed(2)}%`;
const num2 = (n: number) => n.toFixed(2);

export default function AnalisesPage() {
  const { user } = useAuth();
  const confirmar = useConfirm();

  const [revs, setRevs]         = useState<RevDaRodada[]>([]);
  const [indice, setIndice]     = useState(0);
  const [preset, setPreset]     = useState<string>('14');
  const [janela, setJanela]     = useState<Janela>(() => janelaDeDias(14));
  const [metricas, setMetricas] = useState<MetricasDoRev | null>(null);
  const [retencao, setRetencao] = useState<RetencaoVsl | null>(null);
  const [retencaoAntes, setRetencaoAntes] = useState<RetencaoVsl | null>(null);
  const [carregando, setCarregando]     = useState(true);
  const [buscandoMetricas, setBuscando] = useState(false);

  const [analiseId, setAnaliseId]   = useState<string | null>(null);
  const [dataRodada, setDataRodada] = useState<string | null>(null);
  const [leitura, setLeitura]       = useState('');
  const [lidos, setLidos]           = useState<Record<string, string>>({});
  /**
   * O que foi digitado e ainda NÃO foi gravado, por REV.
   *
   * Existe porque as duas coisas que ela quer se contradizem sem ele: gravar só
   * no "Salvar", e não perder o texto ao trocar de REV. Antes, trocar gravava —
   * e por isso um REV que ela só passou o olho já entrava no histórico. Agora
   * trocar guarda aqui, e só o "Salvar" leva para o banco.
   *
   * É memória da sessão de propósito: "salva só quando eu mandar" quer dizer
   * que recarregar a página perde o que não foi salvo. O aviso ao sair da
   * página é o que evita que isso aconteça sem ela ver.
   */
  const [rascunhos, setRascunhos]   = useState<Record<string, string>>({});
  const [acoes, setAcoes]           = useState<Acao[]>([]);
  const [salvando, setSalvando]     = useState(false);
  const [fechando, setFechando]     = useState(false);
  const [espelho, setEspelho]       = useState<ResultadoEspelho | null>(null);

  const atual = revs[indice];
  const ultimo = indice === revs.length - 1;

  /**
   * Só REV no ar entra na rodada.
   *
   * Analisar REV arquivado ou planejado seria percorrer 24 telas para escrever
   * "não rodou" em 18 delas — e é assim que um ritual quinzenal vira algo que
   * ninguém faz.
   */
  const carregarRevs = useCallback(async () => {
    const [{ data, error }, { data: metodos }] = await Promise.all([
      supabase.from('vw_mapa_revs').select('id,rev,projeto,vendas,status')
        .eq('status', 'ativo').order('vendas', { ascending: false }),
      supabase.from('funis').select('id,metodo,vsl_id'),
    ]);

    if (error) {
      toast({ title: 'Erro ao carregar os REVs', description: error.message, variant: 'destructive' });
    }
    const por = new Map(((metodos ?? []) as Array<{ id: string; metodo: string | null; vsl_id: string | null }>)
      .map(f => [f.id, f]));
    const lista: RevDaRodada[] = ((data ?? []) as Array<{
      id: string; rev: string; projeto: string | null; vendas: number;
    }>).map(r => ({
      ...r,
      metodo: por.get(r.id)?.metodo ?? null,
      vsl_id: por.get(r.id)?.vsl_id ?? null,
    }));
    setRevs(lista);
    return lista;
  }, []);

  /**
   * Retoma a rodada aberta em vez de começar outra.
   *
   * Sem isto, recarregar a página no meio das 3 horas criaria uma segunda
   * rodada da mesma data, e a leitura ficaria partida entre duas — o mesmo
   * defeito de dois registros dizendo a mesma coisa que já custou caro aqui.
   */
  const retomarRodada = useCallback(async () => {
    const limite = janelaDeDias(8).inicio;
    const { data } = await supabase
      .from('analises')
      .select('id,data,analise_itens(funil_id,leitura)')
      .is('fechada_em', null)
      // Arquivada não se retoma: sem isto, arquivar uma rodada em andamento a
      // traria de volta no recarregar seguinte, e o arquivo não teria efeito
      // nenhum sobre a única tela que cria rodada.
      .is('arquivada_em', null)
      .gte('data', limite)
      .order('data', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return {} as Record<string, string>;

    setAnaliseId(data.id as string);
    setDataRodada(data.data as string);

    const itens = (data.analise_itens ?? []) as Array<{ funil_id: string; leitura: string | null }>;
    const mapa = Object.fromEntries(itens.map(i => [i.funil_id, i.leitura ?? '']));
    setLidos(mapa);
    return mapa;
  }, []);

  useEffect(() => {
    (async () => {
      const [lista, mapa] = await Promise.all([carregarRevs(), retomarRodada()]);
      // O texto do primeiro REV entra aqui, e não num efeito: um efeito que
      // observasse `lidos` reescreveria o campo a cada gravação, por baixo de
      // quem ainda estivesse digitando.
      if (lista[0]) setLeitura(mapa[lista[0].id] ?? '');
      setCarregando(false);
    })();
  }, [carregarRevs, retomarRodada]);

  /**
   * Avisa antes de fechar a aba com texto não salvo.
   *
   * É a contrapartida de tirar a gravação automática. Enquanto trocar de REV
   * gravava, sair sem salvar não perdia nada; agora perde, e perder em silêncio
   * seria trocar um incômodo — o histórico enchendo de REVs olhados de passagem
   * — por um estrago. Só vale para a aba: a troca de REV guarda no rascunho e
   * não passa por aqui.
   */
  useEffect(() => {
    const naoSalvo = () =>
      Object.entries(rascunhos).some(([id, txt]) => txt !== (lidos[id] ?? ''));
    const avisar = (e: BeforeUnloadEvent) => {
      const idAgora = atual?.id ?? '';
      const emFoco = leitura !== (lidos[idAgora] ?? '');
      if (!emFoco && !naoSalvo()) return;
      e.preventDefault();
      // O texto é decidido pelo navegador; o que importa é devolver algo.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [rascunhos, lidos, leitura, atual]);

  /**
   * As ações do REV em foco — abertas de qualquer rodada, mais as fechadas
   * desta. Ação aberta há três quinzenas continua aparecendo: é a dívida que o
   * módulo existe para cobrar.
   */
  const carregarAcoes = useCallback(async (funilId: string) => {
    const { data } = await supabase
      .from('analise_acoes')
      .select('id,texto,expectativa,feita,feita_em,criada_em,analise_id,analises(data),perfis:feita_por(nome)')
      .eq('funil_id', funilId)
      .order('criada_em');

    // `analises` e `perfis` chegam como objeto ou array conforme o PostgREST
    // resolve a relação; normalizar aqui evita o dado sumir sem erro nenhum.
    const um = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

    const linhas = (data ?? []) as unknown as Array<{
      id: string; texto: string; expectativa: string | null;
      feita: boolean; feita_em: string | null; criada_em: string;
      analises: { data: string } | { data: string }[] | null;
      perfis: { nome: string | null } | { nome: string | null }[] | null;
    }>;
    const lista: Acao[] = linhas.map(l => ({
      id: l.id, texto: l.texto, expectativa: l.expectativa,
      feita: l.feita, feita_em: l.feita_em, criada_em: l.criada_em,
      feita_por_nome: um(l.perfis)?.nome ?? null,
      data_origem: um(l.analises)?.data ?? null,
    }));
    setAcoes(lista);
    // Devolve a lista porque o espelho precisa da versão recém-gravada: ler o
    // estado logo depois de `setAcoes` traria a anterior.
    return lista;
  }, []);

  // Métricas do REV em foco. A retenção vem junto, mas por fora do SQL: muda
  // todo dia, e espelhá-la numa tabela nossa seria guardar retrato velho.
  useEffect(() => {
    if (!atual) return;
    let cancelado = false;
    setBuscando(true);
    setRetencao(null); setRetencaoAntes(null);
    carregarAcoes(atual.id);

    (async () => {
      const { data, error } = await supabase.rpc('fn_metricas_do_rev', {
        p_funil_id: atual.id, p_inicio: janela.inicio, p_fim: janela.fim,
      });
      if (cancelado) return;
      if (error) toast({ title: 'Erro ao calcular', description: error.message, variant: 'destructive' });
      setMetricas((data as MetricasDoRev) ?? null);
      setBuscando(false);

      // A VSL é acessória e falha em silêncio de propósito: se o VTurb estiver
      // fora do ar, a rodada continua — o resto dos números não depende dela.
      if (atual.vsl_id) {
        try {
          const ja = janelaAnterior(janela);
          const [agora, antes] = await Promise.all([
            buscarRetencao(atual.vsl_id, janela.inicio, janela.fim),
            buscarRetencao(atual.vsl_id, ja.inicio, ja.fim),
          ]);
          if (!cancelado) { setRetencao(agora); setRetencaoAntes(antes); }
        } catch { /* sem retenção, a tela mostra o bloco vazio */ }
      }
    })();

    return () => { cancelado = true; };
  }, [atual, janela, carregarAcoes]);

  function trocarPreset(v: string) {
    setPreset(v);
    if (v !== PERSONALIZADO) setJanela(janelaDeDias(Number(v)));
  }

  /** Cria a rodada na primeira gravação, e não ao abrir a tela. */
  async function garantirRodada(): Promise<{ id: string; data: string } | null> {
    if (analiseId && dataRodada) return { id: analiseId, data: dataRodada };
    const { data, error } = await supabase
      .from('analises').insert({ autor_id: user?.id ?? null }).select('id,data').single();
    if (error || !data) {
      toast({ title: 'Erro ao abrir a rodada', description: error?.message, variant: 'destructive' });
      return null;
    }
    setAnaliseId(data.id as string);
    setDataRodada(data.data as string);
    // Devolve a DATA junto, e não só o id: quem chama precisa dela na mesma
    // volta para espelhar, e o estado só chega no render seguinte.
    return { id: data.id as string, data: data.data as string };
  }

  async function adicionarAcao(texto: string, expectativa: string) {
    if (!atual) return;
    const rodada = await garantirRodada();
    const { error } = await supabase.from('analise_acoes').insert({
      analise_id: rodada?.id ?? null, funil_id: atual.id, texto,
      expectativa: expectativa || null,
      criada_por: user?.id ?? null,
    });
    if (error) {
      toast({ title: 'Erro ao salvar a ação', description: error.message, variant: 'destructive' });
      return;
    }
    espelhar(await carregarAcoes(atual.id), rodada?.data);
  }

  async function marcarAcao(id: string, feita: boolean) {
    // Otimista: marcar caixinha tem que responder na hora, e o pior caso é a
    // recarga logo abaixo desmarcar de volta.
    setAcoes(prev => prev.map(a => (a.id === id ? { ...a, feita } : a)));
    const { error } = await supabase.from('analise_acoes')
      .update({ feita, feita_por: feita ? user?.id ?? null : null }).eq('id', id);
    if (error) {
      toast({ title: 'Erro ao marcar', description: error.message, variant: 'destructive' });
    }
    if (atual) espelhar(await carregarAcoes(atual.id));
  }

  /**
   * Corrigir a ação sem sair da Rodada.
   *
   * A expectativa é o campo que mais precisa disto: ela é opcional no momento
   * de escrever — de propósito, porque obrigar faria escrever qualquer coisa —,
   * e a hora de preenchê-la costuma ser a seguinte, quando a pessoa para para
   * pensar por que decidiu aquilo. Sem edição aqui, o único caminho era ir até
   * o Histórico.
   */
  async function salvarAcao(id: string, texto: string, expectativa: string | null) {
    const { error } = await supabase.from('analise_acoes')
      .update({ texto, expectativa }).eq('id', id);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    if (atual) espelhar(await carregarAcoes(atual.id));
  }

  async function apagarAcao(id: string) {
    const ok = await confirmar({
      title: 'Apagar esta ação?',
      description: 'A decisão some do histórico e não volta.',
      confirmText: 'Apagar',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('analise_acoes').delete().eq('id', id);
    if (error) {
      toast({ title: 'Erro ao apagar', description: error.message, variant: 'destructive' });
      return;
    }
    if (atual) espelhar(await carregarAcoes(atual.id));
  }

  /**
   * Troca de REV sem gravar nada.
   *
   * O texto em foco vai para o rascunho e o do destino volta de lá — ou do que
   * já está salvo, se nunca foi editado nesta sessão.
   *
   * Antes disto, trocar de REV gravava. A intenção era não perder o que tinha
   * sido escrito, mas o efeito era outro: passar o olho em seis REVs criava
   * seis itens no histórico, com leitura vazia, de REVs sobre os quais ela não
   * disse nada. O rascunho resolve os dois — nada se perde, e nada entra no
   * banco sem ela mandar.
   */
  function trocarRev(destinoId: string) {
    if (!atual || destinoId === atual.id) return;
    const i = revs.findIndex(r => r.id === destinoId);
    if (i < 0) return;
    const guardados = { ...rascunhos, [atual.id]: leitura };
    setRascunhos(guardados);
    setIndice(i);
    setLeitura(guardados[destinoId] ?? lidos[destinoId] ?? '');
  }

  /**
   * Grava a leitura do REV em foco e vai para `destinoId` (ou fica, se null).
   *
   * Só é chamada pelo "Salvar", pelo "Salvar e avançar" e pelo fechamento da
   * rodada. Navegar não grava.
   */
  async function salvarItem(destinoId: string | null): Promise<string | null> {
    if (!atual) return null;

    const ir = (mapa: Record<string, string>) => {
      if (!destinoId || destinoId === atual.id) return;
      const i = revs.findIndex(r => r.id === destinoId);
      if (i < 0) return;
      setIndice(i);
      setLeitura(rascunhos[destinoId] ?? mapa[destinoId] ?? '');
    };

    // Grava mesmo sem leitura escrita.
    //
    // A versão anterior exigia texto e não gravava nada sem ele — então um REV
    // que ela olhou, entendeu e não teve o que comentar sumia do histórico e da
    // planilha, junto com todos os números dele. O retrato do período é o
    // registro; a leitura é opinião sobre o registro, e opinião opcional não
    // pode ser condição para o registro existir.
    //
    // Sem métricas ainda carregadas não há o que gravar, e um item vazio de
    // verdade seria pior que nenhum.
    if (!metricas && !leitura.trim()) { ir(lidos); return analiseId; }

    setSalvando(true);
    const rodada = await garantirRodada();
    if (!rodada) { setSalvando(false); return null; }

    const { error } = await supabase.from('analise_itens').upsert({
      analise_id: rodada.id,
      funil_id: atual.id,
      // O RETRATO das métricas e da retenção. Se uma venda for recategorizada
      // depois, a leitura continua fazendo sentido ao lado dos números que a
      // motivaram — ver o comentário da tabela no banco.
      metricas: metricas as unknown as Record<string, unknown>,
      retencao: retencao as unknown as Record<string, unknown>,
      leitura: leitura.trim() || null,
    }, { onConflict: 'analise_id,funil_id' });

    setSalvando(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return null;
    }
    const mapa = { ...lidos, [atual.id]: leitura };
    setLidos(mapa);
    // O rascunho deste REV morre aqui: o que foi gravado agora é o salvo, e
    // deixá-lo para trás faria o texto velho reaparecer ao voltar neste REV.
    setRascunhos(r => {
      const { [atual.id]: _gravado, ...resto } = r;
      return resto;
    });
    espelhar(acoes, rodada.data);
    ir(mapa);
    return rodada.id;
  }

  /**
   * Manda a rodada para o Obsidian e para a planilha.
   *
   * Chamado a cada gravação, e não só ao fechar a rodada, porque ela pediu
   * assim — e só é seguro porque as duas pontas sobrescrevem em vez de
   * acrescentar. Silencioso: o Obsidian roda na máquina dela e pode estar
   * fechado, e um toast de erro a cada salvar seria pior que a falta do
   * espelho.
   */
  function espelhar(acoesAgora: Acao[] = acoes, dataForcada?: string) {
    // A data vem por parâmetro quando a rodada acabou de nascer: nesse clique
    // `dataRodada` ainda é null nesta closure, e o espelho do PRIMEIRO
    // salvamento se perdia em silêncio — o banco gravava e o Obsidian ficava
    // com a nota da rodada anterior.
    const quando = dataForcada ?? dataRodada;
    if (!atual || !quando) return;
    exportarRodada({
      dataRodada: quando,
      projeto: atual.projeto,
      rev: atual.rev,
      metodo: atual.metodo,
      metricas,
      retencao,
      leitura,
      acoes: acoesAgora.map(a => ({
        texto: a.texto, expectativa: a.expectativa, feita: a.feita,
        feita_em: a.feita_em, feita_por_nome: a.feita_por_nome,
      })),
    }, setEspelho);
  }

  /** A seta é navegação, e navegação não grava. */
  const voltar = () => {
    const destino = revs[Math.max(0, indice - 1)];
    if (destino) trocarRev(destino.id);
  };

  /** O "Salvar e avançar": este grava, porque diz que grava. */
  const salvarEAvancar = () => {
    const destino = revs[Math.min(indice + 1, revs.length - 1)];
    return salvarItem(destino?.id ?? null);
  };

  /** Fecha a rodada — o marco que separa "estou analisando" de "analisei". */
  async function fecharRodada() {
    // O id vem do próprio salvar, e não do estado: se a rodada acabou de
    // nascer nesta gravação, `analiseId` ainda é o valor velho desta closure e
    // a tela diria "nada para fechar" logo depois de gravar.
    const id = (await salvarItem(null)) ?? analiseId;
    if (!id) {
      toast({ title: 'Nada para fechar', description: 'Nenhuma leitura foi escrita nesta rodada.' });
      return;
    }
    setFechando(true);
    const { error } = await supabase
      .from('analises').update({ fechada_em: new Date().toISOString() }).eq('id', id);
    const { count } = await supabase
      .from('analise_itens').select('id', { count: 'exact', head: true }).eq('analise_id', id);
    setFechando(false);
    if (error) {
      toast({ title: 'Erro ao fechar a rodada', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Rodada fechada',
      description: count === 1
        ? '1 REV com leitura escrita. Está no Histórico.'
        : `${count ?? 0} REVs com leitura escrita. Estão no Histórico.`,
    });
    setAnaliseId(null); setDataRodada(null); setLidos({});
    setLeitura(''); setIndice(0);
  }

  const analisados = useMemo(() => Object.keys(lidos).length, [lidos]);
  const dias = diasDaJanela(janela);

  if (carregando) {
    return (
      <DashboardLayout title="Análises">
        <AnalisesNav />
        <div className="flex items-center justify-center py-32">
          <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (revs.length === 0) {
    return (
      <DashboardLayout title="Análises" hideFilters>
        <AnalisesNav />
        <div className="py-20 text-center space-y-2">
          <p className="text-base text-muted-foreground">Nenhum REV ativo para analisar.</p>
          <p className="text-sm text-muted-foreground/70">
            A rodada percorre só os REVs no ar — marque um como Ativo em Funis.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const a = metricas?.atual;
  const ant = metricas?.anterior;
  const distancia = a ? distanciaDoMeta(a) : null;
  const atribuicaoDuvidosa = distancia != null && distancia > LIMITE_DISTANCIA;
  // O conjunto é a granularidade certa e não a campanha: a mesma campanha roda
  // REVs diferentes, e no REV6 medir pela campanha inflava o gasto quase 7×.
  const detalheInvestimento = !a ? undefined
    : a.nivel_investimento === 'conjunto'
      ? `${a.conjuntos} ${a.conjuntos === 1 ? 'conjunto' : 'conjuntos'} de anúncios`
      : 'sem conjunto identificado — só anúncios com venda';

  // Há algo digitado que ainda não foi gravado. Cobre o item que nunca salvou
  // e o texto editado depois do último salvamento — os dois casos em que dizer
  // "salvo" seria mentira.
  const idEmFoco = atual?.id ?? '';
  const porSalvar = !(idEmFoco in lidos) || lidos[idEmFoco] !== leitura;

  const semBaseParaPago = a && ant ? baseAnteriorFragil(a, ant) : false;
  const avisoDeBase = semBaseParaPago
    ? 'os anúncios mal rodaram no período anterior — o "antes" aqui não é linha de base'
    : undefined;

  return (
    <DashboardLayout title="Análises" hideFilters>
      <AnalisesNav />

      <div className="space-y-4">
        {/* Barra da rodada */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={preset} onValueChange={trocarPreset}>
            <SelectTrigger className="h-10 w-48 text-base"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODOS.map(p => (
                <SelectItem key={p.dias} value={String(p.dias)}>{p.label}</SelectItem>
              ))}
              <SelectItem value={PERSONALIZADO}>Personalizado…</SelectItem>
            </SelectContent>
          </Select>

          {preset === PERSONALIZADO && (
            <div className="flex items-center gap-1">
              <Input
                type="date" className="h-10 w-[11rem] text-base"
                value={janela.inicio} max={janela.fim}
                onChange={e => e.target.value && setJanela(j => ({ ...j, inicio: e.target.value }))}
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date" className="h-10 w-[11rem] text-base"
                value={janela.fim} min={janela.inicio}
                onChange={e => e.target.value && setJanela(j => ({ ...j, fim: e.target.value }))}
              />
            </div>
          )}

          {/* Escolher o REV direto, sem percorrer um a um -- e sem gravar:
              olhar nao e analisar. */}
          <Select value={atual?.id ?? ''} onValueChange={trocarRev}>
            <SelectTrigger className="h-9 w-72 text-base"><SelectValue /></SelectTrigger>
            <SelectContent>
              {revs.map(r => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="inline-flex items-center gap-1.5">
                    {r.id in lidos && <Check className="h-3 w-3 text-emerald-400" />}
                    {r.projeto ? `${r.projeto} · ` : ''}{r.rev}
                    {r.metodo && <span className="text-xs text-muted-foreground">{r.metodo}</span>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            <Button
              size="sm" variant="outline" className="h-9 w-9 p-0"
              onClick={() => voltar()} disabled={salvando || fechando || indice === 0}
              aria-label="REV anterior, sem salvar"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {/* No último REV não há para onde avançar — o botão vira o fim do
                ritual, em vez de ficar cinza e deixar a rodada sem fecho. */}
            {ultimo ? (
              <Button size="sm" className="h-9 gap-1.5" onClick={fecharRodada} disabled={salvando || fechando}>
                <Lock className="h-4 w-4" />
                {fechando ? 'Fechando…' : 'Salvar e fechar rodada'}
              </Button>
            ) : (
              <Button size="sm" className="h-9 gap-1.5" onClick={salvarEAvancar} disabled={salvando || fechando}>
                {salvando ? 'Salvando…' : 'Salvar e avançar'}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          REV {indice + 1} de {revs.length}
          {analisados > 0 && ` · ${analisados} ${analisados === 1 ? 'salvo' : 'salvos'}`}
          {dataRodada && ` · rodada de ${formatarData(dataRodada)}`}
          {' · '}
          {/* A janela dita em voz alta: sem isto ninguém sabe se "14 dias"
              inclui hoje, e o dia pela metade puxaria todo volume para baixo. */}
          <span className="text-muted-foreground/70">
            {formatarData(janela.inicio)} a {formatarData(janela.fim)} ({dias} dias),
            contra os {dias} dias anteriores
          </span>
        </p>

        {/* O REV em foco */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-muted-foreground">
              {atual?.projeto ?? 'sem projeto'}
            </span>
            <span className="text-lg font-semibold">{atual?.rev}</span>
            {atual?.metodo && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                {atual.metodo}
              </span>
            )}
            {(atual?.id ?? '') in lidos && (
              <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Check className="h-3 w-3" /> salvo
              </span>
            )}
          </div>

          {buscandoMetricas ? (
            <div className="py-16 flex justify-center">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : a && ant ? (
            <>
              {/* 1 — o veredito */}
              <ListaMetricas
                titulo="Resultado"
                nota={avisoDeBase}
              >
                <LinhaMetrica rotulo="Investimento" valor={a.investimento} anterior={ant.investimento} formato={formatCurrency} subirEhRuim
                  detalhe={detalheInvestimento} />
                <LinhaMetrica rotulo="Faturamento" valor={a.faturamento} anterior={ant.faturamento} formato={formatCurrency} destaque />
                <LinhaMetrica rotulo="Resultado" valor={a.resultado} anterior={ant.resultado} formato={formatCurrency}
                  detalhe="faturamento − investimento" />
                <LinhaMetrica rotulo="ROAS" valor={a.roas} anterior={ant.roas} formato={num2} destaque />
                <LinhaMetrica rotulo="Imposto" valor={a.imposto_simples + a.imposto_meta} anterior={ant.imposto_simples + ant.imposto_meta} formato={formatCurrency} subirEhRuim
                  detalhe="Simples + imposto sobre o Meta" />
                <LinhaMetrica rotulo="Taxa da plataforma" valor={a.taxa_plataforma} anterior={ant.taxa_plataforma} formato={formatCurrency} subirEhRuim
                  detalhe={a.taxa_plataforma_pct != null ? `${pct2(a.taxa_plataforma_pct)} do faturamento` : undefined} />
                <LinhaMetrica rotulo="Lucro líquido" valor={a.lucro_liquido} anterior={ant.lucro_liquido} formato={formatCurrency} destaque
                  detalhe={a.margem_pct != null ? `margem de ${pct(a.margem_pct)}` : undefined} />
              </ListaMetricas>

              {/* 1b — o upsell ao lado do front, nunca dentro. Somar esconde
                  front doente; tirar mata funil lucrativo. */}
              <BlocoUpsell a={a} ant={ant} />

              {/* 2 — o que foi vendido. A única parte em colunas, porque aqui
                  cada coluna é outra medida da MESMA oferta. */}
              <section className="space-y-1.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Ofertas
                  </h3>
                  <div className="h-px flex-1 min-w-4 bg-border" />
                  {a.pct_ofertas_extras != null && (
                    <span className="text-[13px] font-medium text-foreground tabular-nums">
                      {pct2(a.pct_ofertas_extras)}
                      <span className="font-normal text-muted-foreground"> do faturamento veio dos bumps</span>
                    </span>
                  )}
                </div>
                <TabelaItens
                  atual={a.itens ?? []} anterior={ant.itens ?? []}
                  principal={{
                    qtd: a.oferta_principal_qtd, valor: a.oferta_principal_valor,
                    antesQtd: ant.oferta_principal_qtd, antesValor: ant.oferta_principal_valor,
                  }}
                />
              </section>

              {/* 3 — o funil, na ordem em que ele acontece */}
              {/* No funil o custo é que fica grande: 20.410 cliques não dizem
                  nada sozinhos, R$ 1,01 por clique diz. A contagem e a taxa de
                  passagem descem para a linha de baixo, na mesma coluna, para
                  agora e anterior seguirem comparáveis de cima a baixo. */}
              {/* O nome da métrica na linha miúda, e não no rótulo: o rótulo é
                  a ETAPA do funil, e trocá-lo por "CPA" quebraria a leitura de
                  cima a baixo — clique, checkout, venda.

                  Sem essa linha o custo grande ficava anônimo: "onde é o CPA?"
                  foi pergunta de verdade olhando para o R$ 51,06, que é
                  exatamente o CPA. O bloco Por visitante já nomeava os dele; só
                  o Funil tinha ficado mudo.

                  O que o % quer dizer vai na nota do bloco e não em cada linha:
                  repetido três vezes ele estourava o rótulo em três linhas e
                  engordava a tabela inteira para explicar a mesma coisa. */}
              <ListaMetricas
                titulo="Funil"
                // "a passagem da etapa anterior" se lia como se a % fosse DA
                // etapa de cima, e não o que veio dela — a pergunta apareceu
                // olhando para os 56,73% da linha de vendas.
                nota="a % é quanto passou da etapa de cima"
              >
                <LinhaTripla
                  rotulo="Cliques no link" detalhe="CPC · custo por clique"
                  formato={formatCurrency} subirEhRuim
                  valor={a.cpc} anterior={ant.cpc}
                  topo={formatNumber(a.cliques)} topoAntes={formatNumber(ant.cliques)}
                />
                <LinhaTripla
                  rotulo="Checkouts iniciados" detalhe="CPI · custo por checkout iniciado"
                  formato={formatCurrency} subirEhRuim
                  valor={a.cpi} anterior={ant.cpi}
                  topo={formatNumber(a.checkouts_iniciados)} topoAntes={formatNumber(ant.checkouts_iniciados)}
                  base={a.taxa_checkout_pct != null ? pct2(a.taxa_checkout_pct) : undefined}
                  baseAntes={ant.taxa_checkout_pct != null ? pct2(ant.taxa_checkout_pct) : undefined}
                />
                {/* A conversão do checkout em linha própria, e não como % miúda
                    sob o CPA da linha de vendas.

                    Ali embaixo ela se lia errado: "Vendas 56,73%" parece uma
                    fatia das vendas, quando é a fatia dos CHECKOUTS que virou
                    venda. Em linha própria o % é o assunto, do mesmo jeito que
                    a conversão do funil já era. */}
                <LinhaMetrica
                  rotulo="Conversão do checkout"
                  valor={a.conv_checkout_pct} anterior={ant.conv_checkout_pct} formato={pct2}
                  detalhe="checkout iniciado que virou venda"
                />
                <LinhaTripla
                  rotulo="Vendas" detalhe="CPA · custo por venda"
                  formato={formatCurrency} subirEhRuim destaque
                  valor={a.cpa} anterior={ant.cpa}
                  topo={formatNumber(a.vendas)} topoAntes={formatNumber(ant.vendas)}
                />
                <LinhaMetrica rotulo="Conversão do funil" valor={a.conv_funil_pct} anterior={ant.conv_funil_pct} formato={pct2}
                  detalhe="venda por visita à página" />
              </ListaMetricas>

              {/* 4 — como a página segura: é o meio do funil, entre o clique e
                  o checkout, e por isso vem aqui e não no fim. */}
              {atual?.metodo === 'VSL' || atual?.vsl_id
                ? <BlocoVsl r={retencao} anterior={retencaoAntes} />
                : <BlocoTsl />}

              {/* 5 — quanto cada visitante custa e traz */}
              <ListaMetricas titulo="Por visitante" nota="EPC − CPV negativo é escala comprando prejuízo">
                <LinhaMetrica rotulo="CPV" detalhe="custo por visitante" valor={a.cpv} anterior={ant.cpv} formato={formatCurrency} subirEhRuim />
                <LinhaMetrica rotulo="EPC" detalhe="quanto cada visitante traz" valor={a.epc} anterior={ant.epc} formato={formatCurrency} />
                <LinhaMetrica rotulo="EPC − CPV" detalhe="o que sobra de cada visitante" valor={a.epc_menos_cpv} anterior={ant.epc_menos_cpv} formato={formatCurrency} destaque />
                <LinhaMetrica rotulo="AOV" detalhe="ticket médio da venda" valor={a.aov} anterior={ant.aov} formato={formatCurrency} />
              </ListaMetricas>

              {atribuicaoDuvidosa && (
                <p className="text-sm text-amber-400/90 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Contamos {formatNumber(a.vendas)} vendas e o Meta reporta{' '}
                    {formatNumber(a.compras_meta)} compras para os mesmos anúncios. O que cada
                    fonte chama de venda não bate: leia CPA, EPC e conversão como ordem de
                    grandeza, não como número exato.
                  </span>
                </p>
              )}

              {a.vendas === 0 && (
                <p className="text-sm text-amber-400/90 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Nenhuma venda atribuída a este REV no período — pode ser que o checkout
                  dele ainda não esteja vinculado, em Funis → Checkouts.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground/60 italic">Sem métricas para o período.</p>
          )}

          {/* O que já foi mexido, ao lado dos números que isso deveria ter
              mexido. É a pergunta que a rodada existe para responder. */}
          <AcoesFeitas
            acoes={acoes} fimDaJanela={janela.fim}
            onMarcar={marcarAcao} onSalvar={salvarAcao} onApagar={apagarAcao}
          />

          {/* O que se digita — e só isto.

              Não há botão de salvar aqui: "Salvar e avançar" é o gesto real da
              rodada, e sair do campo já grava. O que faltava não era o botão —
              era saber que gravou, e isso o estado ao lado do título resolve
              sem ocupar uma linha inteira com botão e legenda. */}
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                O que você lê nisso
              </h3>
              <div className="h-px flex-1 bg-border" />
              <EstadoEspelho resultado={espelho} salvando={salvando} porSalvar={porSalvar} />
            </div>
            <Textarea
              className="h-28 resize-none text-base"
              placeholder="Ex: todos os OBs caíram a conversão, mas faturamos mais com o combo…"
              value={leitura} onChange={e => setLeitura(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm" className="h-9" onClick={() => salvarItem(null)}
                disabled={salvando || fechando || !porSalvar}
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
              {porSalvar && (
                <span className="text-[13px] text-amber-400/90">
                  ainda não salvo — trocar de REV guarda o texto, mas não grava
                </span>
              )}
            </div>
            <AvisoPlanilha />
          </div>

          <ListaAcoes
            acoes={acoes} dataRodada={dataRodada}
            onAdicionar={adicionarAcao} onMarcar={marcarAcao}
            onSalvar={salvarAcao} onApagar={apagarAcao}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
