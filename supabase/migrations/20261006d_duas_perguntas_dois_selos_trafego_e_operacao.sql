-- "O front se paga" eram DUAS perguntas usando um selo so
-- ============================================================================
--
-- `front_se_paga` respondia `faturamento >= investimento`: o faturamento cobre
-- a midia, sem olhar imposto nem taxa. Enquanto a coproducao entrava como
-- receita isso quase nunca discordava do lucro, e os dois conviveram.
--
-- Em 06/10/2026, com a coproducao fora (20261006a), o REV4 na janela de 05/09
-- a 05/10 passou a dizer as duas coisas no MESMO cartao:
--
--     selo verde:  "O front se paga. O upsell aqui e lucro em cima"
--     tres linhas abaixo, no mesmo bloco:
--                  "so front: -R$ 334,93 · margem de -3,1%"
--
-- Faturamento R$ 10.727,82 contra investimento de R$ 8.212,63: o trafego se
-- paga mesmo. Mas imposto (R$ 1.004,72), imposto da midia (R$ 1.149,77) e taxa
-- da plataforma (R$ 695,63) comem a sobra e viram prejuizo.
--
-- Nao era erro de conta. Era um sinalizador so respondendo duas perguntas que
-- vivem em niveis diferentes da operacao — e, como respondia no bruto, dizia
-- "verde" exatamente no caso que o aviso ao lado existe para denunciar.
--
-- -- A separacao ------------------------------------------------------------
--
--   trafego_se_paga   o faturamento cobre a MIDIA. E a pergunta de quem compra
--                     trafego, e se faz no BRUTO: imposto e taxa nao sao
--                     decisao do anuncio, e cobrar isso do criativo nao diz a
--                     ele o que mudar.
--
--   front_se_paga     sobra alguma coisa DEPOIS de midia, imposto e taxa. E a
--                     pergunta da OPERACAO, e e ela que decide se o upsell e
--                     lucro em cima ou muleta — e se escalar aumenta o bolso
--                     ou o buraco.
--
-- Os dois podem discordar, e e quando discordam que a tela tem algo util a
-- dizer: "o trafego esta de pe, o que come o resultado esta em outro lugar" e
-- um diagnostico diferente de "o anuncio nao se paga", e leva a consertos
-- diferentes. Hoje o REV4 e exatamente esse caso.
--
-- -- De quebra, tres copias viram uma -----------------------------------------
--
-- `c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa` estava escrita DUAS
-- vezes (em `lucro_liquido` e em `margem_pct`), e o selo novo seria a terceira.
-- Tres copias da mesma expressao e a primeira armadilha do CLAUDE.md esperando
-- acontecer: bastaria alguem corrigir uma e o painel passaria a dizer margem
-- positiva com lucro negativo.
--
-- Agora ela existe uma vez so, como `u.lucro` no CTE `com_up`, e as tres leem
-- de la. O selo nao PODE discordar do numero que esta embaixo dele.

DO $mig$
DECLARE
  v_def text;
  v_n   int;
  -- (objeto, tipo, de, para, quantas vezes a ancora deve bater)
  trocas constant text[][] := ARRAY[
    -- 1. A expressao do lucro do front passa a existir uma vez so.
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          E'  com_up as (\n    select\n      c.fat + c.fat_up                                                        as fat_total,',
          E'  com_up as (\n    select\n      /* O lucro do FRONT, calculado uma vez so. `lucro_liquido`, `margem_pct` e\n         `front_se_paga` leem daqui. Eram copias da mesma expressao, e copias\n         divergem: ver 20261006d. */\n      c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa                      as lucro,\n      c.fat + c.fat_up                                                        as fat_total,',
          '1'],

    -- 2. e 3. As duas copias passam a ler `u.lucro`. `lucro_liquido` arredonda,
    -- `margem_pct` usa o valor cheio — exatamente como era, para o numero da
    -- tela nao se mexer por causa de refatoracao.
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          '    ''lucro_liquido'',    round(c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa, 2),',
          '    ''lucro_liquido'',    round(u.lucro, 2),',
          '1'],
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          '                          then round(100.0 * (c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa) / c.fat, 1)',
          '                          then round(100.0 * u.lucro / c.fat, 1)',
          '1'],

    -- 4. Um selo vira dois.
    ARRAY['fn_metricas_do_rev_bloco', 'func',
          E'    -- A regra de decisao do modulo, resolvida aqui e nao na tela: front >= 1\n    -- quer dizer que o upsell e lucro; front < 1 quer dizer que o funil esta de\n    -- pe sobre uma perna so.\n    ''front_se_paga'', case when c.inv > 0 then (c.fat >= c.inv) end,',
          E'    -- Duas perguntas, dois niveis, dois selos. Ver 20261006d.\n    --\n    --   trafego_se_paga  o faturamento cobre a MIDIA. A pergunta de quem compra\n    --                    trafego, feita no bruto: imposto e taxa nao sao\n    --                    decisao do anuncio.\n    --   front_se_paga    sobra algo DEPOIS de midia, imposto e taxa. A pergunta\n    --                    da operacao, e e ela que diz se o upsell e lucro em\n    --                    cima ou muleta.\n    --\n    -- Quando discordam, o diagnostico e "o trafego esta de pe e o que come o\n    -- resultado esta em outro lugar" — que leva a um conserto diferente.\n    ''trafego_se_paga'', case when c.inv > 0 then (c.fat >= c.inv) end,\n    ''front_se_paga'',   case when c.inv > 0 then (u.lucro >= 0) end,',
          '1']
  ];
BEGIN
  FOR i IN 1 .. array_length(trocas, 1) LOOP
    DECLARE
      obj  text := trocas[i][1];
      kind text := trocas[i][2];
      de   text := trocas[i][3];
      para text := trocas[i][4];
      qtd  int  := trocas[i][5]::int;
    BEGIN
      v_def := CASE kind
                 WHEN 'view' THEN rtrim(btrim(pg_get_viewdef(obj::regclass, true)), ';')
                 ELSE pg_get_functiondef(obj::regproc)
               END;

      CONTINUE WHEN position(para IN v_def) > 0;

      v_n := (length(v_def) - length(replace(v_def, de, ''))) / length(de);
      IF v_n <> qtd THEN
        RAISE EXCEPTION 'fn_metricas_do_rev_bloco (troca %): a ancora bate % vezes, esperava % -- a definicao mudou',
                        i, v_n, qtd;
      END IF;

      IF kind = 'view' THEN
        EXECUTE 'CREATE OR REPLACE VIEW ' || obj || ' AS ' || replace(v_def, de, para);
      ELSE
        EXECUTE replace(v_def, de, para);
      END IF;
    END;
  END LOOP;
END
$mig$;

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  v_def       text;
  v_n         int;
  v_quebrados int;
  v_discordam int;
  v_rev4      jsonb;
BEGIN
  -- 1. ESTRUTURAL: a expressao do lucro existe UMA vez. Se voltar a duas,
  --    alguem desfez a unificacao e as copias vao divergir de novo.
  v_def := pg_get_functiondef('fn_metricas_do_rev_bloco'::regproc);
  v_n := (length(v_def) - length(replace(v_def,
            'c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa', '')))
         / length('c.fat - c.inv - c.imp_simples - c.imp_meta - c.taxa');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'a expressao do lucro do front aparece % vezes, esperava 1', v_n;
  END IF;

  -- 2. INVARIANTE, em TODO funil com investimento: o selo nao pode discordar
  --    do numero que a tela mostra embaixo dele. Derivado, nao cravado —
  --    continua valendo em qualquer periodo e para funil que ainda nem existe.
  SELECT count(*) INTO v_quebrados
  FROM funis f
  CROSS JOIN LATERAL (SELECT fn_metricas_do_rev_bloco(f.id, '2026-09-05', '2026-10-05') AS j) x
  WHERE (x.j ->> 'investimento')::numeric > 0
    AND ( (x.j ->> 'front_se_paga')::boolean
            IS DISTINCT FROM ((x.j ->> 'lucro_liquido')::numeric >= 0)
       OR (x.j ->> 'trafego_se_paga')::boolean
            IS DISTINCT FROM ((x.j ->> 'faturamento')::numeric
                              >= (x.j ->> 'investimento')::numeric) );
  IF v_quebrados <> 0 THEN
    RAISE EXCEPTION '% funis com selo discordando do proprio numero', v_quebrados;
  END IF;

  -- 3. A separacao SERVE para alguma coisa: existe pelo menos um REV onde os
  --    dois selos discordam. Sem esta, a invariante acima passaria verde numa
  --    migracao que tivesse deixado os dois identicos.
  SELECT count(*) INTO v_discordam
  FROM funis f
  CROSS JOIN LATERAL (SELECT fn_metricas_do_rev_bloco(f.id, '2026-09-05', '2026-10-05') AS j) x
  WHERE (x.j ->> 'investimento')::numeric > 0
    AND (x.j ->> 'trafego_se_paga')::boolean IS DISTINCT FROM (x.j ->> 'front_se_paga')::boolean;
  IF v_discordam = 0 THEN
    RAISE EXCEPTION 'nenhum REV com os dois selos discordando: a separacao nao foi provada';
  END IF;

  -- 4. O caso concreto que motivou tudo: o REV4 tem trafego de pe e front no
  --    vermelho. E o unico lugar com numero cravado, e de proposito.
  v_rev4 := fn_metricas_do_rev_bloco('8c8ca543-ce99-41df-b982-791674e0eafc',
                                     '2026-09-05', '2026-10-05');
  IF (v_rev4 ->> 'trafego_se_paga')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'REV4: o trafego deveria se pagar (fat % >= inv %)',
                    v_rev4 ->> 'faturamento', v_rev4 ->> 'investimento';
  END IF;
  IF (v_rev4 ->> 'front_se_paga')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'REV4: o front NAO se paga (lucro %)', v_rev4 ->> 'lucro_liquido';
  END IF;

  RAISE NOTICE 'REV4: trafego se paga, front nao (lucro %). % REVs com os selos discordando.',
               v_rev4 ->> 'lucro_liquido', v_discordam;
END
$prova$;
