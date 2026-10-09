-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Duplicata é ENQUANTO sobram dois cards vivos                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- O último item do alerta de cadastro era `AD 084 H03 V01` em "Guia dos
-- Comportamentos". Olhando os dois cards, **não havia nada para arrumar nos
-- dados**:
--
--   2513e165  postado    data_inicio 2025-12-18  avaliado "Não validado"
--   199b8328  ARQUIVADO  data_inicio 2025-11-26  2 linhas de histórico
--
-- E o histórico do segundo diz quem arrumou e quando:
--
--   26/08 22:49  Jessica  fase: edicao -> postado
--   09/09 18:18  Jessica  fase: postado -> arquivado
--
-- Ela tirou o card do quadro em 09/09. Sobrou **um** card vivo. O detector
-- continuava acusando porque agrupava por nome+projeto+tipo_teste sem olhar a
-- fase — ou seja, **ele não reconhecia a própria arrumação que pedia**.
--
-- ── O que estava errado não era o dado: era a pergunta ──────────────────
--
-- Um alerta que não responde à ação que ele mesmo cobra só tem duas saídas:
-- apagar a linha (destrutivo, e jogaria fora as 2 linhas de histórico) ou
-- conviver com um item que nunca sai. Já é a terceira vez nesta série que o
-- problema é esse formato — `parado_recente` (`20260924a`) e o filtro de
-- projeto encerrado (`20261010d`) nasceram da mesma coisa.
--
-- ── Medido antes de mexer, e o número que decide ────────────────────────
--
--   grupos hoje .......................................... 58
--   com 2 ou mais cards VIVOS ............................ 16
--   sairiam ............................................... 42
--   dos quais saem por arquivamento ....................... 42   <- 42 de 42
--   em projeto ativo, hoje ................................. 1
--   em projeto ativo com 2 vivos ........................... 0
--
-- **Nenhum dos 42 sai por outro motivo.** Em todos, alguém arquivou até sobrar
-- um — o par do Guia dos Comportamentos é o 42º caso do mesmo gesto, repetido
-- por uma pessoa 42 vezes sem que o painel contasse nenhuma delas. Quando a
-- operação já resolveu a coisa 42 vezes do mesmo jeito, é o detector que está
-- com a definição errada.
--
-- Os 16 que ficam estão todos em projeto inativo (Segredos das Birras 9,
-- Cosmética Natural 3, Velas Perfeitas 2, GoFluent 2), e por isso a linha de
-- duplicatas do alerta vai a zero — mas pela porta certa: o alerta já filtra
-- `projeto_ativo` desde `20261010d`, e não é esse filtro que está zerando.
--
-- ── Por que na VIEW, e não no alerta ────────────────────────────────────
--
-- A `20261010d` separou FATO (vai na view) de JULGAMENTO (vai no alerta), e
-- este caso é fato. "Projeto encerrado não é trabalho" é opinião sobre
-- prioridade; "este card foi tirado do quadro em 09/09" é um registro que uma
-- pessoa gravou naquela linha. A view responde *"o que está duplicado?"*, e um
-- par em que um foi arquivado **esteve** duplicado e não está mais.
--
-- É a mesma razão pela qual `vw_criativo_sem_veiculacao` filtra
-- `fase = 'postado'` dentro da view, e não no alerta.
--
-- ── O fato não se perde: ele ganha coluna ───────────────────────────────
--
-- `vivos` e `arquivados` entram ao fim do SELECT. Um grupo que ainda tem dois
-- vivos mostra quantos irmãos já foram retirados, e quem for fazer a limpeza
-- dos projetos antigos vê os dois números. `cards` continua querendo dizer
-- *todos*, para não mudar o sentido de coluna que já existe; `excedentes`
-- passa a ser `vivos - 1`, que é quantos ainda há para reconciliar.
--
-- No fim do arquivo: entram ao FIM porque `create or replace view` não
-- renomeia, não reordena e não insere coluna no meio da lista. E é
-- `create or replace`, não `drop` + `create`, de propósito: o teste
-- `o-alerta-de-cadastro-conta-o-que-da-para-arrumar` acha a definição por
-- `/create\s+or\s+replace\s+view\s+public\.vw_producoes_duplicadas/` e usa a
-- ÚLTIMA que casar. Um `create view` sem o "or replace" faria o teste ler
-- silenciosamente a definição de `20261010e` e passar verde sobre SQL velho.
--
-- ── `is distinct from`, e não `<>` ──────────────────────────────────────
--
-- `fase is distinct from 'arquivado'` trata fase nula como VIVA. Com `<>`, uma
-- fase nula viraria nulo, não contaria como viva, e o grupo sumiria do detector
-- — o detector ficaria cego justamente na linha estranha. Hoje não há fase
-- nula; a escolha é para o dia em que houver.

begin;

create or replace view public.vw_producoes_duplicadas
  with (security_invoker = on) as
 WITH c AS (
         SELECT p.id,
            p.projeto_id,
            p.nome,
            p.fase,
            p.tipo_teste,
            p.criado_em,
            p.data_inicio,
            p.video_editado_url,
            p.copy_url,
            p.responsavel_id,
            fn_nome_criativo(p.nome) AS base
           FROM producoes p
          WHERE p.tipo = 'criativo'::text
        ), g AS (
         SELECT c.projeto_id,
            c.base,
            c.tipo_teste,
            count(*) AS cards,
            -- Nulo conta como VIVO: ver o cabeçalho sobre `is distinct from`.
            count(*) FILTER (WHERE c.fase IS DISTINCT FROM 'arquivado'::text) AS vivos,
            count(*) FILTER (WHERE c.fase = 'arquivado'::text) AS arquivados,
            count(DISTINCT c.video_editado_url) AS videos_distintos,
            count(c.video_editado_url) AS com_video,
            count(DISTINCT c.data_inicio) AS datas_distintas,
            min(c.data_inicio) AS primeira_data,
            max(c.data_inicio) AS ultima_data,
            min(c.criado_em) AS primeiro,
            max(c.criado_em) AS ultimo
           FROM c
          GROUP BY c.projeto_id, c.base, c.tipo_teste
         -- DOIS VIVOS, e não dois cards. Arquivar é como a operação resolve
         -- uma duplicata, 42 vezes medidas — o detector passa a reconhecer.
         HAVING count(*) FILTER (WHERE c.fase IS DISTINCT FROM 'arquivado'::text) > 1
        )
 SELECT g.projeto_id,
    o.nome AS projeto,
    COALESCE(o.ativo, false) AS projeto_ativo,
    g.base AS nome_normalizado,
    g.cards,
    -- Quantos ainda há para reconciliar, não quantos já foram retirados.
    g.vivos - 1 AS excedentes,
    g.primeiro::date AS primeiro_criado,
    g.ultimo::date AS ultimo_criado,
        CASE
            WHEN g.videos_distintos > 1 THEN 'videos diferentes'::text
            WHEN g.videos_distintos = 1 AND g.com_video < g.cards THEN 'copia sem video'::text
            WHEN g.videos_distintos = 0 THEN 'nenhum tem video'::text
            ELSE 'mesmo video'::text
        END AS natureza,
    ( SELECT array_agg(c.nome ORDER BY c.criado_em) AS array_agg
           FROM c
          WHERE NOT c.projeto_id IS DISTINCT FROM g.projeto_id AND c.base = g.base AND NOT c.tipo_teste IS DISTINCT FROM g.tipo_teste) AS nomes,
    g.tipo_teste,
    g.datas_distintas,
    g.primeira_data,
    g.ultima_data,
    g.ultima_data - g.primeira_data AS dias_entre_as_datas,
    -- Colunas NOVAS, e por isso no fim: `create or replace` só acrescenta.
    g.vivos,
    g.arquivados
   FROM g
     LEFT JOIN ofertas_editores o ON o.id = g.projeto_id;

comment on view public.vw_producoes_duplicadas is
  'Cards de criativo com o mesmo nome normalizado, projeto e tipo_teste, '
  'ENQUANTO sobram dois ou mais VIVOS: arquivar é como a operação resolve uma '
  'duplicata (medido em 10/10/2026 — 42 dos 58 grupos já tinham sido resolvidos '
  'assim, e o detector não reconhecia nenhum). `cards` conta todos, `vivos` e '
  '`arquivados` separam, e `excedentes` = vivos - 1 é quantos ainda há para '
  'reconciliar. Desarquivar traz o grupo de volta na hora, porque isto é view e '
  'não retrato. NÃO filtra projeto encerrado: esse julgamento é do '
  'fn_alerta_cadastro_a_arrumar.';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros  text := '';
  v_def    text;
  v_n      integer;
  v_volta  integer := -1;   -- sentinela: -1 = a prova de liveness não rodou
  v_fase   text;
  v_ativo  integer;
  v_16     integer;
begin
  v_def := pg_get_viewdef('public.vw_producoes_duplicadas'::regclass, true);

  -- 1. O `security_invoker` sobreviveu ao replace. `create or replace view`
  --    REDEFINE as reloptions, e omitir a opção APAGA a que estava lá — foi
  --    assim que `vw_alertas` e `vw_rev_tendencia` voltaram a ser legíveis por
  --    `anon` em 04/10. Esta é a prova que o CLAUDE.md pede por escrito.
  if not exists (
    select 1 from pg_class
     where oid = 'public.vw_producoes_duplicadas'::regclass
       and reloptions @> array['security_invoker=on']) then
    v_erros := v_erros || 'o security_invoker se perdeu no replace. ';
  end if;

  -- 2. A regra nova está na view, e no HAVING: filtrar no SELECT deixaria o
  --    grupo entrar e depois sair, o que muda `cards` e `natureza`.
  if v_def !~* 'having[\s\S]{0,200}?arquivado' then
    v_erros := v_erros || 'o HAVING nao olha a fase arquivada. ';
  end if;

  -- 3. Nenhum grupo na view tem um vivo só. É a invariante inteira.
  select count(*) into v_n from public.vw_producoes_duplicadas where vivos < 2;
  if v_n > 0 then
    v_erros := v_erros || format('%s grupo(s) na view tem menos de dois vivos. ', v_n);
  end if;

  -- 4. E `excedentes` conta vivos, não cards — senão a tela diria "2 para
  --    reconciliar" num grupo em que um já foi arquivado.
  select count(*) into v_n from public.vw_producoes_duplicadas
   where excedentes <> vivos - 1 or excedentes < 1;
  if v_n > 0 then
    v_erros := v_erros || format('%s grupo(s) com excedentes fora de vivos-1. ', v_n);
  end if;

  -- 5. O detector NÃO zerou: os 16 grupos com dois vivos de verdade continuam.
  --    Sem este caso, um filtro que apagasse a view toda passaria verde nos
  --    anteriores — detector que nunca acha nada não é detector.
  select count(*) into v_16 from public.vw_producoes_duplicadas;
  if v_16 < 10 then
    v_erros := v_erros || format('a view caiu para %s grupos: o filtro comeu demais. ', v_16);
  end if;

  -- 6. O PAR DO GUIA DOS COMPORTAMENTOS saiu, e saiu porque um está arquivado.
  if exists (select 1 from public.vw_producoes_duplicadas
              where nome_normalizado = 'ad 084 h03 v01') then
    v_erros := v_erros || 'o par do Guia dos Comportamentos segue na view. ';
  end if;
  select fase into v_fase from public.producoes
   where id = '199b8328-0e2a-4bfe-b7c9-d16e4e5446ad';
  if v_fase is distinct from 'arquivado' then
    v_erros := v_erros || format('o card 199b8328 esta em %s, e nao arquivado: o par saiu da view pelo motivo errado. ', coalesce(v_fase,'(nulo)'));
  end if;

  -- 7. ARMADILHA 4: isto é view, não retrato. Desarquivar tem de trazer o
  --    grupo de volta SEM carga nenhuma. Provado de verdade — desarquiva,
  --    confere, e a subtransação do bloco EXCEPTION desfaz o update.
  --    Variável local sobrevive ao rollback (é o que o plpgsql garante); linha
  --    de banco não.
  begin
    update public.producoes set fase = 'postado'
     where id = '199b8328-0e2a-4bfe-b7c9-d16e4e5446ad';
    select count(*) into v_volta from public.vw_producoes_duplicadas
     where nome_normalizado = 'ad 084 h03 v01';
    raise exception 'desfazendo de proposito';
  exception when others then
    null;
  end;
  if v_volta = -1 then
    v_erros := v_erros || 'a prova de desarquivamento nao rodou (update barrado por gatilho?). ';
  elsif v_volta <> 1 then
    v_erros := v_erros || format('desarquivar devolveu %s grupo(s), esperava 1: a view nao e viva. ', v_volta);
  end if;

  -- 8. E o rollback funcionou: o card continua arquivado depois da prova.
  select fase into v_fase from public.producoes
   where id = '199b8328-0e2a-4bfe-b7c9-d16e4e5446ad';
  if v_fase is distinct from 'arquivado' then
    v_erros := v_erros || format('a prova 7 deixou o card em %s: o rollback nao desfez. ', coalesce(v_fase,'(nulo)'));
  end if;

  -- 9. O alerta continua de pé e a linha de duplicatas zerou pela porta certa:
  --    nenhum grupo com dois vivos em projeto ativo.
  select count(*) into v_ativo from public.vw_producoes_duplicadas where projeto_ativo;
  if v_ativo > 0 then
    v_erros := v_erros || format('%s duplicata(s) em projeto ativo seguem na fila. ', v_ativo);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: duplicata passou a exigir dois cards vivos. A view foi de 58 para % grupos (nenhum em projeto ativo), o par do Guia dos Comportamentos saiu porque uma pessoa o arquivou em 09/09, e desarquivar o traz de volta na hora.', v_16;
end $prova$;

notify pgrst, 'reload schema';
