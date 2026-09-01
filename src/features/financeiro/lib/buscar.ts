/**
 * Buscar TODAS as linhas do PostgREST, em páginas.
 *
 * ── O defeito que isto existe para impedir ───────────────────────────────
 *
 * O PostgREST corta a resposta num teto de linhas e **não avisa**: devolve 200
 * com menos dados, sem erro, sem cabeçalho que alguém leia. Uma consulta que
 * cabia ontem passa a mentir hoje, quando a base cresce — e o sintoma não é uma
 * tela vazia, é um número plausível e errado.
 *
 * Foi assim no Resultado: a janela de 9 meses tem 1.248 linhas de extrato, o
 * corte comeu as mais antigas, e março e abril apareceram com R$ 0,00 de
 * anúncio e margem de 78,5%. Pior: a bandeira `semDadosDeAnuncio`, que existe
 * exatamente para denunciar anúncio faltando, ficou muda — as linhas de anúncio
 * que ela procura também tinham sumido no corte.
 *
 * Medido em 01/09/2026, Caixa & DRE em modo YTD lia 1.174 transações e recebia
 * 1.000. Como aquela tela SOMA por categoria, o corte não deixava linhas de
 * fora: deixava totais errados.
 *
 * ── Por que paginar, e não subir o teto ─────────────────────────────────
 *
 * `.limit(5000)` seria a terceira armadilha do CLAUDE.md — número no código que
 * envelhece calado, e o dia em que envelhecer volta a este mesmo defeito. A
 * paginação não tem número para envelhecer: ela para quando a página vem
 * incompleta, que é a única prova de que acabou.
 *
 * ── A ordem explícita não é enfeite ─────────────────────────────────────
 *
 * Sem `ORDER BY`, o Postgres devolve as linhas na ordem que quiser, e ela pode
 * mudar entre as páginas — a mesma linha aparecendo duas vezes e outra nenhuma.
 * Quem chama passa a ordem junto com o resto da consulta; sem ela a paginação
 * dá um resultado plausível e diferente a cada execução, que é a pior forma de
 * erro que existe.
 *
 * ── Quando NÃO usar ─────────────────────────────────────────────────────
 *
 * Fila de trabalho que a pessoa percorre — a Revisão — tem teto de propósito, e
 * mostra a contagem real do banco ao lado (`count: 'exact'`). Ali o limite é
 * decisão de produto, não acidente, e o usuário sabe que ele existe. Trocar por
 * paginação carregaria milhares de linhas para uma tela onde ninguém desce
 * além das primeiras.
 */

/** Tamanho da página. Não é um teto: é de quantas em quantas linhas se pede. */
const TAMANHO_DA_PAGINA = 1000;

/**
 * Chama `pagina(de, ate)` repetidamente até vir um lote menor que a página.
 *
 * `pagina` recebe os índices inclusivos do `.range()` do Supabase e devolve a
 * consulta montada — com `.order()` explícito.
 *
 * Devolve o que conseguiu ler MAIS o erro, quando houver: descartar as linhas
 * já lidas junto com o erro trocaria um número errado por uma tela vazia, e
 * quem chama é que decide o que fazer com cada um.
 */
export async function buscarTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ linhas: T[]; erro: unknown }> {
  const linhas: T[] = [];
  for (let i = 0; ; i++) {
    const { data, error } = await pagina(i * TAMANHO_DA_PAGINA, (i + 1) * TAMANHO_DA_PAGINA - 1);
    if (error) return { linhas, erro: error };
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length < TAMANHO_DA_PAGINA) return { linhas, erro: null };
  }
}
