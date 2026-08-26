import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { ChevronLeft, ChevronRight, FlaskConical, AlertTriangle, Check, Lock } from 'lucide-react';
import { AnalisesNav } from '../components/AnalisesNav';
import { CartaoMetrica } from '../components/CartaoMetrica';
import { SecaoMetricas } from '../components/SecaoMetricas';
import { TabelaItens } from '../components/TabelaItens';
import { MetricasDoRev, distanciaDoMeta, baseAnteriorFragil, LIMITE_DISTANCIA } from '../metricas';
import {
  Janela, PERIODOS, PERSONALIZADO, janelaDeDias, diasDaJanela, formatarData,
} from '../periodo';

/**
 * A rodada de análise — a tela onde moram as 3 horas quinzenais.
 *
 * A tese do módulo é que aquelas 3 horas são DIGITAÇÃO, não análise: abrir a
 * planilha do funil, transcrever investimento, faturamento, vendas, conversões,
 * cada order bump. Quase tudo já está no banco.
 *
 * Então aqui nada de numérico se digita. A tela calcula, mostra ao lado do
 * período anterior, e pede só o julgamento: o que você leu nisso, e o que vai
 * fazer a respeito.
 *
 * A regra que decide se este módulo deu certo: se sobrar campo numérico para
 * preencher, ele falhou — voltou a ser a planilha.
 */

interface RevDaRodada {
  id: string;
  rev: string;
  projeto: string | null;
  vendas: number;
}

interface ItemSalvo {
  leitura: string;
  proximas_acoes: string;
}

const pct = (n: number) => `${n.toFixed(1)}%`;
const pct2 = (n: number) => `${n.toFixed(2)}%`;
const num2 = (n: number) => n.toFixed(2);

export default function AnalisesPage() {
  const { user } = useAuth();

  const [revs, setRevs]         = useState<RevDaRodada[]>([]);
  const [indice, setIndice]     = useState(0);
  const [preset, setPreset]     = useState<string>('14');
  const [janela, setJanela]     = useState<Janela>(() => janelaDeDias(14));
  const [metricas, setMetricas] = useState<MetricasDoRev | null>(null);
  const [carregando, setCarregando]     = useState(true);
  const [buscandoMetricas, setBuscando] = useState(false);

  const [analiseId, setAnaliseId]   = useState<string | null>(null);
  const [dataRodada, setDataRodada] = useState<string | null>(null);
  const [leitura, setLeitura]       = useState('');
  const [acoes, setAcoes]           = useState('');
  const [salvos, setSalvos]         = useState<Record<string, ItemSalvo>>({});
  const [salvando, setSalvando]     = useState(false);
  const [fechando, setFechando]     = useState(false);

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
    const { data, error } = await supabase
      .from('vw_mapa_revs')
      .select('id,rev,projeto,vendas,status')
      .eq('status', 'ativo')
      .order('vendas', { ascending: false });

    if (error) {
      toast({ title: 'Erro ao carregar os REVs', description: error.message, variant: 'destructive' });
    }
    const lista = (data ?? []) as RevDaRodada[];
    setRevs(lista);
    return lista;
  }, []);

  /**
   * Retoma a rodada aberta em vez de começar outra.
   *
   * Sem isto, recarregar a página no meio das 3 horas criaria uma segunda
   * rodada da mesma data, e a leitura ficaria partida entre duas — o mesmo
   * defeito de dois registros dizendo a mesma coisa que já custou caro aqui.
   *
   * O limite de 7 dias existe porque rodada aberta há um mês é rodada
   * esquecida, não rodada em andamento: retomá-la misturaria períodos.
   */
  const retomarRodada = useCallback(async () => {
    const limite = janelaDeDias(8).inicio;
    const { data } = await supabase
      .from('analises')
      .select('id,data,analise_itens(funil_id,leitura,proximas_acoes)')
      .is('fechada_em', null)
      .gte('data', limite)
      .order('data', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return {} as Record<string, ItemSalvo>;

    setAnaliseId(data.id as string);
    setDataRodada(data.data as string);

    const itens = (data.analise_itens ?? []) as Array<{
      funil_id: string; leitura: string | null; proximas_acoes: string | null;
    }>;
    const mapa: Record<string, ItemSalvo> = Object.fromEntries(itens.map(i => [
      i.funil_id,
      { leitura: i.leitura ?? '', proximas_acoes: i.proximas_acoes ?? '' },
    ]));
    setSalvos(mapa);
    return mapa;
  }, []);

  useEffect(() => {
    (async () => {
      const [lista, mapa] = await Promise.all([carregarRevs(), retomarRodada()]);
      // O texto do primeiro REV entra aqui, e não num efeito: um efeito que
      // observasse `salvos` reescreveria o campo a cada gravação, por baixo de
      // quem ainda estivesse digitando.
      const primeiro = lista[0];
      if (primeiro) {
        setLeitura(mapa[primeiro.id]?.leitura ?? '');
        setAcoes(mapa[primeiro.id]?.proximas_acoes ?? '');
      }
      setCarregando(false);
    })();
  }, [carregarRevs, retomarRodada]);

  // Métricas do REV em foco. Buscadas por REV, e não todas de uma vez: a função
  // agrega vendas, itens e investimento — carregar os 6 de antemão faria a tela
  // esperar por dado que talvez ninguém veja.
  useEffect(() => {
    if (!atual) return;
    let cancelado = false;
    setBuscando(true);
    supabase
      .rpc('fn_metricas_do_rev', {
        p_funil_id: atual.id,
        p_inicio: janela.inicio,
        p_fim: janela.fim,
      })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) toast({ title: 'Erro ao calcular', description: error.message, variant: 'destructive' });
        setMetricas((data as MetricasDoRev) ?? null);
        setBuscando(false);
      });
    return () => { cancelado = true; };
  }, [atual, janela]);

  function trocarPreset(v: string) {
    setPreset(v);
    if (v !== PERSONALIZADO) setJanela(janelaDeDias(Number(v)));
  }

  /** Cria a rodada na primeira gravação, e não ao abrir a tela. */
  async function garantirRodada(): Promise<string | null> {
    if (analiseId) return analiseId;
    const { data, error } = await supabase
      .from('analises')
      .insert({ autor_id: user?.id ?? null })
      .select('id,data')
      .single();
    if (error || !data) {
      toast({ title: 'Erro ao abrir a rodada', description: error?.message, variant: 'destructive' });
      return null;
    }
    setAnaliseId(data.id as string);
    setDataRodada(data.data as string);
    return data.id as string;
  }

  /**
   * Grava o REV em foco e vai para `destinoId` (ou fica, se null).
   *
   * Trocar de REV sempre grava, de propósito: os botões existem para comparar
   * um REV com outro, e perder o que acabou de ser escrito por causa disso
   * seria a pior forma de descobrir que a tela não salvava.
   */
  async function salvarItem(destinoId: string | null): Promise<string | null> {
    if (!atual) return null;

    // Andar e trocar o texto acontecem juntos: o campo pertence ao REV em foco,
    // e trocar um sem o outro mostraria a leitura de um REV sobre os números de
    // outro.
    const ir = (mapa: Record<string, ItemSalvo>) => {
      if (!destinoId || destinoId === atual.id) return;
      const i = revs.findIndex(r => r.id === destinoId);
      if (i < 0) return;
      setIndice(i);
      setLeitura(mapa[destinoId]?.leitura ?? '');
      setAcoes(mapa[destinoId]?.proximas_acoes ?? '');
    };

    // Não grava item vazio: uma rodada cheia de REVs sem leitura vira ruído no
    // histórico, e o contador de "analisados" mentiria.
    if (!leitura.trim() && !acoes.trim()) { ir(salvos); return analiseId; }

    setSalvando(true);
    const id = await garantirRodada();
    if (!id) { setSalvando(false); return null; }

    const { error } = await supabase.from('analise_itens').upsert({
      analise_id: id,
      funil_id: atual.id,
      // O RETRATO das métricas vai junto. Se uma venda for recategorizada
      // depois, a leitura continua fazendo sentido ao lado dos números que a
      // motivaram — ver o comentário da tabela no banco.
      metricas: metricas as unknown as Record<string, unknown>,
      leitura: leitura.trim() || null,
      proximas_acoes: acoes.trim() || null,
    }, { onConflict: 'analise_id,funil_id' });

    setSalvando(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return null;
    }
    const mapa = { ...salvos, [atual.id]: { leitura, proximas_acoes: acoes } };
    setSalvos(mapa);
    ir(mapa);
    return id;
  }

  const irPara = (passo: -1 | 1) => {
    const destino = revs[Math.min(Math.max(0, indice + passo), revs.length - 1)];
    return salvarItem(destino?.id ?? null);
  };

  /**
   * Fecha a rodada. É o marco que separa "estou analisando" de "analisei" — e
   * é o que faz a próxima abertura da tela começar limpa em vez de retomar
   * esta.
   */
  async function fecharRodada() {
    // O id vem do próprio salvar, e não do estado: se a rodada acabou de
    // nascer nesta gravação, `analiseId` ainda é o valor velho desta closure e
    // a tela diria "nada para fechar" logo depois de gravar.
    const id = await salvarItem(null);
    if (!id) {
      toast({ title: 'Nada para fechar', description: 'Nenhuma leitura foi escrita nesta rodada.' });
      return;
    }
    setFechando(true);
    const { error } = await supabase
      .from('analises')
      .update({ fechada_em: new Date().toISOString() })
      .eq('id', id);
    // Conta do banco, não do estado: o item recém-gravado ainda não está em
    // `salvos` nesta closure, e o número do aviso ficaria um a menos.
    const { count } = await supabase
      .from('analise_itens')
      .select('id', { count: 'exact', head: true })
      .eq('analise_id', id);
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
    setAnaliseId(null);
    setDataRodada(null);
    setSalvos({});
    setLeitura('');
    setAcoes('');
    setIndice(0);
  }

  const analisados = useMemo(() => Object.keys(salvos).length, [salvos]);
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
          <p className="text-sm text-muted-foreground">Nenhum REV ativo para analisar.</p>
          <p className="text-xs text-muted-foreground/70">
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
  // Quando os anúncios mal rodaram antes, toda comparação de métrica paga vira
  // "começou a rodar", não "melhorou" ou "piorou".
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
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue /></SelectTrigger>
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
                type="date" className="h-9 w-[9.5rem] text-sm"
                value={janela.inicio} max={janela.fim}
                onChange={e => e.target.value && setJanela(j => ({ ...j, inicio: e.target.value }))}
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="date" className="h-9 w-[9.5rem] text-sm"
                value={janela.fim} min={janela.inicio}
                onChange={e => e.target.value && setJanela(j => ({ ...j, fim: e.target.value }))}
              />
            </div>
          )}

          {/* Escolher o REV direto, sem percorrer um a um. */}
          <Select
            value={atual?.id ?? ''}
            onValueChange={id => { salvarItem(id); }}
          >
            <SelectTrigger className="h-9 w-64 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {revs.map(r => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="inline-flex items-center gap-1.5">
                    {salvos[r.id] && <Check className="h-3 w-3 text-emerald-400" />}
                    {r.projeto ? `${r.projeto} · ` : ''}{r.rev}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            <Button
              size="sm" variant="outline" className="h-9 w-9 p-0"
              onClick={() => irPara(-1)}
              disabled={salvando || fechando || indice === 0}
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
              <Button size="sm" className="h-9 gap-1.5" onClick={() => irPara(1)} disabled={salvando || fechando}>
                {salvando ? 'Salvando…' : 'Salvar e avançar'}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          REV {indice + 1} de {revs.length}
          {analisados > 0 && ` · ${analisados} com leitura escrita`}
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
            <span className="text-xs font-semibold text-muted-foreground">
              {atual?.projeto ?? 'sem projeto'}
            </span>
            <span className="text-base font-semibold">{atual?.rev}</span>
            {salvos[atual?.id ?? ''] && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Check className="h-3 w-3" /> leitura salva
              </span>
            )}
          </div>

          {buscandoMetricas ? (
            <div className="py-16 flex justify-center">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : a && ant ? (
            <>
              {/* O veredito primeiro: é a pergunta que a rodada responde. */}
              <SecaoMetricas
                titulo="Resultado"
                nota={avisoDeBase ?? 'lucro = líquido do produtor − reembolso − imposto − investimento. Custo fixo não entra: é da empresa, não do REV.'}
              >
                <CartaoMetrica rotulo="Lucro" valor={a.lucro} anterior={ant.lucro} formato={formatCurrency} destaque />
                <CartaoMetrica rotulo="Margem" valor={a.margem_pct} anterior={ant.margem_pct} formato={pct} destaque />
                <CartaoMetrica
                  rotulo="ROAS" valor={a.roas} anterior={ant.roas} formato={num2} destaque
                  nota={a.roas != null ? 'investimento é piso: anúncio sem venda fica de fora' : undefined}
                />
                <CartaoMetrica
                  rotulo="CPA (custo por venda)" valor={a.cpa} anterior={ant.cpa} formato={formatCurrency} subirEhRuim
                  nota={a.ticket_medio != null && a.cpa != null && a.cpa > a.ticket_medio
                    ? 'acima do ticket médio'
                    : 'investimento sobre TODAS as vendas do REV, orgânicas inclusas'}
                />
              </SecaoMetricas>

              <SecaoMetricas titulo="Venda">
                <CartaoMetrica rotulo="Vendas" valor={a.vendas} anterior={ant.vendas} formato={formatNumber} />
                <CartaoMetrica rotulo="Faturamento" valor={a.faturamento} anterior={ant.faturamento} formato={formatCurrency} />
                <CartaoMetrica rotulo="Receita (s/ juros)" valor={a.receita} anterior={ant.receita} formato={formatCurrency} />
                <CartaoMetrica rotulo="Ticket médio (AOV)" valor={a.ticket_medio} anterior={ant.ticket_medio} formato={formatCurrency} />
              </SecaoMetricas>

              <SecaoMetricas
                titulo="Tráfego"
                nota={avisoDeBase ?? (a.cobertura_geral_pct != null
                  ? `${a.cobertura_geral_pct}% do gasto da conta está amarrado a algum REV`
                  : undefined)}
              >
                <CartaoMetrica rotulo="Investimento" valor={a.investimento} anterior={ant.investimento} formato={formatCurrency} subirEhRuim />
                <CartaoMetrica rotulo="Impressões" valor={a.impressoes} anterior={ant.impressoes} formato={formatNumber} />
                <CartaoMetrica rotulo="Cliques no link" valor={a.cliques} anterior={ant.cliques} formato={formatNumber} />
                <CartaoMetrica rotulo="Visitas à página" valor={a.visitas} anterior={ant.visitas} formato={formatNumber} />
                <CartaoMetrica rotulo="Checkouts iniciados" valor={a.checkouts_iniciados} anterior={ant.checkouts_iniciados} formato={formatNumber} />
                <CartaoMetrica
                  rotulo="Compras (contagem do Meta)" valor={a.compras_meta} anterior={ant.compras_meta} formato={formatNumber}
                  nota={`nós contamos ${formatNumber(a.vendas)}`}
                />
              </SecaoMetricas>

              {/* Fonte única de propósito: cruzar as nossas vendas com o
                  denominador do pixel já produziu 202,9% de conversão de
                  checkout, e uma queda de 70% que não existia. */}
              <SecaoMetricas
                titulo="Conversão, etapa a etapa"
                nota="tudo medido pelo Meta, do clique à compra — para as etapas serem comparáveis entre si"
              >
                <CartaoMetrica rotulo="Connect rate (clique → página)" valor={a.connect_rate_pct} anterior={ant.connect_rate_pct} formato={pct} />
                <CartaoMetrica rotulo="Página → checkout" valor={a.taxa_checkout_pct} anterior={ant.taxa_checkout_pct} formato={pct2} />
                <CartaoMetrica rotulo="Checkout → compra" valor={a.conv_checkout_pct} anterior={ant.conv_checkout_pct} formato={pct} />
                <CartaoMetrica rotulo="Conversão do funil" valor={a.conv_pagina_pct} anterior={ant.conv_pagina_pct} formato={pct2} destaque />
              </SecaoMetricas>

              <SecaoMetricas titulo="Por etapa" nota={avisoDeBase ?? 'EPC − CPC negativo é escala comprando prejuízo'}>
                <CartaoMetrica rotulo="CPM" valor={a.cpm} anterior={ant.cpm} formato={formatCurrency} subirEhRuim />
                <CartaoMetrica rotulo="CPC (clique)" valor={a.cpc} anterior={ant.cpc} formato={formatCurrency} subirEhRuim />
                <CartaoMetrica rotulo="CPV (visita)" valor={a.cpv} anterior={ant.cpv} formato={formatCurrency} subirEhRuim />
                <CartaoMetrica rotulo="EPC (ganho por clique)" valor={a.epc} anterior={ant.epc} formato={formatCurrency} />
                <CartaoMetrica rotulo="EPC − CPC" valor={a.margem_por_clique} anterior={ant.margem_por_clique} formato={formatCurrency} destaque />
              </SecaoMetricas>

              <SecaoMetricas titulo="Custos e descontos">
                <CartaoMetrica rotulo="Taxa da plataforma" valor={a.taxa_plataforma} anterior={ant.taxa_plataforma} formato={formatCurrency} subirEhRuim />
                <CartaoMetrica rotulo="Imposto estimado" valor={a.imposto} anterior={ant.imposto} formato={formatCurrency} subirEhRuim />
                <CartaoMetrica rotulo="Reembolsos" valor={a.reembolsos} anterior={ant.reembolsos} formato={formatCurrency} subirEhRuim />
                <CartaoMetrica rotulo="Juros de parcelamento" valor={a.juros_plataforma} anterior={ant.juros_plataforma} formato={formatCurrency} subirEhRuim
                  nota="ficam com a plataforma" />
              </SecaoMetricas>

              <SecaoMetricas titulo="Ofertas" nota="adesão sobre as vendas do período">
                <CartaoMetrica rotulo="Order bumps" valor={a.bump_qtd} anterior={ant.bump_qtd} formato={formatNumber} />
                <CartaoMetrica rotulo="Adesão a bump" valor={a.bump_adesao_pct} anterior={ant.bump_adesao_pct} formato={pct} />
                <CartaoMetrica rotulo="Receita de bumps" valor={a.bump_faturamento} anterior={ant.bump_faturamento} formato={formatCurrency} />
                <CartaoMetrica rotulo="Upsells" valor={a.upsell_qtd} anterior={ant.upsell_qtd} formato={formatNumber} />
              </SecaoMetricas>

              <TabelaItens atual={a.itens ?? []} anterior={ant.itens ?? []} />

              {atribuicaoDuvidosa && (
                <p className="text-xs text-amber-400/90 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Contamos {formatNumber(a.vendas)} vendas e o Meta reporta{' '}
                    {formatNumber(a.compras_meta)} compras para os mesmos anúncios — e só{' '}
                    {formatNumber(a.vendas_de_anuncio)} das nossas trazem o anúncio identificado.
                    O que cada fonte chama de venda não bate: leia CPA, EPC e conversão como
                    ordem de grandeza, não como número exato.
                  </span>
                </p>
              )}

              {a.vendas === 0 && (
                <p className="text-xs text-amber-400/90 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Nenhuma venda atribuída a este REV no período — pode ser que o checkout
                  dele ainda não esteja vinculado, em Funis → Checkouts.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground/60 italic">Sem métricas para o período.</p>
          )}

          {/* O que se digita — e só isto. */}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium">O que você lê nisso</label>
              <Textarea
                className="mt-1 h-28 resize-none text-sm"
                placeholder="Ex: todos os OBs caíram a conversão, mas faturamos mais com o combo…"
                value={leitura}
                onChange={e => setLeitura(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium">Próximas ações</label>
              <Textarea
                className="mt-1 h-28 resize-none text-sm"
                placeholder="O que fazer a respeito, em texto livre…"
                value={acoes}
                onChange={e => setAcoes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm" variant="outline" className="h-8"
              onClick={() => salvarItem(null)}
              disabled={salvando || fechando}
            >
              Salvar
            </Button>
            <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <FlaskConical className="h-3 w-3" />
              As métricas ficam gravadas junto com o texto, como retrato do dia — e a leitura
              aparece no Histórico.
            </span>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
