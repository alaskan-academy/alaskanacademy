/**
 * A procedência de uma avaliação de criativo: quem pôs o valor que está ali.
 *
 * ── Por que a tela precisa saber disso ─────────────────────────────────────
 *
 * Até 09/10/2026 `producoes.avaliacao` era um texto sem dono. Medido: 2.735
 * cards postados tinham valor, mas `criativo_historico` registrava apenas 583
 * alterações, tocando 393 cards. Ou seja ~2.340 valores nunca passaram pela
 * tela — vieram de uma importação —, e 133 deles diziam "Validado" em cards que
 * **nunca rodaram um anúncio**.
 *
 * Com a régua passando a escrever sozinha, a tela precisa distinguir três
 * coisas que antes eram indistinguíveis:
 *
 *   humano          alguém decidiu. A régua NUNCA sobrescreve — só avisa que
 *                   discorda.
 *   automatico       a régua decidiu e ninguém revisou. É a fila "a revisar".
 *   fora_do_escopo  card que já estava postado ou arquivado quando a régua
 *                   estreou. Ela não opina.
 *
 * O selo não é enfeite: é o que permite olhar a tela e saber se um "Validado"
 * é julgamento ou herança.
 *
 * A coluna, o `check` e o backfill estão em `20261009b`; quem escreve cada
 * valor está na tabela do cabeçalho de `20261009c`.
 */

export type AvaliacaoOrigem = 'humano' | 'automatico' | 'fora_do_escopo';

interface Procedencia {
  rotulo: string;
  selo: string;
  explica: string;
}

/**
 * As cores seguem o que o Financeiro já usa para revisão
 * (`STATUS_LABEL` em `FinanceiroRevisaoPage.tsx`): azul para o que a máquina
 * fez, verde para o que uma pessoa confirmou, cinza para o que está fora.
 *
 * Vermelho fica de fora de propósito — pelo CLAUDE.md ele é a marca e o que se
 * PERDE. "Não revisado" não é prejuízo, é fila.
 */
export const ORIGEM: Record<AvaliacaoOrigem, Procedencia> = {
  automatico: {
    rotulo: 'Auto',
    selo: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    explica: 'A régua decidiu e ninguém revisou ainda. Confirme ou altere.',
  },
  humano: {
    rotulo: 'Confirmado',
    selo: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    explica: 'Alguém decidiu isto. A régua não sobrescreve — no máximo avisa que discorda.',
  },
  fora_do_escopo: {
    rotulo: 'Herdado',
    selo: 'bg-muted/60 text-muted-foreground border-border',
    explica:
      'Veio da importação, antes de a régua existir, e nunca passou por esta tela. '
      + 'A régua não opina sobre cards que já estavam postados em 09/10/2026.',
  },
};

/**
 * O que mostrar para uma procedência.
 *
 * Valor desconhecido NÃO some: aparece cru, em cinza — mesma política de
 * `situacaoDe` em `@/features/ads/situacao`. Se o `check` do banco ganhar um
 * quarto valor, a tela mostra o nome dele em vez de uma célula vazia.
 *
 * NULO é caso legítimo e tem nome: a régua ainda não olhou este card. Acontece
 * com todo criativo entre ser postado e juntar verba — na prática umas duas
 * semanas, que é a defasagem natural do sync da Meta.
 */
export function origemDe(o: string | null | undefined): Procedencia {
  if (!o) {
    return {
      rotulo: 'Aguardando',
      selo: 'bg-muted/40 text-muted-foreground/70 border-border/50',
      explica: 'A régua ainda não olhou este card — ele precisa juntar verba primeiro.',
    };
  }
  return (
    ORIGEM[o as AvaliacaoOrigem] ?? {
      rotulo: o,
      selo: 'bg-muted/60 text-muted-foreground border-border',
      explica: 'Procedência que a tela ainda não conhece.',
    }
  );
}

/**
 * Este card espera o olhar dela?
 *
 * É a MESMA condição que define o escopo da régua no banco
 * (`avaliacao_origem is null or = 'automatico'`, em `20261009c`), e de propósito:
 * o que a máquina pode escrever é exatamente o que ela ainda não confirmou.
 *
 * ── Isto substituiu `isPendente`, que tinha dois defeitos ──────────────────
 *
 * O antigo `isPendente` era `!avaliacao || avaliacao === 'Sem dados'`, mais a
 * exigência de `status_veiculacao` ser 'Rodando' ou vazio. Dois problemas:
 *
 * 1. Ele ADIVINHAVA. "Sem dados" é um veredito legítimo da régua — um criativo
 *    que não gastou um ticket não tem o que ser julgado —, e contá-lo como
 *    pendência faz a pílula crescer justamente quando a automação está
 *    funcionando.
 * 2. Ele misturava marcação com avaliação. `status_veiculacao` é intenção dela
 *    sobre a veiculação; não diz nada sobre a avaliação ter sido revisada.
 *
 * Procedência responde a pergunta certa sem adivinhar nada, e é filtrável no
 * servidor — o que importa numa lista de 3.000 linhas.
 */
export function aRevisar(origem: string | null | undefined): boolean {
  return !origem || origem === 'automatico';
}

/** Os valores de `avaliacao_origem` que a régua pode sobrescrever. */
export const ORIGENS_NO_ESCOPO: readonly (string | null)[] = [null, 'automatico'];

/**
 * A cor do selo de cada nível de avaliação.
 *
 * ── O default não é cosmético ──────────────────────────────────────────────
 *
 * O mapa anterior (`AVAL_COR`, em `AvaliacaoView`) tinha três entradas e não
 * tinha "Escalado" — que existe na tabela de opções desde sempre e em 19 cards.
 * O nível renderizava sem selo desde que nasceu, e ninguém notou porque era
 * raro e digitado à mão.
 *
 * Agora a régua ESCREVE "Escalado". Um nível novo no `crivo_niveis` amanhã
 * chegaria na tela do mesmo jeito, e um mapa sem saída cairia em branco.
 * `corDaAvaliacao` sempre devolve algo.
 */
const COR: Record<string, string> = {
  Escalado: 'bg-primary/10 text-primary border-primary/20',
  Validado: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Não validado': 'bg-red-500/10 text-red-400 border-red-500/20',
  'Sem dados': 'bg-muted/60 text-muted-foreground border-border',
};

export function corDaAvaliacao(v: string | null | undefined): string {
  if (!v) return 'border-border text-muted-foreground';
  return COR[v] ?? 'bg-secondary text-muted-foreground border-border';
}

/** O veredito da régua para um card, como a tela precisa dele. */
export interface Sugestao {
  producao_id: string;
  sugestao: string | null;
  motivo: string;
  no_escopo: boolean;
  decidido_em: string;
}

/**
 * A régua discorda do que está gravado?
 *
 * Só vale a pena dizer quando o valor é HUMANO: num card 'automatico' a régua
 * corrige sozinha na passada seguinte, e avisar ali seria ruído sobre algo que
 * se resolve em uma hora.
 *
 * `sugestao` nula significa que a régua se recusou a decidir — as duas fontes
 * de atribuição discordam. Isso não é discordância com ela, e por isso não
 * acende aviso.
 */
export function reguaDiscorda(
  avaliacao: string | null | undefined,
  origem: string | null | undefined,
  s: Sugestao | undefined,
): boolean {
  if (origem !== 'humano') return false;
  if (!s || s.sugestao === null) return false;
  return s.sugestao !== avaliacao;
}
