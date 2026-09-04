-- A CONTA DE ANUNCIO DIZ DE QUAL BM E
--
-- Duas contas se chamam "Guia do Comportamento - TSL", em BMs diferentes,
-- rodando o mesmo produto em paralelo. Na tela eram duas linhas identicas — e
-- duas linhas identicas numa tela de midia e convite para pausar a campanha
-- errada.
--
-- POR QUE NAO ESCREVER O PREFIXO NO NOME
--
-- `ad_accounts.nome` vem da API da Meta e e sobrescrito a cada descoberta.
-- Prefixo escrito ali sumiria na proxima rodada, sem aviso nenhum.
--
-- POR QUE NAO BUSCAR DA API
--
-- Seria o ideal — `business{name}` responde exatamente isso. Testado com os
-- quatro tokens, um por um: todos devolvem
--   (#100) Requires business_management permission to access the field.
-- Enquanto os tokens nao tiverem esse escopo, o nome da BM nao existe para nos.
--
-- ENTAO: UMA LINHA POR BM, EM TABELA
--
-- Nao e lista no codigo (armadilha 3): esta no banco, editavel, e uma BM nova
-- sem nome cadastrado aparece com o proprio rotulo do secret —
-- "META_ACCESS_TOKEN_5 · Conta X" — feio o bastante para alguem preencher. O
-- defeito se denuncia em vez de sumir.
--
-- As quatro BMs de hoje: Handify (token sem numero), Lumii (_2), Andressa (_3)
-- e Helena (_4).

CREATE TABLE IF NOT EXISTS meta_bms (
  secret     text PRIMARY KEY,
  nome       text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE meta_bms IS
  'Nome legivel de cada Business Manager, por secret do token. Existe porque os '
  'tokens nao tem business_management e a API recusa business{name}. Quando '
  'tiverem, isto vira derivacao e a tabela pode morrer.';

ALTER TABLE meta_bms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_bms_authenticated ON meta_bms;
CREATE POLICY meta_bms_authenticated ON meta_bms
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO meta_bms (secret, nome) VALUES
  ('META_ACCESS_TOKEN',   'Handify'),
  ('META_ACCESS_TOKEN_2', 'Lumii'),
  ('META_ACCESS_TOKEN_3', 'Andressa'),
  ('META_ACCESS_TOKEN_4', 'Helena')
ON CONFLICT (secret) DO UPDATE SET nome = EXCLUDED.nome;

-- O nome composto num lugar so, para o cabecalho e a aba de contas nao
-- divergirem sobre como uma conta se chama.
CREATE OR REPLACE VIEW vw_ad_accounts AS
SELECT a.*,
       b.nome AS bm_nome,
       CASE
         WHEN a.origem_token IS NULL THEN a.nome
         ELSE coalesce(b.nome, a.origem_token) || ' · ' || a.nome
       END AS nome_exibicao
  FROM ad_accounts a
  LEFT JOIN meta_bms b ON b.secret = a.origem_token;

CREATE OR REPLACE FUNCTION public.fn_contas_com_gasto(
  p_inicio date DEFAULT NULL::date,
  p_fim date DEFAULT NULL::date,
  p_empresa uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, nome text, produto text, investimento numeric)
 LANGUAGE sql
 STABLE
AS $function$
  /*
    As contas que gastaram no periodo — e, quando pedido, so as de uma empresa.

    O filtro sai de `m.empresa_id` e nao de `ad_accounts -> projeto -> empresa`
    de proposito: e o mesmo carimbo que `fn_overview` usa para somar a midia. Se
    a lista viesse por um caminho e o total por outro, uma conta poderia aparecer
    no seletor e nao entrar na soma — e ninguem descobriria olhando a tela.

    `nome` vem de `vw_ad_accounts` ja com a BM na frente: duas contas com o
    mesmo nome em BMs diferentes ficavam indistinguiveis no seletor.
  */
  SELECT a.id,
         a.nome_exibicao AS nome,
         a.produto::text,
         round(sum(m.investimento), 2) AS investimento
    FROM metricas_meta m
    JOIN vw_ad_accounts a ON a.id = m.ad_account_id
   WHERE m.nivel = 'campanha'
     AND (p_inicio  IS NULL OR m.data >= p_inicio)
     AND (p_fim     IS NULL OR m.data <= p_fim)
     AND (p_empresa IS NULL OR m.empresa_id = p_empresa)
   GROUP BY a.id, a.nome_exibicao, a.produto
  HAVING sum(m.investimento) > 0
   ORDER BY sum(m.investimento) DESC;
$function$;
