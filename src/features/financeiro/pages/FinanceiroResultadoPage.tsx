/**
 * Resultado do mês — a tela que absorveu o Fechamento.
 *
 * O Fechamento respondia "quanto entrou e saiu da conta". Isso continua aqui,
 * mas embaixo, como conciliação: chamar o repasse da Payt de "receita bruta do
 * mês" era prometer uma coisa e entregar outra, porque o dinheiro que cai na
 * conta em setembro é venda de agosto.
 *
 * A conta de verdade está em `../lib/resultado.ts`, com os motivos. Esta
 * arquivo é só a apresentação — e a regra da apresentação é uma só: **cada
 * linha diz de onde veio**. Foi a mistura MUDA de bases que fez a tela antiga
 * mostrar 57,1% de margem contra 3,2% no extrato.
 */
import { paraYmd } from '@/lib/datas';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { AvisoRevisao } from '@/features/financeiro/components/AvisoRevisao';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, ReferenceLine,
} from 'recharts';
import { Download, Info } from 'lucide-react';
import { ehCustoOperacional, CAT_ANUNCIOS, CAT_IMPOSTOS } from '@/features/financeiro/constants';
import {
  agruparCaixa, montarResultado, janelaDeMeses, mesSeguinte,
  type Caixa, type Competencia, type LinhaTransacao, type Resultado,
} from '@/features/financeiro/lib/resultado';

// ─── helpers ─────────────────────────────────────────────────────────────────

const MESES_HISTORICO = 6;
/** Maior que o histórico: a alíquota estimada precisa de meses ANTERIORES ao
 *  mais antigo da janela para achar dois pares (receita, imposto já pago). */
const MESES_BUSCA = MESES_HISTORICO + 3;

function rotuloMes(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}
/**
 * Busca TODAS as linhas, em páginas.
 *
 * O PostgREST corta a resposta num teto de linhas e **não avisa**: devolve 200
 * com menos dados. A janela desta tela tem 9 meses de extrato — 1.248 linhas em
 * 01/09/2026 —, e o corte comeu as transações mais antigas: março e abril
 * apareciam com R$ 0,00 de anúncio e margem de 78,5%, exatamente o defeito que
 * a bandeira `semDadosDeAnuncio` existe para denunciar. Ela não denunciou
 * porque as linhas de anúncio também tinham sumido.
 *
 * A ordem explícita não é enfeite: sem ela o corte escolhe quais linhas trazer,
 * e a resposta muda de execução para execução.
 */
async function buscarTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ linhas: T[]; erro: unknown }> {
  const TAMANHO = 1000;
  const linhas: T[] = [];
  for (let i = 0; ; i++) {
    const { data, error } = await pagina(i * TAMANHO, (i + 1) * TAMANHO - 1);
    if (error) return { linhas, erro: error };
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length < TAMANHO) return { linhas, erro: null };
  }
}

function primeiroDia(mes: string) { return `${mes}-01`; }
function ultimoDia(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return paraYmd(new Date(y, m, 0));
}

// ─── component ───────────────────────────────────────────────────────────────

export default function FinanceiroResultadoPage() {
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<Resultado[]>([]);
  const [custosCat, setCustosCat] = useState<{ categoria: string; total: number }[]>([]);
  /** Só para o aviso de mês sem dado do Meta poder dizer QUANTO está faltando. */
  const [anunciosNoExtrato, setAnunciosNoExtrato] = useState(0);

  const { empresaId } = useFilters();
  const mesAlvo = `${ano}-${String(mes).padStart(2, '0')}`;

  const load = useCallback(async () => {
    setLoading(true);
    const janela = janelaDeMeses(mesAlvo, MESES_BUSCA);
    const inicio = primeiroDia(janela[0]);
    const fim = ultimoDia(mesAlvo);
    /* O imposto DESTE mes sai no mes que vem, entao o extrato precisa ir um mes
       alem — senao um mes ja pago apareceria eternamente como previsto. */
    const fimExtrato = ultimoDia(mesSeguinte(mesAlvo));

    const [fat, trans] = await Promise.all([
      buscarTudo<{ data: string; faturamento_bruto: number; juros_parcelamento: number;
                   receita_tributavel: number; taxa_plataforma: number;
                   perda_reembolso: number; perda_chargeback: number;
                   investimento_meta: number; imposto_meta_ads: number }>(
        (de, ate) => {
          let q = supabase.from('vw_faturamento_liquido')
            .select('data,faturamento_bruto,juros_parcelamento,receita_tributavel,taxa_plataforma,perda_reembolso,perda_chargeback,investimento_meta,imposto_meta_ads')
            .gte('data', inicio).lte('data', fim).order('data').range(de, ate);
          if (empresaId) q = q.eq('empresa_id', empresaId);
          return q;
        }),
      buscarTudo<LinhaTransacao>((de, ate) => {
        let q = supabase.from('transacoes').select('data,valor,categoria')
          .gte('data', inicio).lte('data', fimExtrato)
          .order('data').order('id').range(de, ate);
        if (empresaId) q = q.eq('empresa_id', empresaId);
        return q;
      }),
    ]);
    if (fat.erro || trans.erro) {
      toast({ title: 'Erro ao carregar dados', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const competencia = new Map<string, Competencia>();
    for (const r of fat.linhas) {
      const k = String(r.data).slice(0, 7);
      const c = competencia.get(k) ?? {
        pagoPelosClientes: 0, perdaReembolso: 0, perdaChargeback: 0,
        juros: 0, receita: 0, taxaPayt: 0, investMeta: 0, impostoMeta: 0,
      };
      /* `faturamento_bruto` da view so conta `aprovada`, entao a venda que voltou
         atras nao esta nele. Somando as perdas de volta, o topo da cascata passa
         a ser TUDO que entrou, e cada perda desce uma vez so, com nome. */
      c.perdaReembolso    += Number(r.perda_reembolso ?? 0);
      c.perdaChargeback   += Number(r.perda_chargeback ?? 0);
      c.pagoPelosClientes += Number(r.faturamento_bruto ?? 0)
                           + Number(r.perda_reembolso ?? 0)
                           + Number(r.perda_chargeback ?? 0);
      c.juros             += Number(r.juros_parcelamento ?? 0);
      c.receita           += Number(r.receita_tributavel ?? 0);
      c.taxaPayt += Number(r.taxa_plataforma ?? 0);
      c.investMeta += Number(r.investimento_meta ?? 0);
      c.impostoMeta += Number(r.imposto_meta_ads ?? 0);
      competencia.set(k, c);
    }

    const transacoes = trans.linhas;
    const caixa: Map<string, Caixa> = agruparCaixa(transacoes);

    const doHistorico = janelaDeMeses(mesAlvo, MESES_HISTORICO);
    setLinhas(doHistorico.map(m => montarResultado(m, competencia, caixa, janela)));
    setAnunciosNoExtrato(caixa.get(mesAlvo)?.anunciosPagos ?? 0);

    /* Custos por categoria — as MESMAS exclusões da cascata, senão o gráfico
       diz uma coisa e o total diz outra na mesma tela. Já aconteceu: a versão
       antiga somava toda saída no gráfico e "Reserva de Caixa" aparecia como
       custo. */
    const catMap = new Map<string, number>();
    for (const t of transacoes) {
      if (t.data.slice(0, 7) !== mesAlvo) continue;
      if (!ehCustoOperacional(t)) continue;
      if (!t.categoria || t.categoria === CAT_ANUNCIOS || t.categoria === CAT_IMPOSTOS) continue;
      catMap.set(t.categoria, (catMap.get(t.categoria) ?? 0) + Math.abs(Number(t.valor)));
    }
    setCustosCat(
      Array.from(catMap, ([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total).slice(0, 10),
    );
    setLoading(false);
  }, [mesAlvo, empresaId]);

  useEffect(() => { load(); }, [load]);

  const atual = linhas.find(l => l.mes === mesAlvo) ?? null;
  /* O mês corrente é parcial: faltam dias de venda e de gasto. O imposto
     estimado acompanha sozinho, porque incide sobre a receita DESTE mês — mas
     o resultado ainda é retrato no meio do caminho, e a tela diz isso. */
  const emAndamento = mesAlvo === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const mesOpts = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i, 1).toLocaleDateString('pt-BR', { month: 'long' }),
  })), []);
  const anoOpts = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  function exportar() {
    if (!linhas.length) return;
    const cab = ['Mês', 'Pago pelos clientes', 'Reembolsos', 'Chargebacks', 'Juros', 'Receita', 'Taxa Payt',
      'Investimento Meta', 'Imposto Meta', 'Simples', 'Simples previsto',
      'Custos pagos', 'Resultado', 'Margem %', 'Retiradas dos socios',
      'Sobrou depois das retiradas', 'Impostos e taxas', 'Sem dados do Meta'];
    const corpo = linhas.map(l => [
      l.mes, l.pagoPelosClientes, l.perdaReembolso, l.perdaChargeback, l.juros, l.receita,
      l.taxaPayt, l.investMeta, l.impostoMeta,
      l.simples.valor, l.simples.presumido ? 'sim' : 'não',
      l.custosPagos, l.resultado, l.margem.toFixed(2),
      l.retiradasSocios, l.sobrouDepoisDasRetiradas, l.impostosETaxas,
      l.semDadosDeAnuncio ? 'sim' : 'nao',
    ]);
    const csv = [cab, ...corpo].map(r => r.join(';')).join('\n');
    /* O BOM vai como escape: escrito como caractere, o eslint o acusa de
       espaco irregular — e ele existe para o Excel abrir o CSV em UTF-8. */
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `resultado-${mesAlvo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── render ───────────────────────────────────────────────────────────────

  /** Uma linha da cascata. `fonte` não é enfeite: é o que torna a mistura
   *  legível, e a falta dela foi o defeito da tela antiga.
   *
   *  `pct` é a fatia da RECEITA — nunca do que o cliente pagou. Juros de
   *  parcelamento são da adquirente, e usá-los no denominador achataria todos
   *  os percentuais de um jeito que cresce com o parcelamento: R$ 547 em maio,
   *  R$ 5.403 em agosto. Sempre o MESMO denominador em todas as linhas, senão a
   *  coluna deixa de servir para comparar, que é para o que ela existe. */
  const Linha = ({ rotulo, valor, fonte, nota, negativo, total, pct, subtotal, dentro }: {
    rotulo: string; valor: number; fonte?: string; nota?: React.ReactNode;
    negativo?: boolean; total?: boolean; pct?: boolean; subtotal?: boolean;
    /** Linha que pertence a um bloco: recua, para o saldo do bloco ficar alinhado
     *  com os outros saldos e a cadeia poder ser lida de cima a baixo pela
     *  coluna da esquerda. */
    dentro?: boolean;
  }) => {
    const fatia = pct && atual && atual.receita > 0 ? (valor / atual.receita) * 100 : null;
    return (
      <div className={cn(
        'flex items-baseline justify-between gap-4',
        dentro ? 'py-2 pl-4' : 'py-2.5',
        total ? 'border-t-2 border-border mt-1 pt-3'
              : subtotal ? 'border-t border-b border-border/70 bg-muted/20 -mx-2 px-2'
              : 'border-b border-border/40',
      )}>
        <div className="min-w-0">
          <p className={cn('text-sm', (total || subtotal) && 'font-semibold')}>
            {negativo && <span className="text-muted-foreground mr-1">−</span>}
            {rotulo}
          </p>
          {(fonte || nota) && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
              {fonte && <span className="uppercase tracking-wide">{fonte}</span>}
              {fonte && nota && <span className="mx-1.5">·</span>}
              {nota}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={cn(
            'tabular-nums whitespace-nowrap',
            total ? 'text-xl font-bold' : subtotal ? 'text-sm font-semibold' : 'text-sm',
            total && valor < 0 && 'text-destructive',
            total && valor > 0 && 'text-green-400',
          )}>{formatCurrency(valor)}</p>
          {fatia !== null && (
            <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
              {fatia.toFixed(1)}% da receita
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout title="Financeiro" hideFilters hideTitle>
      <FinanceiroNav />
      <AvisoRevisao inicio={primeiroDia(mesAlvo)} fim={ultimoDia(mesAlvo)} modo="inclui" />

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Select value={String(mes)} onValueChange={v => setMes(Number(v))}>
          <SelectTrigger className="w-[150px] capitalize"><SelectValue /></SelectTrigger>
          <SelectContent>
            {mesOpts.map(m => (
              <SelectItem key={m.value} value={String(m.value)} className="capitalize">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(ano)} onValueChange={v => setAno(Number(v))}>
          <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {anoOpts.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportar} disabled={!linhas.length || loading}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!loading && !atual && (
        <p className="text-sm text-muted-foreground py-12 text-center">
          Sem movimento neste mês.
        </p>
      )}

      {!loading && atual && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            {/* ── a cascata ── */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Resultado do mês
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {atual.semDadosDeAnuncio ? 'margem indisponível' : `margem ${atual.margem.toFixed(1)}%`}
                  {emAndamento && ' · mês em andamento'}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
                Cada linha vem da fonte que sabe aquilo. Venda e anúncio pelo que
                aconteceu no mês; imposto e custo pelo que saiu da conta.
              </p>

              <Linha rotulo="Pago pelos clientes" valor={atual.pagoPelosClientes} fonte="Payt" pct
                     nota="tudo que entrou no mês, inclusive o que depois voltou atrás" />

              {/* Reembolso e chargeback separados de proposito: sao perdas com
                  causas diferentes. Reembolso e o cliente desistindo — mexe em
                  oferta, promessa, entrega. Chargeback e o cliente contestando na
                  operadora — mexe em cobranca, fatura, suporte. Somados, a tela
                  diz "1,4% voltou atras" e nao diz o que fazer. */}
              <Linha rotulo="Reembolsos" valor={atual.perdaReembolso} fonte="Payt" dentro negativo pct
                     nota="o cliente desistiu" />
              <Linha rotulo="Chargebacks" valor={atual.perdaChargeback} fonte="Payt" dentro negativo pct
                     nota="o cliente contestou na operadora" />
              <Linha rotulo="Vendas que voltaram atrás" valor={atual.perdas} subtotal negativo pct />

              <Linha rotulo="Juros de parcelamento" valor={atual.juros} fonte="Payt" dentro negativo pct
                     nota="do comprador para a adquirente — nunca foi da operação" />
              <Linha rotulo="Receita" valor={atual.receita} subtotal
                     nota="é sobre ela que incide o imposto, e é ela o denominador de tudo abaixo" />

              {/* O bloco de impostos e taxas fica JUNTO, para o total ter
                  sentido. Antes o investimento em anúncio ficava no meio deles,
                  e somar linhas separadas por uma grandeza de outra natureza é
                  o tipo de total que ninguém confere. */}
              <Linha rotulo="Taxa da Payt" valor={atual.taxaPayt} fonte="Payt" dentro negativo
                     nota={atual.receita > 0
                       ? `${((atual.taxaPayt / atual.receita) * 100).toFixed(2)}% efetivo`
                       : undefined} />
              <Linha rotulo="Imposto sobre o anúncio" valor={atual.impostoMeta} dentro negativo pct
                     fonte="Meta × alíquota" nota="só existe dentro da fatura do cartão" />
              <Linha
                rotulo="Simples sobre a receita deste mês"
                valor={atual.simples.valor}
                fonte={atual.simples.presumido ? 'previsto' : 'extrato'}
                dentro negativo pct
                nota={atual.simples.presumido
                  ? (atual.simples.pct === null
                      ? 'vence no mês que vem e não há base para estimar'
                      : <>vence em {rotuloMes(mesSeguinte(mesAlvo))} · estimado a {atual.simples.pct.toFixed(2)}%,
                         que foi a alíquota real de {atual.simples.baseMeses.map(rotuloMes).join(' e ')}</>)
                  : <>pago em {rotuloMes(mesSeguinte(mesAlvo))}, que é quando vence</>} />
              {/* Total de DEDUCOES, nao saldo. Leva o sinal para nao ser lido como
                  o que sobrou — ele fica logo acima de um saldo, com o mesmo peso. */}
              <Linha rotulo="Impostos e taxas" valor={atual.impostosETaxas} subtotal pct negativo
                     nota="taxa da Payt + imposto do anúncio + Simples · reembolso não entra: não é taxa" />
              <Linha rotulo="Sobra depois de impostos e taxas"
                     valor={atual.sobraAposImpostos} subtotal />

              <Linha rotulo="Investimento em anúncios" valor={atual.investMeta} fonte="Meta" dentro
                     nota={atual.semDadosDeAnuncio
                       ? <span className="text-destructive">sem dados do Meta neste mês — falta aqui</span>
                       : 'o cartão mistura meses; aqui é o gasto do mês'} negativo pct />
              <Linha rotulo="Demais custos" valor={atual.custosPagos} fonte="extrato" dentro negativo pct
                     nota="sem anúncio, sem imposto, sem retirada de sócio e sem transferência entre contas próprias" />
              <Linha rotulo="Resultado" valor={atual.resultado} total />

              {/* Retirada não é custo da operação: é distribuição do que ela
                  produziu. Fica ABAIXO do resultado para a margem do mês não
                  passar a depender de quanto os sócios sacaram. */}
              <Linha rotulo="Retiradas dos sócios" valor={atual.retiradasSocios} fonte="extrato"
                     dentro negativo pct
                     nota="pró-labore e retirada de lucro — não é custo, é distribuição" />
              <Linha rotulo="Sobrou depois das retiradas"
                     valor={atual.sobrouDepoisDasRetiradas} total />

              {atual.semDadosDeAnuncio && (
                <div className="flex gap-2 mt-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
                  <Info className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                  <p className="text-[11px] text-destructive leading-snug">
                    <strong>Este resultado não fecha.</strong> O extrato mostra{' '}
                    {formatCurrency(anunciosNoExtrato)} de anúncio pagos no mês, mas
                    não há dado do Meta para ele — a maior saída está de fora da
                    conta acima. A série do Meta começa em maio de 2026.
                  </p>
                </div>
              )}

              {atual.simples.presumido && (
                <div className="flex gap-2 mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
                  <Info className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
                  <p className="text-[11px] text-amber-200/90 leading-snug">
                    O imposto deste mês é <strong>presumido</strong> — ainda não foi
                    pago. Quando o pagamento entrar no extrato, esta linha passa a
                    mostrar o valor real sozinha.
                  </p>
                </div>
              )}
            </div>

            {/* ── conciliação com o caixa ── */}
            <div className="flex flex-col gap-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  O mesmo mês, em caixa
                </p>
                <p className="text-[11px] text-muted-foreground mb-3 leading-snug">
                  O que de fato entrou e saiu da conta. A diferença para o
                  resultado acima não é erro: é o dinheiro do mês passado
                  chegando agora, e o deste mês chegando no que vem.
                </p>
                <Linha rotulo="Entrou na conta" valor={atual.caixaEntrou} fonte="extrato" />
                <Linha rotulo="Saiu da conta" valor={atual.caixaSaiu} fonte="extrato"
                       nota="inclusive anúncio e imposto" negativo />
                <Linha rotulo="Resultado em caixa"
                       valor={atual.caixaEntrou - atual.caixaSaiu} total />
                <p className="text-[11px] text-muted-foreground mt-3">
                  Diferença para o resultado do mês:{' '}
                  <span className="tabular-nums font-medium text-foreground">
                    {formatCurrency((atual.caixaEntrou - atual.caixaSaiu) - atual.resultado)}
                  </span>
                </p>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 flex-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Custos por categoria
                </p>
                {custosCat.length === 0
                  ? <p className="text-xs text-muted-foreground">Sem custos no período</p>
                  : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={custosCat} layout="vertical" margin={{ left: 0, right: 16 }}>
                        <XAxis type="number" tickFormatter={v => formatCurrency(v).replace('R$ ', '')} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="categoria" width={130} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => [formatCurrency(v), 'Total']} contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                          {custosCat.map((_, i) => <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
              </div>
            </div>
          </div>

          {/* ── histórico ── */}
          <div className="bg-card border border-border rounded-xl p-4 mb-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {MESES_HISTORICO} meses
            </p>
            {/*
              Mês no vermelho tem de SALTAR aos olhos.

              Medido: com receita de R$ 204 mil e resultado de −R$ 2.013 na mesma
              escala, a barra negativa de junho tinha 2 pixels — ela estava no
              lugar certo, abaixo do zero, e ninguém a via. Posição não bastava;
              o que faltava era COR.

              `--destructive` é o vermelho do que se perde, pela regra do
              CLAUDE.md. E a linha do zero deixa de ser implícita: com barras de
              2 px, ter de adivinhar onde fica o zero é o mesmo que não ver.
            */}
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={linhas.map(l => ({
                label: rotuloMes(l.mes), Receita: l.receita, Resultado: l.resultado,
              }))}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                <Bar dataKey="Receita" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Resultado" radius={[4, 4, 0, 0]}>
                  {linhas.map(l => (
                    <Cell key={l.mes}
                          fill={l.resultado < 0 ? 'hsl(var(--destructive))' : 'hsl(var(--chart-2))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  {['Mês', 'Receita', 'Anúncio', 'Imposto', 'Custos', 'Resultado', 'Margem'].map((h, i) => (
                    <th key={h} className={cn(
                      'px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider',
                      i === 0 ? 'text-left' : 'text-right',
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {linhas.map(l => (
                  <tr key={l.mes} className={cn(
                    'hover:bg-muted/20 transition-colors',
                    l.mes === mesAlvo && 'font-semibold bg-muted/10',
                  )}>
                    <td className="px-4 py-3 capitalize">{rotuloMes(l.mes)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(l.receita)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {l.semDadosDeAnuncio
                        ? <span className="text-destructive" title="Sem dados do Meta neste mês">sem dado</span>
                        : formatCurrency(l.investMeta + l.impostoMeta)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(l.simples.valor)}
                      {l.simples.presumido && l.simples.valor > 0 && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-400">prev.</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(l.custosPagos)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums',
                      l.semDadosDeAnuncio ? 'text-muted-foreground line-through'
                        : l.resultado < 0 ? 'text-destructive' : 'text-green-400')}>
                      {formatCurrency(l.resultado)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {l.semDadosDeAnuncio
                        ? <span className="text-muted-foreground">—</span>
                        : `${l.margem.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
