-- A descrição provisória vira definitiva quando o nome chega
--
-- Um estorno de R$ 357,16 do Facebook entrou no cartão em 07/09 e ficou sem
-- categoria. O payload dizia `FACEBK *7DDFW42XQ4`, mas a descrição gravada era
-- "Cartão CS" — e a regra de categorização procura "facebk" na DESCRIÇÃO.
--
-- A causa é uma corrente de três decisões que, isoladas, estão certas:
--
--   1. Quando o lançamento entra antes de a Conta Simples anexar o
--      estabelecimento, o `cs-sync` grava um texto de reserva: "Cartão CS" no
--      cartão, "Sem descrição" na conta corrente.
--   2. O upsert usa `ignoreDuplicates`, de propósito: sem isso, toda madrugada
--      uma transação já revisada voltaria para "pendente".
--   3. Mas a passada 3b do `cs-sync` atualiza `payload_raw` das linhas que já
--      existiam. Então o payload recebe o nome depois, e a descrição fica
--      congelada no texto de reserva.
--
-- É a armadilha 1 outra vez: dois campos dizendo a mesma coisa, e eles
-- divergiram. E a 4 junto — `descricao` é espelho do payload e só tinha carga
-- inicial, nunca atualização.
--
-- Varrido o histórico inteiro do cartão: é o ÚNICO caso real. Outras três
-- linhas divergem só em maiúscula e minúscula (a Conta Simples passou a
-- devolver o nome em caixa alta), o que não muda categorização nenhuma.
--
-- ── O que muda ───────────────────────────────────────────────────────────
--
-- `fn_gravar_payloads` já roda uma vez por sync, exatamente sobre as linhas
-- que ganharam payload novo. Ela passa a promover também a descrição, e SÓ
-- quando a gravada ainda é um dos dois textos de reserva. Descrição escrita à
-- mão ou já correta não é tocada — a condição é literal, não heurística.
--
-- O retorno vira jsonb porque agora são dois números, e somá-los faria o log
-- do `cs-sync` dizer "N payloads" contando linha que não era payload.

-- O tipo de retorno muda, e `CREATE OR REPLACE` nao aceita isso: precisa de
-- DROP antes. Os dois ficam na MESMA migracao, entao nao existe instante em
-- que a funcao nao exista.
DROP FUNCTION IF EXISTS public.fn_gravar_payloads(jsonb);

CREATE FUNCTION public.fn_gravar_payloads(p_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  n_payload int;
  n_desc    int;
begin
  with entrada as (
    select x->>'ref' as ref, x->'payload' as payload
      from jsonb_array_elements(p_linhas) x
  )
  update public.transacoes t
     set payload_raw = e.payload
    from entrada e
   where t.referencia_externa = e.ref
     and t.payload_raw is distinct from e.payload;

  get diagnostics n_payload = row_count;

  /*
    A descrição de reserva cede lugar ao nome de verdade.

    A lista dos dois textos é literal e curta de propósito: ela é o par exato
    dos fallbacks do `cs-sync`, e qualquer coisa mais esperta aqui passaria a
    reescrever descrição que alguém ajustou à mão.
  */
  with entrada as (
    select x->>'ref' as ref, btrim(x->>'descricao') as descricao
      from jsonb_array_elements(p_linhas) x
  )
  update public.transacoes t
     set descricao = e.descricao
    from entrada e
   where t.referencia_externa = e.ref
     and e.descricao is not null
     and e.descricao <> ''
     and e.descricao not in ('Cartão CS', 'Sem descrição')
     and t.descricao in ('Cartão CS', 'Sem descrição');

  get diagnostics n_desc = row_count;

  return jsonb_build_object('payloads', n_payload, 'descricoes', n_desc);
end;
$function$;

COMMENT ON FUNCTION public.fn_gravar_payloads(jsonb) IS
  'Atualiza `payload_raw` e promove a descricao de reserva ("Cartao CS" / '
  '"Sem descricao") quando o nome do estabelecimento chega depois. Devolve '
  '{payloads, descricoes}.';

-- ── A carga inicial, que conserta o passado ──────────────────────────────
--
-- O gatilho acima mantém o presente; esta parte alcança o que já estava
-- gravado. Mesma condição, lendo o nome do próprio payload da linha.
UPDATE public.transacoes t
   SET descricao = btrim(t.payload_raw->>'merchant')
 WHERE t.fonte = 'conta_simples_cartao'
   AND t.descricao in ('Cartão CS', 'Sem descrição')
   AND t.payload_raw->>'merchant' is not null
   AND btrim(t.payload_raw->>'merchant') <> ''
   AND btrim(t.payload_raw->>'merchant') not in ('Cartão CS', 'Sem descrição');

-- E com a descrição certa, a regra que já existe passa a alcançar a linha.
SELECT public.aplicar_regras_categoria();
