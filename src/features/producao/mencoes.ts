/**
 * Onde uma menção começa e onde ela termina.
 *
 * Existe porque a mesma pergunta era respondida em dois lugares que
 * discordavam: o gatilho `fn_comentario_notifica` decide QUEM avisar lendo o
 * texto, e o comentário na tela decide o que pintar de azul. O segundo parava
 * no primeiro espaço (`/(@\S+)/`), então "@Jessica Maihato" aparecia como
 * "@Jessica" em azul e "Maihato" em texto comum — e quem lia via uma menção à
 * outra Jessica, que era exatamente quem o gatilho também estava avisando.
 *
 * O gatilho não pode chamar isto (é SQL), mas as duas regras passam a dizer a
 * mesma frase: o nome inteiro manda, e o primeiro nome sozinho é o caso de
 * quem digitou na mão.
 */

/** Regex trata ponto, parêntese e afins como sintaxe; nome de gente não. */
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Quebra o texto em pedaços, com as menções inteiras isoladas.
 *
 * Os pedaços que começam com `@` são as menções; o resto é texto comum. Quem
 * chama decide o que fazer com cada um.
 *
 * Os nomes entram do mais longo para o mais curto porque alternativa de regex
 * casa a PRIMEIRA que serve: com "Jessica" listado antes de "Jessica Maihato",
 * o sobrenome ficaria de fora de novo.
 *
 * O `\S+` fecha a lista e segura quem foi digitado na mão e não está no
 * cadastro. Ele leva a pontuação junto — "@fulano," pinta a vírgula também —,
 * e isso fica assim de propósito: o preço é um caractere azul a mais, e a
 * alternativa seria uma lista de pontuação no código para envelhecer sozinha.
 * Quem está no cadastro nem chega nesse ramo.
 */
export function partirMencoes(texto: string, nomes: string[]): string[] {
  const alternativas = [
    ...nomes
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(literal),
    '\\S+',
  ];
  // `split` quebra em TODAS as ocorrências mesmo sem a flag `g`, e o grupo de
  // captura faz as menções voltarem no meio dos pedaços em vez de sumirem.
  return texto.split(new RegExp(`(@(?:${alternativas.join('|')}))`, 'i'));
}

/** Um pedaço devolvido por `partirMencoes` é menção? */
export const ehMencao = (parte: string) => !!parte && parte.startsWith('@');
