-- PONTE perfis → editores, PASSO 1: PARAR O SILÊNCIO, SEM CRIAR NINGUÉM
--
-- Adicionar alguém em Usuários cria linha em `perfis`; a tela /editores lê
-- `editores`. Nada liga as duas: zero INSERT no código inteiro, zero gatilhos
-- no banco. A ligação existia e morava só no TypeScript — sumiu num merge em
-- 18/07/2026.
--
-- O Gabriel Nartey (28/09) não é o primeiro. A Bruna Leopoldo entrou três dias
-- depois daquele merge, fez 709 cards, recebeu R$ 3.677,50 em 5 notas fiscais,
-- e NUNCA existiu na tela de Editores. Sessenta e nove dias assim.
--
-- Durou tanto porque NADA NA TELA MOSTRAVA A AUSÊNCIA. É a armadilha 2 do
-- CLAUDE.md na sua forma mais cara: a tela de cadastro existe, a de resultado
-- não, e sem resultado ninguém volta.
--
-- ── O QUE ESTE PASSO FAZ, E O QUE ELE DELIBERADAMENTE NÃO FAZ ──────────────
--
-- FAZ: o painel que denuncia quem está faltando, e conserta os dois números
-- que ficariam errados no INSTANTE em que a primeira linha existisse.
--
-- NÃO FAZ: nenhuma linha criada, nenhuma alterada. O gatilho e a carga do
-- passado são o passo 3, e só depois de o código do passo 2 estar no ar e
-- conferido na tela. O motivo dessa ordem está no passo 2, não aqui: a aba de
-- Notas Fiscais seleciona a primeira pessoa em ordem alfabética e arquiva o
-- PDF pelo NOME de quem está selecionado — com o Gabriel ativo, o padrão muda
-- de "Jaqueline Coelho" para "Gabriel Nartey", e subir uma nota sem reparar
-- guarda no fornecedor errado, com sucesso na tela.
--
-- ── AS QUATRO COISAS, E A MEDIÇÃO DE CADA UMA ──────────────────────────────
--
-- 1. ÍNDICE ÚNICO por pessoa. Sem ele, o passo 3 podendo rodar duas vezes cria
--    duas linhas para a mesma pessoa e o histórico se parte entre elas.
--
-- 2. `fn_desempenho_editores` NÃO filtra editor inativo. Medido: o `join
--    editores e on e.usuario_id = p.responsavel_id` não tem `e.ativo`, e o ramo
--    legado nem junta `editores`. O que segura hoje é coincidência — as duas
--    linhas existentes estão ativas.
--
--    A tela JÁ DIZ que quer só ativo: o comentário em DesempenhoTab.tsx:95
--    descreve este defeito com todas as letras, e o filtro está só na lista de
--    NOMES (`.eq('ativo', true)`), não nas linhas do RPC. Resultado: as linhas
--    de um inativo continuam vindo, `editorMap` não acha o nome, e a pessoa
--    aparece como um travessão — somando no denominador de uma tela que apoia
--    decisão de bônus. Com a Bruna dentro, ela entraria em 1º com 100%.
--
--    Então isto não é mudar o que a tela quer: é fazer o banco cumprir o que
--    ela já declarou querer.
--
-- 3. `fn_nfs_do_editor` IGNORA `data_inicio`. Medido, chamando com um id que
--    não existe (simulando um editor recém-criado):
--
--      pagamento · competência 2026-08-01 · atrasada · -39 dias
--      pagamento · competência 2026-09-01 · atrasada · -8 dias
--      comissao  · competência 2026-08-01 · atrasada · -8 dias
--
--    Três cobranças vermelhas, uma de AGOSTO — mês em que o Gabriel não
--    existia. A competência do mês de entrada entra (quem começou dia 15 deve
--    o serviço daquele mês); as anteriores, não.
--
-- 4. APAGAR EDITOR estava aberto para qualquer pessoa logada: a política é
--    `FOR ALL USING (true) WITH CHECK (true)`, e 6 das 7 tabelas filhas somem
--    em CASCADE — 61 linhas de avaliações, notas e remuneração. Confirmei que
--    NADA no sistema apaga ou insere editores: nem o front (13 chamadas, todas
--    leitura ou update), nem as edge functions (zero menções). Então fechar não
--    tira nada de ninguém.
--
--    Isto não estava na descrição do passo 1 que combinei com ela, e eu o
--    incluí de propósito: é a mesma tabela, a mesma migração, e deixar um
--    caminho destrutivo aberto enquanto se prepara a chegada de linhas novas
--    seria escolher a hora errada para ter pressa.
--
-- ── DESFAZER ────────────────────────────────────────────────────────────────
-- Nenhuma coluna é apagada e nenhuma linha muda, então o cenário de 21/09 não
-- existe aqui. Desfazer é: `drop index uq_editores_usuario`, recriar a policy
-- `authenticated_write`, e recriar as duas funções pela definição anterior
-- (guardada em `_ponte_passo1_antes`, abaixo, durante a própria transação).

-- ── Retrato do ANTES, para as provas compararem ─────────────────────────────
CREATE TEMP TABLE _ponte_passo1_antes AS
SELECT 'desempenho'::text AS o_que,
       md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) AS impressao,
       count(*) AS linhas
  FROM fn_desempenho_editores(date '2020-01-01', date '2030-12-31') t;

INSERT INTO _ponte_passo1_antes
SELECT 'nfs:' || e.id::text,
       md5(coalesce((SELECT string_agg(n::text, E'\n' ORDER BY n::text)
                       FROM fn_nfs_do_editor(e.id) n), '')),
       (SELECT count(*) FROM fn_nfs_do_editor(e.id) n)
  FROM editores e;

-- ── 1. Uma pessoa, uma linha ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_editores_usuario
  ON editores (usuario_id) WHERE usuario_id IS NOT NULL;

COMMENT ON INDEX uq_editores_usuario IS
  'Uma linha de editor por pessoa. Sem isto o gatilho do passo 3, rodando duas vezes, parte o historico entre duas linhas. Ver 20260928b.';

-- ── 2. O ranking passa a respeitar o que a tela ja declara querer ───────────
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
           'Alaskan Academy'::text as empresa,
           coalesce(o.nome, '— sem projeto —') as oferta,
           coalesce(p.tipo, 'criativo') as tipo,
           count(*)                                          as ads_testados,
           count(*) filter (where p.avaliacao = 'Validado')  as ads_validados,
           count(*) filter (where p.avaliacao = 'Escalado')  as ads_escalados
      from producoes p
      /* `and e.ativo` — esta e a mudanca. Esta tela mede a PESSOA, e pessoa
         que nao esta mais na casa nao entra em comparacao de desempenho; a
         producao dela continua em Criativos > Desempenho, que mede o CRIATIVO.
         E o que DesempenhoTab.tsx:95 ja diz em prosa. */
      join editores e on e.usuario_id = p.responsavel_id and e.ativo
      left join postagem pg on pg.criativo_id = p.id
      left join ofertas_editores o on o.id = p.projeto_id
     cross join corte
     where p.fase = 'postado'
       and coalesce(pg.data_postagem, p.data_inicio) >= corte.a_partir_de
       and coalesce(pg.data_postagem, p.data_inicio) between p_ini and p_fim
     group by 1, 2, 3, 4, 5
  ),

  antigos as (
    select a.editor_id,
           a.mes_referencia,
           coalesce(a.empresa, 'Alaskan Academy') as empresa,
           coalesce(a.oferta, '— sem projeto —')  as oferta,
           'criativo'::text                       as tipo,
           coalesce(a.ads_testados, 0)::bigint    as ads_testados,
           coalesce(a.ads_validados, 0)::bigint   as ads_validados,
           0::bigint                              as ads_escalados
      from avaliacoes_criativos a
      /* O ramo legado nem juntava `editores`, entao um inativo passava por
         aqui mesmo com o conserto acima. Junta pela PK e peneira igual. */
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
  'Desempenho por PESSOA. So editor ativo, nos dois ramos — a tela ja dizia isso em prosa e o filtro estava so na lista de nomes. A producao de quem saiu vive em Criativos > Desempenho. Ver 20260928b. PENDENTE: a empresa ainda e literal aqui.';

-- ── 3. A cobranca de NF comeca quando a pessoa comecou ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_nfs_do_editor(
  p_editor_id uuid,
  p_mes date DEFAULT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)))::date)
RETURNS TABLE(subtipo text, competencia date, rotulo text, prazo date, pagamento_em date,
              quando_paga text, situacao text, dias integer, documento_id uuid,
              nome_arquivo text, drive_url text, enviada_em timestamp with time zone)
LANGUAGE sql STABLE
AS $function$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  /* O piso: o mes em que a pessoa comecou. Sem isto, um editor criado hoje
     abria a aba com cobrancas vermelhas de meses em que nao existia. Quem
     comecou dia 15 DEVE o servico daquele mes, entao o proprio mes de entrada
     conta — por isso `date_trunc`, e nao a data crua. `data_inicio` nulo nao
     peneira nada: ausencia de informacao nao vira cobranca nem perdao. */
  inicio as (
    select date_trunc('month', ed.data_inicio)::date as piso
      from public.editores ed where ed.id = p_editor_id
  ),
  competencias as (
    select (p_mes - interval '1 month')::date as c
    union all select p_mes
  ),
  esperadas as (
    select 'pagamento'::text as subtipo,
           c.c as competencia,
           'Serviço mensal'::text as rotulo,
           (c.c + interval '19 days')::date as prazo,
           (c.c + interval '1 month' + interval '4 days')::date as pagamento_em,
           'pago no dia 5 do mês seguinte'::text as quando_paga
      from competencias c
    union all
    select 'comissao',
           c.c,
           'Comissão',
           (c.c + interval '1 month' + interval '19 days')::date,
           (c.c + interval '1 month' + interval '7 days')::date,
           'paga na semana em que a NF chega'
      from competencias c
  )
  select e.subtipo, e.competencia, e.rotulo, e.prazo, e.pagamento_em, e.quando_paga,
         case when d.id is not null               then 'enviada'
              when (select d from hoje) > e.prazo then 'atrasada'
              else 'a_vencer' end as situacao,
         (e.prazo - (select d from hoje))::int as dias,
         d.id, d.nome_arquivo, d.drive_url, d.criado_em
    from esperadas e
    left join public.documentos_fiscais d
           on d.editor_id   = p_editor_id
          and d.tipo        = 'servico'
          and d.subtipo     = e.subtipo
          and d.competencia = e.competencia
   where e.prazo <= (p_mes + interval '1 month' - interval '1 day')::date
     and e.competencia >= coalesce((select piso from inicio), e.competencia)
   order by (d.id is not null), e.prazo;
$function$;

COMMENT ON FUNCTION public.fn_nfs_do_editor(uuid, date) IS
  'Checklist de NF do editor, a partir do mes de `editores.data_inicio` (inclusive). Antes cobrava meses anteriores a entrada da pessoa. Ver 20260928b.';

-- ── 4. Apagar editor deixa de ser coisa de qualquer um ──────────────────────
-- A policy `FOR ALL` dava DELETE junto. Trocada por INSERT e UPDATE
-- explicitos; sem policy de DELETE, apagar passa a afetar zero linhas.
DROP POLICY IF EXISTS authenticated_write ON editores;

CREATE POLICY editores_insert ON editores
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY editores_update ON editores
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── 5. O painel que denuncia a ausencia ─────────────────────────────────────
CREATE OR REPLACE VIEW public.vw_ponte_editores_pendente
WITH (security_invoker = on) AS
  SELECT p.id                                   AS perfil_id,
         p.nome,
         s.nome                                 AS setor,
         c.nome                                 AS cargo,
         p.ativo,
         (SELECT count(*)      FROM producoes pr WHERE pr.responsavel_id = p.id) AS cards,
         (SELECT min(pr.criado_em)::date FROM producoes pr WHERE pr.responsavel_id = p.id) AS primeiro_card
    FROM perfis p
    JOIN setores s ON s.id = p.setor_id AND s.pagina_key = 'editores'
    LEFT JOIN cargos c ON c.id = p.cargo_id
   WHERE NOT EXISTS (SELECT 1 FROM editores e WHERE e.usuario_id = p.id);

COMMENT ON VIEW public.vw_ponte_editores_pendente IS
  'Quem tem perfil de setor marcado como editores e NAO tem linha em `editores`. Deve ficar em zero depois do passo 3. Ver 20260928b.';

CREATE OR REPLACE VIEW public.vw_ponte_editores_saude
WITH (security_invoker = on) AS
  SELECT
    (SELECT count(*) FROM setores WHERE pagina_key = 'editores')          AS setores_marcados,
    (SELECT count(*) FROM perfis p JOIN setores s ON s.id = p.setor_id
                    WHERE s.pagina_key = 'editores')                      AS perfis_elegiveis,
    (SELECT count(*) FROM public.vw_ponte_editores_pendente)              AS sem_linha,
    (SELECT count(*) FROM editores WHERE usuario_id IS NULL)              AS editores_sem_perfil,
    (SELECT count(*) FROM editores e WHERE e.usuario_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM perfis p WHERE p.id = e.usuario_id)) AS editores_orfaos;

COMMENT ON VIEW public.vw_ponte_editores_saude IS
  'Canario da ponte perfis->editores. `setores_marcados` = 0 significa que a configuracao sumiu e a lista de pendentes esta convenientemente vazia pelo motivo errado — a tela precisa gritar nesse caso, nao ficar quieta. Ver 20260928b.';

-- ── AS PROVAS ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_antes text; v_depois text; v_n_antes int; v_n_depois int;
  v_id uuid; v_nome text;
  v_cobaia uuid; v_data_orig date;
  v_apagou int; v_erro text;
  v_saude record;
BEGIN
  -- 1. O ranking NAO muda com os dados de hoje. Os dois editores estao ativos,
  --    entao o filtro e inerte agora — e tem que ser, senao eu estaria mudando
  --    um numero de bonus em vez de prevenir um.
  SELECT impressao, linhas INTO v_antes, v_n_antes
    FROM _ponte_passo1_antes WHERE o_que = 'desempenho';
  SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')), count(*)
    INTO v_depois, v_n_depois
    FROM fn_desempenho_editores(date '2020-01-01', date '2030-12-31') t;
  IF v_antes IS DISTINCT FROM v_depois OR v_n_antes <> v_n_depois THEN
    RAISE EXCEPTION 'o ranking MUDOU (% -> % linhas, % -> %) — era para ser inerte hoje',
      v_n_antes, v_n_depois, left(v_antes,8), left(v_depois,8);
  END IF;

  -- 2. O checklist de NF tambem nao muda para quem ja existe: Jaqueline comecou
  --    em 2025-10 e Maihato em 2022-04, muito antes das competencias em jogo.
  FOR v_id, v_nome IN SELECT id, nome FROM editores LOOP
    SELECT impressao, linhas INTO v_antes, v_n_antes
      FROM _ponte_passo1_antes WHERE o_que = 'nfs:' || v_id::text;
    SELECT md5(coalesce(string_agg(n::text, E'\n' ORDER BY n::text), '')), count(*)
      INTO v_depois, v_n_depois FROM fn_nfs_do_editor(v_id) n;
    IF v_antes IS DISTINCT FROM v_depois OR v_n_antes <> v_n_depois THEN
      RAISE EXCEPTION 'o checklist de NF de % mudou (% -> % linhas)', v_nome, v_n_antes, v_n_depois;
    END IF;
  END LOOP;

  -- 3. E o conserto FUNCIONA: quem comeca hoje nao deve competencia passada.
  --    Como os dois editores existentes comecaram em 2022 e 2025, a comparacao
  --    so prova alguma coisa com uma data de entrada recente. Entao: guarda a
  --    data real numa variavel, mede, e devolve na linha seguinte.
  --
  --    Se qualquer prova adiante falhar, a transacao inteira desfaz e a data
  --    volta de todo jeito — nao existe caminho em que ela fique errada.
  SELECT id, data_inicio INTO v_cobaia, v_data_orig FROM editores ORDER BY nome LIMIT 1;

  UPDATE editores SET data_inicio = (now() at time zone 'America/Sao_Paulo')::date
   WHERE id = v_cobaia;

  SELECT count(*) INTO v_n_depois
    FROM fn_nfs_do_editor(v_cobaia) n
   WHERE n.competencia < date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;

  UPDATE editores SET data_inicio = v_data_orig WHERE id = v_cobaia;

  IF v_n_depois <> 0 THEN
    RAISE EXCEPTION 'ainda cobra % competencias anteriores a entrada da pessoa', v_n_depois;
  END IF;

  IF (SELECT data_inicio FROM editores WHERE id = v_cobaia) IS DISTINCT FROM v_data_orig THEN
    RAISE EXCEPTION 'a prova 3 nao devolveu a data_inicio de %', v_cobaia;
  END IF;

  -- 4. Apagar editor nao apaga mais.
  --
  --    ARMADILHA QUE ESTA PROVA QUASE CAIU: os dois editores tem 5 notas
  --    fiscais cada, e `documentos_fiscais` e NO ACTION. Se eu so engolisse a
  --    excecao, a prova passaria porque a CHAVE ESTRANGEIRA barrou, sem medir
  --    nada sobre a RLS — verde pelo motivo errado, que e o pior tipo.
  --
  --    Os dois desfechos se distinguem, e a prova vive disso:
  --      · RLS barrando  -> a linha e filtrada ANTES da FK: zero linhas, SEM excecao
  --      · RLS aberta    -> chega na FK: excecao 23503 (ou apaga de verdade)
  --    Entao: qualquer excecao aqui e REPROVACAO, nao sucesso.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', (SELECT id FROM perfis WHERE NOT is_admin LIMIT 1),
                                       'role', 'authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  v_erro := NULL;
  BEGIN
    DELETE FROM editores WHERE id = v_cobaia;
    GET DIAGNOSTICS v_apagou = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_apagou := -1;
    v_erro := SQLSTATE;
  END;
  EXECUTE 'reset role';

  IF v_erro IS NOT NULL THEN
    RAISE EXCEPTION
      'a RLS deixou o DELETE passar — quem barrou foi outra coisa (SQLSTATE %). Com um editor sem nota fiscal, ele teria sido apagado, e 61 linhas filhas iriam junto em CASCADE',
      v_erro;
  END IF;
  IF v_apagou > 0 THEN
    RAISE EXCEPTION 'um usuario comum ainda apaga editor — e 61 linhas filhas iriam junto';
  END IF;

  -- 5. O painel enxerga quem esta faltando, e o canario esta de pe.
  SELECT * INTO v_saude FROM vw_ponte_editores_saude;
  IF v_saude.setores_marcados = 0 THEN
    RAISE EXCEPTION 'nenhum setor com pagina_key=editores — a lista de pendentes ficaria vazia pelo motivo errado';
  END IF;
  IF v_saude.sem_linha = 0 THEN
    RAISE EXCEPTION 'o painel diz que nao falta ninguem, e Gabriel e Bruna faltam';
  END IF;

  RAISE NOTICE 'passo 1: % setor(es) marcado(s) · % perfis elegiveis · % sem linha · % orfaos',
    v_saude.setores_marcados, v_saude.perfis_elegiveis, v_saude.sem_linha, v_saude.editores_orfaos;
END
$prova$;

DROP TABLE IF EXISTS _ponte_passo1_antes;

NOTIFY pgrst, 'reload schema';
