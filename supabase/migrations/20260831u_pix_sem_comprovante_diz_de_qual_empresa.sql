-- A fila de comprovantes passa a dizer de qual empresa é cada PIX.
--
-- `cs-sync` já foi consertado para várias contas bancárias; `cs-comprovantes`
-- ficou para trás, e a lacuna só apareceria quando a Aeliss movimentasse a
-- conta dela — na madrugada, sem ninguém olhando.
--
-- O que teria acontecido, nesta ordem:
--
--   1. o PIX da Aeliss entra em `transacoes` com `empresa_id` carimbado;
--   2. a função pega a referência `aeliss_83319848` e pede o comprovante à API
--      da ALASKAN, que responde 404 — id de outra conta;
--   3. a falha é silenciosa: `buscarUm` devolve o motivo e a rodada segue. O
--      PIX volta para a fila amanhã e falha de novo, para sempre.
--
-- E se por acaso funcionasse seria pior: o comprovante entraria em
-- `documentos_fiscais` sem `empresa_id`, e a contabilidade da Aeliss receberia
-- um PDF que o painel diz ser de ninguém.
--
-- A view é a única que sabe a resposta: `transacoes.empresa_id` é carimbado na
-- importação do extrato, e é de lá que a função escolhe a credencial e o
-- carimbo. Derivar pelo slug da conta criaria uma segunda resposta para a mesma
-- pergunta — e as duas divergiriam no dia em que uma conta trocasse de empresa.

create or replace view vw_pix_sem_comprovante as
 SELECT t.referencia_externa,
    t.data,
    t.descricao,
    t.valor,
    t.empresa_id
   FROM transacoes t
     LEFT JOIN comprovantes_buscados c ON c.referencia_externa = t.referencia_externa
  WHERE t.fonte = 'conta_simples'::text
    AND t.valor < 0::numeric
    AND (t.payload_raw ->> 'showReceipt'::text) = 'true'::text
    AND c.referencia_externa IS NULL
  ORDER BY t.data DESC;

comment on view vw_pix_sem_comprovante is
  'Os PIX enviados que ainda nao tem comprovante baixado. `empresa_id` entrou em '
  '31/08/2026: a Conta Simples tem uma credencial POR empresa, e sem saber de quem '
  'e o PIX a funcao nao tem como escolher a chave — nem como carimbar o documento.';
