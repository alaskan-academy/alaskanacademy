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
