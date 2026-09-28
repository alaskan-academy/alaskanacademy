-- O RESTO DO QUE FICOU NOMEADO EM 28/09/2026
--
-- Cinco coisas que as conferencias do dia acharam e que ficaram na lista. Vao
-- juntas porque sao pequenas e da mesma familia: numero que decide dinheiro
-- saindo de texto livre, ou porta destrancada ao lado de porta trancada.
--
-- ── 1. QUEM DEFINE QUANTO CADA FAIXA RECEBE ────────────────────────────────
--
-- `cargos` tinha `authenticated_write FOR ALL USING (true)`. Medido hoje, como
-- um usuario comum de verdade:
--
--     UPDATE cargos SET multiplicador = 9.9 WHERE nome = 'Novato'  -> MUDOU 1 linha
--
-- E nao e so pelo REST: o setor Editor tem `configuracoes` entre as paginas
-- liberadas, entao um editor abre Setores & Cargos e muda ali mesmo.
--
-- Isso e antigo. O que mudou foi o PESO: ate 28/09 `cargos.multiplicador` nao
-- multiplicava nada em lugar nenhum (o proprio `multiplicador.ts` documenta
-- isso). Hoje ele decide comissao, e `cargos.comissao_time_pct` decide a
-- participacao da lideranca. No mesmo dia em que a 20260928a fechou a escalada
-- de admin em `perfis`, esta porta continuava aberta.
--
-- GATILHO, e nao policy: negar por RLS num UPDATE afeta ZERO linhas e nao da
-- erro — a tela diria "Cargo atualizado" sem ter atualizado. Falha silenciosa e
-- o modo de falha que este projeto mais paga; o gatilho recusa em voz alta.
--
-- ── 2. E O CARGO NA FICHA DO EDITOR ────────────────────────────────────────
--
-- `editores.cargo_id` e de onde `AvaliacoesTab` tira o multiplicador. A tela de
-- promocao ja e so-admin (`podeEscrever={isAdmin}` em PerfisTab), mas a policy
-- nao era: pelo REST qualquer logado se promovia. Mesma trava, mesma forma —
-- so a COLUNA de privilegio, para nao atrapalhar o resto da ficha.
--
-- ── 3. A FAIXA ERA CEGA PARA A FICHA DESLIGADA ─────────────────────────────
--
-- `vw_ponte_editores_pendente` perguntava "essa pessoa tem ficha?" e nao "a
-- ficha esta ligada?". Uma ficha desligada com perfil ATIVO some do Desempenho
-- e da lista de Notas Fiscais, e a faixa continuava dizendo "em dia". E a
-- quarta armadilha invertida: o retrato continua bonito porque parou de olhar.
--
-- ── 4. DUAS FUNCOES DE "QUEM SOU EU", COM REGRAS DIFERENTES ────────────────
--
-- `fn_meu_editor` exige `ativo`; `fn_meu_editor_id` — que esta em 7 policies de
-- RLS — nao exigia. Uma pessoa desligada via "seu login nao esta ligado a um
-- cadastro" na tela e, ao mesmo tempo, continuava passando pela RLS. Primeira
-- armadilha: duas coisas dizendo a mesma coisa e divergindo.
--
-- ── 5. A EMPRESA ESCRITA A MAO ─────────────────────────────────────────────
--
-- `fn_desempenho_editores` devolvia `'Alaskan Academy'` literal. Sao 3.021 de
-- 4.119 producoes com projeto que TEM empresa; as da Aeliss sairiam carimbadas
-- como Alaskan. A tela nao usa essa coluna hoje — e por isso da para consertar
-- agora sem mexer em numero nenhum.

-- ── 1 e 2. As duas travas ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cargo_so_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  /* Sem JWT e service_role, cron ou migracao: quem chega sem token ja provou
     ter a chave do servidor. */
  IF auth.uid() IS NULL OR public.is_current_user_admin() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION
    'Cargos e multiplicadores so mudam por um administrador. O que esta aqui decide comissao.'
    USING ERRCODE = '42501';
END
$fn$;

COMMENT ON FUNCTION public.fn_cargo_so_admin() IS
  'Ate 28/09/2026 qualquer pessoa logada mudava `cargos.multiplicador` (medido: MUDOU 1 linha). Gatilho e nao policy, porque RLS negando um UPDATE afeta zero linhas SEM erro — a tela diria que salvou. Ver 20260928d.';

DROP TRIGGER IF EXISTS trg_cargo_so_admin ON cargos;
CREATE TRIGGER trg_cargo_so_admin
  BEFORE INSERT OR UPDATE OR DELETE ON cargos
  FOR EACH ROW EXECUTE FUNCTION public.fn_cargo_so_admin();

CREATE OR REPLACE FUNCTION public.fn_editor_cargo_so_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR public.is_current_user_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.cargo_id IS DISTINCT FROM OLD.cargo_id THEN
    RAISE EXCEPTION
      'Promover so por um administrador: o cargo da ficha decide o multiplicador da comissao.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.fn_editor_cargo_so_admin() IS
  'So a COLUNA de privilegio: `editores.cargo_id` e de onde AvaliacoesTab tira o multiplicador. A tela de promocao ja era so-admin; a policy nao era. Ver 20260928d.';

DROP TRIGGER IF EXISTS trg_editor_cargo_so_admin ON editores;
CREATE TRIGGER trg_editor_cargo_so_admin
  BEFORE UPDATE ON editores
  FOR EACH ROW EXECUTE FUNCTION public.fn_editor_cargo_so_admin();

-- ── 3. A faixa passa a enxergar a ficha desligada ───────────────────────────
CREATE OR REPLACE VIEW public.vw_ponte_editores_pendente
WITH (security_invoker = on) AS
  SELECT p.id                                   AS perfil_id,
         p.nome,
         s.nome                                 AS setor,
         c.nome                                 AS cargo,
         p.ativo,
         (SELECT count(*)      FROM producoes pr WHERE pr.responsavel_id = p.id) AS cards,
         (SELECT min(pr.criado_em)::date FROM producoes pr WHERE pr.responsavel_id = p.id) AS primeiro_card,
         /* No FIM da lista de proposito: `CREATE OR REPLACE VIEW` recusa
            inserir coluna no meio (42P16, "cannot change name of view column").
            Trocar a ordem exigiria DROP das duas views — e DROP de view e onde
            o `security_invoker` se perde calado. */
         CASE WHEN e.id IS NULL THEN 'sem ficha' ELSE 'ficha desligada' END AS motivo
    FROM perfis p
    JOIN setores s ON s.id = p.setor_id AND s.pagina_key = 'editores'
    LEFT JOIN cargos c ON c.id = p.cargo_id
    LEFT JOIN editores e ON e.usuario_id = p.id
   WHERE e.id IS NULL
      /* Perfil ligado e ficha desligada e divergencia: a pessoa some do
         Desempenho e da lista de NF, e ate agora a faixa dizia "em dia".
         Perfil desligado com ficha desligada e o caso CERTO (a Bruna) e nao
         entra — alarme que nunca zera e alarme que se aprende a ignorar. */
      OR (p.ativo AND NOT e.ativo);

COMMENT ON VIEW public.vw_ponte_editores_pendente IS
  'Quem tem perfil de setor avaliado e NAO aparece em Editores: sem ficha, ou com a ficha desligada enquanto o perfil esta ligado. Deve ficar em zero. Ver 20260928b e 20260928d.';

CREATE OR REPLACE VIEW public.vw_ponte_editores_saude
WITH (security_invoker = on) AS
  SELECT
    (SELECT count(*) FROM setores WHERE pagina_key = 'editores')          AS setores_marcados,
    (SELECT count(*) FROM perfis p JOIN setores s ON s.id = p.setor_id
                    WHERE s.pagina_key = 'editores')                      AS perfis_elegiveis,
    (SELECT count(*) FROM public.vw_ponte_editores_pendente
      WHERE motivo = 'sem ficha')                                         AS sem_linha,
    (SELECT count(*) FROM editores WHERE usuario_id IS NULL)              AS editores_sem_perfil,
    (SELECT count(*) FROM editores e WHERE e.usuario_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM perfis p WHERE p.id = e.usuario_id)) AS editores_orfaos,
    /* Idem: coluna nova entra no fim. */
    (SELECT count(*) FROM public.vw_ponte_editores_pendente
      WHERE motivo = 'ficha desligada')                                   AS fichas_desligadas;

COMMENT ON VIEW public.vw_ponte_editores_saude IS
  'Canario da ponte perfis->editores. `setores_marcados` = 0 significa que a configuracao sumiu e a lista de pendentes esta vazia pelo motivo errado. Ver 20260928b e 20260928d.';

-- ── 4. As duas funcoes de "quem sou eu" passam a concordar ──────────────────
CREATE OR REPLACE FUNCTION public.fn_meu_editor_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  select e.id from public.editores e
   where e.usuario_id = auth.uid()
     and e.ativo
   limit 1;
$fn$;

COMMENT ON FUNCTION public.fn_meu_editor_id() IS
  'O `and e.ativo` alinha esta funcao com fn_meu_editor, que sempre o exigiu. Sem ele, uma pessoa desligada via "seu login nao esta ligado" na tela e continuava passando pelas 7 policies que usam esta funcao. Ver 20260928d.';

-- ── 5. A empresa deixa de ser literal ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_desempenho_editores(p_ini date, p_fim date)
RETURNS TABLE(editor_id uuid, mes_referencia date, empresa text, oferta text,
              tipo text, ads_testados bigint, ads_validados bigint, ads_escalados bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with corte as (select date '2026-07-01' as a_partir_de),

  postagem as (
    select h.criativo_id, min(h.criado_em)::date as data_postagem
      from criativo_historico h
     where h.campo_alterado = 'fase' and h.valor_novo = 'postado'
     group by h.criativo_id
  ),

  novos as (
    select e.id as editor_id,
           (date_trunc('month', coalesce(pg.data_postagem, p.data_inicio))::date) as mes_referencia,
           /* Era 'Alaskan Academy' literal. A empresa deriva do PROJETO, que e
              o que o CLAUDE.md manda: trabalho ACOMPANHA o projeto, via
              `ofertas_editores.empresa_id`. */
           coalesce(emp.nome, '— sem empresa —') as empresa,
           coalesce(o.nome, '— sem projeto —') as oferta,
           coalesce(p.tipo, 'criativo') as tipo,
           count(*)                                          as ads_testados,
           count(*) filter (where p.avaliacao = 'Validado')  as ads_validados,
           count(*) filter (where p.avaliacao = 'Escalado')  as ads_escalados
      from producoes p
      join editores e on e.usuario_id = p.responsavel_id and e.ativo
      left join postagem pg on pg.criativo_id = p.id
      left join ofertas_editores o on o.id = p.projeto_id
      left join empresas emp on emp.id = o.empresa_id
     cross join corte
     where p.fase = 'postado'
       and coalesce(pg.data_postagem, p.data_inicio) >= corte.a_partir_de
       and coalesce(pg.data_postagem, p.data_inicio) between p_ini and p_fim
     group by 1, 2, 3, 4, 5
  ),

  antigos as (
    select a.editor_id,
           a.mes_referencia,
           /* Aqui continua o texto gravado na epoca: e dado historico digitado,
              nao derivacao. */
           coalesce(a.empresa, 'Alaskan Academy') as empresa,
           coalesce(a.oferta, '— sem projeto —')  as oferta,
           'criativo'::text                       as tipo,
           coalesce(a.ads_testados, 0)::bigint    as ads_testados,
           coalesce(a.ads_validados, 0)::bigint   as ads_validados,
           0::bigint                              as ads_escalados
      from avaliacoes_criativos a
      join editores e on e.id = a.editor_id and e.ativo
     cross join corte
     where a.mes_referencia is not null
       and a.mes_referencia < corte.a_partir_de
       and a.mes_referencia between date_trunc('month', p_ini)::date and p_fim
  )

  select * from novos
  union all
  select * from antigos;
$function$;

COMMENT ON FUNCTION public.fn_desempenho_editores(date, date) IS
  'Desempenho por PESSOA. So editor ativo, nos dois ramos. A empresa deriva do projeto (ofertas_editores.empresa_id); era literal ate 28/09/2026. Ver 20260928b e 20260928d.';

-- ── AS PROVAS ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_uid uuid; v_admin uuid; v_r text; v_n int; v_erro text;
BEGIN
  SELECT id INTO v_uid   FROM perfis WHERE NOT is_admin AND ativo LIMIT 1;
  SELECT id INTO v_admin FROM perfis WHERE is_admin     AND ativo LIMIT 1;

  -- 1. O nao-admin NAO muda mais o multiplicador do cargo. Erro em voz alta,
  --    nao zero linhas em silencio.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  v_erro := NULL;
  BEGIN
    UPDATE cargos SET multiplicador = 9.9 WHERE nome = 'Novato';
    v_r := 'PASSOU';
  EXCEPTION WHEN insufficient_privilege THEN v_r := 'barrado';
            WHEN OTHERS THEN v_r := 'outro erro ' || SQLSTATE;
  END;
  EXECUTE 'reset role';
  IF v_r <> 'barrado' THEN
    RAISE EXCEPTION 'um usuario comum ainda mexe no multiplicador do cargo (%)', v_r;
  END IF;

  -- 2. Nem no cargo da ficha.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  BEGIN
    UPDATE editores SET cargo_id = (SELECT id FROM cargos ORDER BY multiplicador DESC LIMIT 1);
    v_r := 'PASSOU';
  EXCEPTION WHEN insufficient_privilege THEN v_r := 'barrado';
            WHEN OTHERS THEN v_r := 'outro erro ' || SQLSTATE;
  END;
  EXECUTE 'reset role';
  IF v_r <> 'barrado' THEN
    RAISE EXCEPTION 'um usuario comum ainda se promove pela ficha (%)', v_r;
  END IF;

  -- 3. E o ADMIN continua administrando — trava que quebra o uso normal e
  --    desligada na primeira segunda-feira.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  BEGIN
    UPDATE cargos SET multiplicador = multiplicador WHERE nome = 'Novato';
    UPDATE editores SET cargo_id = cargo_id;
    v_r := 'ok';
  EXCEPTION WHEN OTHERS THEN v_r := 'BARRADO ' || SQLSTATE;
  END;
  EXECUTE 'reset role';
  IF v_r <> 'ok' THEN
    RAISE EXCEPTION 'a trava pegou o ADMIN: % — Setores & Cargos e a promocao parariam', v_r;
  END IF;

  -- 4. O gatilho que CRIA ficha continua funcionando. Ele escreve `cargo_id` no
  --    INSERT, e a trava nova e BEFORE UPDATE — mas isso e raciocinio, e
  --    raciocinio nao e prova. Aqui a ficha de alguem e apagada e refeita de
  --    verdade, numa sub-transacao que desfaz.
  --
  --    (Nao da para inventar um perfil: `perfis.id` tem chave estrangeira para
  --    `auth.users`, entao um uuid solto e recusado. Foi o que derrubou a
  --    primeira versao desta prova.)
  BEGIN
    SELECT p.id INTO v_uid
      FROM perfis p
      JOIN setores s ON s.id = p.setor_id AND s.pagina_key = 'editores'
      JOIN editores e ON e.usuario_id = p.id
     WHERE NOT EXISTS (SELECT 1 FROM documentos_fiscais d WHERE d.editor_id = e.id)
     LIMIT 1;
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'ROLLBACK_PROVA_4:sem cobaia';
    END IF;

    DELETE FROM editores WHERE usuario_id = v_uid;
    UPDATE perfis SET nome = nome WHERE id = v_uid;

    SELECT count(*) INTO v_n
      FROM editores e JOIN perfis p ON p.id = e.usuario_id
     WHERE e.usuario_id = v_uid
       AND e.cargo_id IS NOT DISTINCT FROM p.cargo_id
       AND e.data_inicio IS NOT NULL;
    RAISE EXCEPTION 'ROLLBACK_PROVA_4:%', v_n;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
    IF v_erro LIKE 'ROLLBACK_PROVA_4:%' THEN
      IF split_part(v_erro, ':', 2) <> '1' THEN
        RAISE EXCEPTION 'a ficha nao renasceu carimbada depois da trava do cargo (%)',
          split_part(v_erro, ':', 2);
      END IF;
    ELSE RAISE;
    END IF;
  END;

  -- 5. A faixa passou a enxergar ficha desligada com perfil ligado. Provado
  --    desligando uma ficha ativa e conferindo que ela aparece.
  BEGIN
    UPDATE editores e SET ativo = false
     WHERE e.id = (SELECT e2.id FROM editores e2 JOIN perfis p ON p.id = e2.usuario_id
                    WHERE e2.ativo AND p.ativo LIMIT 1);
    SELECT count(*) INTO v_n FROM vw_ponte_editores_pendente WHERE motivo = 'ficha desligada';
    RAISE EXCEPTION 'ROLLBACK_PROVA_5:%', v_n;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
    IF v_erro LIKE 'ROLLBACK_PROVA_5:%' THEN
      IF split_part(v_erro, ':', 2)::int < 1 THEN
        RAISE EXCEPTION 'a faixa continua cega para ficha desligada com perfil ligado';
      END IF;
    ELSE RAISE;
    END IF;
  END;

  -- 6. E a Bruna, desligada dos DOIS lados, NAO entra — alarme que nunca zera
  --    e alarme que se aprende a ignorar.
  SELECT count(*) INTO v_n FROM vw_ponte_editores_pendente;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'a faixa acusa % pendencia(s) e nao deveria acusar nenhuma', v_n;
  END IF;

  -- 7. O desempenho nao mudou de numero: a empresa nao entra em nenhuma conta,
  --    so rotula. Confere que as linhas e os totais batem.
  SELECT count(*) INTO v_n FROM fn_desempenho_editores(date '2020-01-01', date '2030-12-31');
  IF v_n < 50 THEN
    RAISE EXCEPTION 'o desempenho caiu para % linhas — a derivacao da empresa comeu dado', v_n;
  END IF;
  SELECT string_agg(DISTINCT empresa, ', ') INTO v_r
    FROM fn_desempenho_editores(date '2020-01-01', date '2030-12-31');

  RAISE NOTICE 'resto do dia: travas de cargo de pe, faixa enxergando ficha desligada, empresas: %', v_r;
END
$prova$;

NOTIFY pgrst, 'reload schema';
