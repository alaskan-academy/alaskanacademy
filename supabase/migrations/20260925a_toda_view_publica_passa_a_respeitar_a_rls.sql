-- TODA VIEW DO SCHEMA PUBLIC PASSA A RESPEITAR A RLS
--
-- Continuação de 20260924f e g, que fecharam as cinco views que eu tinha
-- mexido. Esta fecha o resto — a varredura que ela pediu depois de ver o
-- tamanho do buraco.
--
-- ── O QUE ESTAVA ABERTO ────────────────────────────────────────────────────
--
-- Uma view roda com os direitos do DONO, não de quem consulta, e passa por fora
-- da RLS das tabelas que lê. Medido como `anon` em 25/09/2026, antes desta
-- migração — 40 views sem `security_invoker`, das quais 29 devolviam linha:
--
--   vw_metricas_meta_nivel     13.952
--   vw_clientes_listagem       12.590   ← a lista de clientes
--   vw_frequencia_clientes     12.590   ← idem, por frequência
--   vw_transacoes_revisao       1.711   ← extrato bancário
--   vw_conciliacao              1.711   ← idem, conciliado
--   vw_vendas_por_utm           1.441
--   vw_faturamento_liquido        728   ← o faturamento da empresa
--   vw_funil                      320
--   vw_comparativo_periodos       260
--   vw_custos_categoria_mes       145
--   … e mais 19
--
-- `anon` não é hipótese: a `VITE_SUPABASE_ANON_KEY` é inlinada no bundle pelo
-- Vite, então a chave está no navegador de qualquer visitante. Um GET em
-- /rest/v1/vw_clientes_listagem devolvia nome, e-mail e telefone de 12.590
-- pessoas.
--
-- ── POR QUE DÁ PARA FECHAR EM LOTE ─────────────────────────────────────────
--
-- Porque foi medido antes: nas que o anônimo alcança, `anon` e `authenticated`
-- liam exatamente o mesmo número de linhas. As policies do projeto são
-- `qual = true TO authenticated`, então ligar o invoker tira o anônimo e não
-- muda nada para quem está logado.
--
-- Não é confiança na teoria: a prova 3 abaixo compara, view por view, o que
-- `authenticated` lia ANTES com o que lê DEPOIS, na mesma transação. Se
-- qualquer uma encolher, a migração inteira volta atrás — e foi o que
-- aconteceu na primeira tentativa, que só por isso não quebrou a tela de saúde
-- dos agendamentos.
--
-- ── É DINÂMICA DE PROPÓSITO ────────────────────────────────────────────────
--
-- Percorre `pg_class` em vez de listar 40 nomes à mão. Lista escrita no código
-- é a terceira armadilha do CLAUDE.md, e aqui ela seria pior que o normal: uma
-- view nova criada entre hoje e a próxima vez que alguém olhar ficaria de fora
-- em silêncio. `src/test/view-nova-nao-fura-a-rls.test.ts` cobre o futuro pelo
-- lado do código; isto cobre o presente pelo lado do banco.
--
-- ── SÓ O QUE O ANÔNIMO CONSEGUE LER ────────────────────────────────────────
--
-- A primeira tentativa fechava as 40 e a prova 3 a derrubou inteira:
-- `vw_saude_agendamentos` ia de 6 linhas para 0 para quem está LOGADO. Ela lê
-- as tabelas do `cron`, que `authenticated` não alcança — precisa mesmo dos
-- direitos do dono.
--
-- E não era exposição: `anon` já apanha um `permission denied` nela, porque lhe
-- falta o GRANT. O mesmo vale para `vw_config_por_empresa`,
-- `vw_dinheiro_sem_empresa`, `vw_ingest_health`, `vw_alertas` e
-- `vw_alertas_por_area` — seis views onde a permissão de tabela já fecha a
-- porta.
--
-- Então o critério é o RISCO MEDIDO, não a propriedade: fecha o que o anônimo
-- consegue ler. Onde o grant já barra, mexer só arriscaria quebrar consumo
-- legítimo sem tirar exposição nenhuma.

DO $varredura$
DECLARE
  v record;
  v_antes jsonb := '{}'::jsonb;
  v_n int;
  v_auth int;
  v_puladas int := 0;
  v_fechadas int := 0;
  v_encolheu text := '';
  v_anon_total int := 0;
BEGIN
  -- ── 1. Retrato do ANTES: quanto cada role lê hoje ────────────────────────
  FOR v IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'v'
       AND NOT coalesce(c.reloptions::text[] && ARRAY['security_invoker=on','security_invoker=true'], false)
     ORDER BY c.relname
  LOOP
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE format('select count(*) from public.%I', v.relname) INTO v_auth;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE; v_auth := -1;
    END;
    /* O anônimo consegue LER esta view? Só entra na varredura quem ele
       alcança — onde o GRANT já barra, mexer não tira exposição e pode quebrar
       consumo legítimo (foi o caso de `vw_saude_agendamentos`). */
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('select count(*) from public.%I', v.relname) INTO v_n;
      RESET ROLE;
      v_antes := v_antes || jsonb_build_object(v.relname, v_auth);
      v_anon_total := v_anon_total + greatest(v_n, 0);
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;   -- barrada para o anônimo: fica de fora, e é dito no fim
      v_puladas := v_puladas + 1;
    END;
  END LOOP;

  IF v_antes = '{}'::jsonb THEN
    RAISE NOTICE 'nenhuma view aberta — nada a fazer';
    RETURN;
  END IF;

  -- ── 2. Fecha ─────────────────────────────────────────────────────────────
  FOR v IN SELECT key AS relname FROM jsonb_each(v_antes) LOOP
    EXECUTE format('alter view public.%I set (security_invoker = on)', v.relname);
    v_fechadas := v_fechadas + 1;
  END LOOP;

  -- ── 3. A PROVA QUE IMPEDE O ESTRAGO: ninguém pode ter encolhido ──────────
  --     Conserto de permissão que seca a tela legítima não é conserto, é outro
  --     defeito — e seria pior, porque some sem erro.
  FOR v IN SELECT key AS relname, value::int AS antes FROM jsonb_each(v_antes) LOOP
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE format('select count(*) from public.%I', v.relname) INTO v_n;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN RESET ROLE; v_n := -1;
    END;
    IF v_n <> v.antes THEN
      v_encolheu := concat_ws(', ', nullif(v_encolheu, ''),
        v.relname || ' (' || v.antes || ' → ' || v_n || ')');
    END IF;
  END LOOP;

  IF v_encolheu <> '' THEN
    RAISE EXCEPTION 'quem esta logado passou a ler MENOS em: % — a migracao volta atras inteira', v_encolheu;
  END IF;

  -- ── 4. E o anônimo parou de ver DADO ─────────────────────────────────────
  --
  --     "Zero linhas" seria a regra óbvia e está errada: view agregada sem
  --     GROUP BY devolve SEMPRE uma linha, mesmo sobre conjunto vazio.
  --     `vw_reembolsos` derrubou a segunda tentativa por isso — e com o
  --     invoker ligado a linha dela vem inteira de zeros e nulos, que é o
  --     comportamento certo.
  --
  --     O invariante que importa não é a contagem: é não sair DADO. Então a
  --     prova olha os valores, e só aceita nulo, zero e falso.
  FOR v IN SELECT key AS relname FROM jsonb_each(v_antes) LOOP
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format($q$
        select count(*) from (
          select jsonb_each(to_jsonb(t.*)) as par from public.%I t
        ) x where (x.par).value not in ('null'::jsonb, '0'::jsonb, 'false'::jsonb, '""'::jsonb)
      $q$, v.relname) INTO v_n;
      RESET ROLE;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'anon ainda ve % valores com dado em %', v_n, v.relname;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege THEN RESET ROLE;  -- negada é o desfecho mais forte
      WHEN OTHERS THEN RESET ROLE; RAISE;
    END;
  END LOOP;

  RAISE NOTICE '% views fechadas · % puladas (o grant ja barra o anonimo) · anon lia % linhas e passa a ler 0 · ninguem logado perdeu linha',
    v_fechadas, v_puladas, v_anon_total;
END
$varredura$;

NOTIFY pgrst, 'reload schema';
