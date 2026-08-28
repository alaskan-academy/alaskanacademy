/**
 * As contas do Resumo que dependem do recorte — período, conta e segmento.
 *
 * `financeiro.ts` já tinha as contas do resultado (cascata, margem, ROAS). O que
 * ficou de fora, e por isso nunca teve teste, foram as três decisões que dizem
 * QUAIS números entram nessas contas:
 *
 * 1. de que base sai cada imposto,
 * 2. quantos dias o custo fixo cobre,
 * 3. o que é o lucro de um dia.
 *
 * As três moravam soltas dentro do `fetchData` da página, e as três já estiveram
 * erradas ao mesmo tempo. Aqui são funções puras: recebem números e devolvem
 * números, sem saber que Supabase existe.
 */

/**
 * O imposto de um percentual sobre a base que ele realmente incide.
 *
 * Existe porque a página fazia o contrário: pegava o imposto TOTAL do período e
 * o rateava pela participação do recorte no faturamento. Com isso o número
 * deixava de bater com o próprio rótulo na cascata — "Imposto Meta (12.50%)"
 * mostrando R$ 4.687,18 sobre um investimento de R$ 43.915,63, que dá 10,67%.
 *
 * Rateio e percentual são coisas diferentes: o Simples incide sobre a receita
 * DESTE recorte, e o imposto do Meta sobre o gasto DESTE recorte. Nenhum dos
 * dois precisa de rateio, porque a base já é a do recorte.
 */
export function impostoSobre(base: number, pct: number): number {
  return base * (pct / 100);
}

/**
 * Quantos dias o custo fixo do período cobre.
 *
 * Com filtro de data é a extensão dele. Sem filtro — o "Todos" —, a página caía
 * num literal de 30 dias, e o próprio comentário admitia o problema: "todo o
 * histórico custaria vários meses de custo fixo, não um". Agora a extensão sai
 * do dado (primeira e última venda do recorte), e o 30 fica só para o caso em
 * que não há venda nenhuma para medir.
 */
export function diasDoCustoFixo(
  inicio: string | undefined,
  fim: string | undefined,
  diaMin: string | null | undefined,
  diaMax: string | null | undefined,
): number {
  const span = (a?: string | null, b?: string | null) => {
    if (!a || !b) return 0;
    const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime();
    return ms < 0 ? 0 : Math.round(ms / 86_400_000) + 1;
  };
  return span(inicio, fim) || span(diaMin, diaMax) || 30;
}

export interface DiaBruto {
  dia: string;
  faturamento: number;
  vendas: number;
  taxa: number;
  investimento: number;
}

export interface DiaComLucro extends DiaBruto {
  rotulo: string;
  lucro: number;
}

/**
 * O lucro operacional de cada dia, com as mesmas contas do período.
 *
 * A página desenhava uma linha de "lucro estimado" que era o faturamento do dia
 * vezes a margem do período inteiro — a mesma curva multiplicada por uma
 * constante. Ela não podia mostrar um dia no vermelho, que é justamente o dia
 * que se procura num gráfico assim.
 *
 * Este é o de verdade, e fecha: como receita, taxa e gasto de cada dia somam
 * exatamente os totais do período, a soma dos lucros diários é o lucro
 * operacional do topo da tela. Custo fixo fica de fora dos dois, igual.
 *
 * `contarAds` é falso no segmento Back-end, onde não há mídia comprada — e aí o
 * imposto sobre ela zera junto, sem precisar de uma segunda regra.
 */
export function lucroPorDia(
  dias: DiaBruto[],
  opcoes: { simplesPct: number; metaPct: number; contarAds: boolean },
): DiaComLucro[] {
  const { simplesPct, metaPct, contarAds } = opcoes;

  return dias.map(d => {
    const investimento = contarAds ? d.investimento : 0;
    return {
      ...d,
      investimento,
      rotulo: rotuloCurto(d.dia),
      lucro:
        d.faturamento
        - d.taxa
        - impostoSobre(d.faturamento, simplesPct)
        - impostoSobre(investimento, metaPct)
        - investimento,
    };
  });
}

/** `2026-08-07` vira `07/08`. Sem `date-fns` para a função continuar pura e barata. */
function rotuloCurto(ymd: string): string {
  const [, mes, dia] = ymd.split('-');
  return `${dia}/${mes}`;
}
