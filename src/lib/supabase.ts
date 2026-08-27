import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Variáveis de ambiente Supabase não configuradas.\n' +
    'Crie um arquivo .env.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.\n' +
    'Consulte o .env.example para referência.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * O resultado de um `select` com relação embutida, tipado à mão.
 *
 * O supabase-js infere o formato do retorno lendo a STRING do `select`. Quando
 * ela traz relações com alias e `!chave_estrangeira`, a inferência desiste e
 * tipa `data` como `GenericStringError` — um tipo de ERRO no lugar dos dados.
 * E toda relação embutida vira array no tipo, mesmo as de muitos-para-um, que o
 * PostgREST devolve como objeto.
 *
 * As duas coisas são erro do tipo, não do código. Conferido contra o banco:
 * `producoes.responsavel` e `perfis.setor` chegam como OBJETO, e as linhas
 * chegam como linhas.
 *
 * Existe para dizer isso UMA vez, com o porquê, em vez de espalhar
 * `as unknown as` mudo pelos arquivos. Se um dia o projeto gerar os tipos do
 * banco (`supabase gen types`), estes dois somem e o compilador passa a
 * conferir de verdade.
 */
export function linhas<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

/** Uma linha só, pelo mesmo motivo. `null` quando não veio nada. */
export function linha<T>(data: unknown): T | null {
  return (data ?? null) as T | null;
}

/** O teto do PostgREST por requisição. Não é escolha nossa. */
const PAGINA = 1000;

/**
 * Todas as linhas, e não as duas primeiras páginas.
 *
 * Três telas buscavam `producoes` com duas chamadas fixas — `range(0, 999)` e
 * `range(1000, 1999)` — e paravam aí. Havia 2.916 cards postados: **916
 * ficavam de fora**, 31% do total, sem nada na tela dizendo que a conta estava
 * incompleta. E como duas delas nem ordenavam, *quais* 916 sumiam mudava a
 * cada carregamento — os mesmos filtros davam números diferentes.
 *
 * Aqui o laço para quando a página vem incompleta, que é a única coisa que
 * prova que acabou. `maximo` existe para uma tabela que cresça demais não
 * travar a aba; quem chama recebe `truncado` e pode dizer isso na tela, em vez
 * de cortar calado.
 *
 * Recebe uma FUNÇÃO que monta a consulta, e não a consulta pronta: um
 * `PostgrestFilterBuilder` só pode ser executado uma vez, então reaproveitá-lo
 * entre páginas devolveria a primeira de novo.
 */
export async function todasAsLinhas<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  maximo = 20000,
): Promise<{ linhas: T[]; truncado: boolean; erro: string | null }> {
  const acc: T[] = [];
  for (let de = 0; de < maximo; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1);
    if (error) return { linhas: acc, truncado: false, erro: error.message };
    const pagina = (data ?? []) as T[];
    acc.push(...pagina);
    if (pagina.length < PAGINA) return { linhas: acc, truncado: false, erro: null };
  }
  return { linhas: acc, truncado: true, erro: null };
}
