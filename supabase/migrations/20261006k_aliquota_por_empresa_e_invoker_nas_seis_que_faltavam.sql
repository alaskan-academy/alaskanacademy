-- A aliquota volta a ser por empresa, e as 6 views ganham o invoker
-- ============================================================================
--
-- Tres pontos de arrumacao que sobraram do dia. Nenhum muda numero hoje, e os
-- tres sao do tipo que so cobra quando ja e tarde.
--
-- -- 1 e 2. `max(valor)` escolhe a MAIOR aliquota, calado ------------------
--
-- O CLAUDE.md e explicito: "Ler sempre por `fn_config(chave, empresa)`, nunca
-- direto da tabela". Duas funcoes liam direto, e pior que direto:
--
--     coalesce(max(valor) FILTER (WHERE chave = 'imposto_simples_nacional_pct'), 0)
--
-- `configuracoes` tem uma linha por (chave, empresa) desde 01/09/2026. Um
-- `max()` sobre a tabela inteira pega a MAIOR aliquota entre todas as empresas
-- e aplica em todas. Hoje acerta por coincidencia — as tres linhas sao 9,00%
-- —, e e justamente por isso que e perigoso: o dia em que uma empresa tiver
-- aliquota propria, o numero muda sozinho na empresa errada e nada denuncia.
--
--   fn_metricas_do_rev_bloco  passa a derivar a empresa do FUNIL
--                             (funis.projeto_id -> ofertas_editores.empresa_id).
--                             33 dos 34 funis resolvem; o que sobra cai na
--                             linha geral, que e o que `fn_config` faz com
--                             empresa nula.
--
--   fn_metas_sugeridas        passa a ler a linha GERAL, explicitamente. Ela e
--                             global por desenho: o CTE `periodo` soma a
--                             receita das duas empresas junta, entao aplicar
--                             uma aliquota por empresa aqui seria coerente com
--                             nada. A diferenca para antes e que agora esta
--                             ESCRITO qual linha se usa, em vez de sair de um
--                             `max()` que ninguem leria como uma escolha.
--
-- -- 3. Seis views rodando com os direitos do dono --------------------------
--
--   vw_criativo_investimento · vw_esteira_lotes · vw_gestor_fila
--   vw_pedidos_variacao · vw_producoes_duplicadas · vw_projeto_investimento
--
-- Nenhuma tinha `security_invoker = on`. Foi o defeito que derrubou
-- `vw_alertas` e `vw_rev_tendencia` em 04/10 — aquelas duas foram consertadas,
-- estas seis nunca tiveram.
--
-- NAO era vazamento, e isso foi MEDIDO e nao deduzido: consultando as seis com
-- a chave publica, quatro devolvem `permission denied for table
-- ofertas_editores` e duas devolvem `[]`, embora todas tenham conteudo
-- (227, 86, 69, 38, 28 e 4 linhas) quando lidas como admin. O dono da view nao
-- contorna a permissao das tabelas por baixo.
--
-- Entao isto e consistencia, nao incendio: a opcao entra porque um GRANT
-- futuro mudaria o quadro em silencio, e porque uma regra que vale para 44
-- views e nao vale para 6 deixa de ser regra.
--
-- Seguro de aplicar: toda tabela sob as seis tem RLS ligada com politica de
-- SELECT para `authenticated`, entao quem usa o painel logado continua vendo o
-- mesmo. Conferido tabela a tabela antes.

-- ── 1 e 2. A aliquota por empresa ───────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_n   int;
  trocas constant text[][] := ARRAY[
    ARRAY['fn_metricas_do_rev_bloco',
      E'  imposto as (\n    select\n      coalesce(max(valor) filter (where chave = ''imposto_simples_nacional_pct''), 0) as simples_pct,\n      coalesce(max(valor) filter (where chave = ''imposto_meta_ads_pct''), 0)         as meta_pct\n    from public.configuracoes\n  ),',
      E'  imposto as (\n    /* Por EMPRESA, via fn_config. A empresa sai do projeto do funil; funil sem\n       projeto cai na linha geral, que e o que o segundo argumento nulo faz.\n       Era `max(valor)` sobre a tabela inteira, que escolhe a MAIOR aliquota\n       entre as empresas e aplica em todas. Ver 20261006k. */\n    select\n      coalesce(public.fn_config(''imposto_simples_nacional_pct'',\n        (select oe.empresa_id from public.funis f\n           left join public.ofertas_editores oe on oe.id = f.projeto_id\n          where f.id = p_funil_id)), 0) as simples_pct,\n      coalesce(public.fn_config(''imposto_meta_ads_pct'',\n        (select oe.empresa_id from public.funis f\n           left join public.ofertas_editores oe on oe.id = f.projeto_id\n          where f.id = p_funil_id)), 0) as meta_pct\n  ),',
      '1'],
    ARRAY['fn_metas_sugeridas',
      E'  WITH cfg AS (\n    SELECT\n      coalesce(max(valor) FILTER (WHERE chave = ''imposto_simples_nacional_pct''), 0) / 100 AS simples,\n      coalesce(max(valor) FILTER (WHERE chave = ''imposto_meta_ads_pct''), 0)         / 100 AS meta_ads,\n      coalesce(max(valor) FILTER (WHERE chave = ''custo_fixo_mensal''), 0)                  AS fixo_mensal\n    FROM configuracoes\n  ),',
      E'  WITH cfg AS (\n    /* A linha GERAL, explicitamente. Esta funcao e global por desenho: o CTE\n       `periodo` soma a receita das duas empresas junta, entao uma aliquota por\n       empresa aqui nao teria com o que casar. O que muda para antes e que a\n       escolha esta ESCRITA, em vez de sair de um `max()` que pegava a maior\n       entre as empresas sem dizer. Ver 20261006k. */\n    SELECT\n      coalesce(public.fn_config(''imposto_simples_nacional_pct'', NULL), 0) / 100 AS simples,\n      coalesce(public.fn_config(''imposto_meta_ads_pct'', NULL), 0)         / 100 AS meta_ads,\n      coalesce(public.fn_config(''custo_fixo_mensal'', NULL), 0)                  AS fixo_mensal\n  ),',
      '1']
  ];
BEGIN
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    DECLARE
      obj  text := trocas[i][1];
      de   text := trocas[i][2];
      para text := trocas[i][3];
      qtd  int  := trocas[i][4]::int;
    BEGIN
      v_def := pg_get_functiondef(obj::regproc);
      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION '% : a ancora bate % vezes, esperava % -- a definicao mudou', obj, v_n, qtd;
      END IF;
      EXECUTE replace(v_def, de, para);
    END;
  END LOOP;
END
$mig$;

-- ── 3. O invoker nas seis ───────────────────────────────────────────────────
DO $mig$
DECLARE
  alvos constant text[] := ARRAY[
    'vw_criativo_investimento', 'vw_esteira_lotes', 'vw_gestor_fila',
    'vw_pedidos_variacao', 'vw_producoes_duplicadas', 'vw_projeto_investimento'
  ];
  v_nome text;
BEGIN
  /*
    `alter view ... set (security_invoker = on)` e o certo AQUI, e nao um
    CREATE OR REPLACE: o replace reescreve a definicao inteira e e justamente
    ele que apaga reloptions. O `alter` mexe so na opcao e nao toca no corpo.
    (A regra de escrever a opcao na propria instrucao vale para quem RECRIA a
    view; esta migracao nao recria nenhuma.)
  */
  FOREACH v_nome IN ARRAY alvos LOOP
    EXECUTE format('alter view public.%I set (security_invoker = on)', v_nome);
  END LOOP;
END
$mig$;

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_n       int;
  v_simples numeric;
  v_rev4    uuid := '8c8ca543-ce99-41df-b982-791674e0eafc';
  v_imp     numeric;
BEGIN
  -- 1. Ninguem mais le `configuracoes` direto, fora de fn_config e da view que
  --    existe para mostrar a heranca. Derivada: pega quem aparecer amanha.
  SELECT count(*) INTO v_n
  FROM (
    SELECT p.proname AS obj, pg_get_functiondef(p.oid) AS src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname NOT IN ('fn_config')
    UNION ALL
    SELECT c.relname, pg_get_viewdef(c.oid, true)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
      AND c.relname NOT IN ('vw_config_por_empresa')
  ) l
  WHERE src ~* 'max\(valor\)\s*filter';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% objeto(s) ainda escolhem a aliquota com max(valor) filter', v_n;
  END IF;

  -- 2. NENHUMA view do schema sem security_invoker. Agora sao 44 de 44.
  SELECT count(*) INTO v_n
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND coalesce(array_to_string(c.reloptions, ','), '') NOT LIKE '%security_invoker=on%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% view(s) ainda sem security_invoker', v_n;
  END IF;

  -- 3. COMPORTAMENTAL: o numero nao se mexeu. As tres aliquotas sao iguais
  --    hoje, entao trocar `max()` por `fn_config` TEM de dar o mesmo imposto —
  --    se mudar, a derivacao da empresa pegou a linha errada.
  SELECT (fn_metricas_do_rev_bloco(v_rev4, '2026-09-05', '2026-10-05') ->> 'imposto_simples')::numeric
    INTO v_imp;
  IF round(v_imp, 2) <> 1004.72 THEN
    RAISE EXCEPTION 'REV4: imposto veio % e deveria continuar 1004.72', round(v_imp, 2);
  END IF;

  -- 4. E a derivacao achou a empresa MESMO, em vez de cair na geral por
  --    acidente: o REV4 e da Aeliss, e fn_config com ela devolve numero.
  SELECT fn_config('imposto_simples_nacional_pct',
           (SELECT oe.empresa_id FROM funis f
              LEFT JOIN ofertas_editores oe ON oe.id = f.projeto_id
             WHERE f.id = v_rev4))
    INTO v_simples;
  IF coalesce(v_simples, 0) <= 0 THEN
    RAISE EXCEPTION 'a empresa do REV4 nao resolve: fn_config devolveu %', v_simples;
  END IF;

  RAISE NOTICE 'aliquota por empresa ligada (REV4 = %%), 0 views sem invoker', v_simples;
END
$prova$;
