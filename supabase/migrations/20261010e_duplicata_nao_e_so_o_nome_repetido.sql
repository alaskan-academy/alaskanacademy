-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Duplicata não é só o nome repetido                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `vw_producoes_duplicadas` agrupa por `(projeto_id, fn_nome_criativo(nome))` e
-- chama o excedente de duplicata. Revisados um a um os 6 que sobravam em
-- projeto ativo (10/10/2026), **nenhum era duplicata**:
--
--   AD 009 H03 V03   3 cards   Vertical 16/04 · Novo 24/03 · Horizontal 07/04
--   AD 009 H02 V03   2 cards   Novo 24/03 · Horizontal 27/02
--   AD 009 H02 V04   2 cards   Horizontal 27/02 postado · Iteração 03/06 arquivado
--   AD 009 H03 V04   2 cards   Horizontal 07/04 postado · Iteração 03/06 arquivado
--   AD 019 H01 V07   2 cards   Vertical 25/04 postado · Iteração 03/06 arquivado
--   AD 084 H03 V01   2 cards   Novo 18/12 postado · Novo 26/11 arquivado
--
-- São o MESMO criativo testado de jeitos diferentes — horizontal, vertical,
-- nova versão, iteração —, cada um com sua `data_inicio`, separadas por semanas
-- ou meses. O nome do AD é o código da peça; `tipo_teste` é o que diz qual
-- teste é aquele. Agrupar só pelo nome junta coisas que a operação criou de
-- propósito separadas.
--
-- ── O tamanho do erro, medido ────────────────────────────────────────────
--
--   chave de hoje (projeto + nome) .......... 69 grupos, 74 excedentes, 6 ativos
--   com `tipo_teste` na chave ............... 58 grupos, 62 excedentes, 1 ativo
--   com `tipo_teste` e `data_inicio` ........  7 grupos,  8 excedentes, 0 ativos
--
-- ── Por que `tipo_teste` entra e `data_inicio` NÃO ───────────────────────
--
-- `tipo_teste` é IDENTIDADE: ele existe exatamente para dizer "este é o mesmo
-- criativo rodando de outro jeito". Dois cards com o mesmo nome e tipos de
-- teste diferentes não são cópia um do outro, são duas linhas de teste.
--
-- `data_inicio` é ATRIBUTO. Pô-la na chave zeraria o detector — e zeraria pelo
-- motivo errado: um duplo cadastro em que alguém corrigiu a data num dos dois
-- deixaria de ser visto. Detector que não acha nada não é detector; é um campo
-- a menos para ninguém olhar.
--
-- O que sobra com a chave nova em projeto ativo é 1 grupo, e ele é ambíguo de
-- verdade: `AD 084 H03 V01`, os dois "Novo", mas com início em 26/11 e 18/12 e
-- fases diferentes — parece reteste, não cópia. Por isso a view passa a
-- MOSTRAR a distância entre as datas, em vez de decidir por ela: quem olha
-- precisa desse número para julgar, e a view não tem como saber.
--
-- ── A terceira armadilha, de novo ────────────────────────────────────────
--
-- Isto é o mesmo defeito de `funis.ativo × funis.status`: um filtro escondendo
-- (aqui, juntando) dados sem nada na tela dizendo o que foi feito. A diferença
-- é que aqui ninguém perdeu dinheiro — perdeu-se atenção, que é o que o alerta
-- de cadastro tinha de sobra e de que ele não precisava.

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
            -- A CHAVE ganha o tipo de teste. Ver o cabeçalho: sem ele, três
            -- variantes do mesmo AD (Vertical, Novo, Horizontal) viravam
            -- "duas duplicatas".
            c.tipo_teste,
            count(*) AS cards,
            count(DISTINCT c.video_editado_url) AS videos_distintos,
            count(c.video_editado_url) AS com_video,
            count(DISTINCT c.data_inicio) AS datas_distintas,
            min(c.data_inicio) AS primeira_data,
            max(c.data_inicio) AS ultima_data,
            min(c.criado_em) AS primeiro,
            max(c.criado_em) AS ultimo
           FROM c
          GROUP BY c.projeto_id, c.base, c.tipo_teste
         HAVING count(*) > 1
        )
 SELECT g.projeto_id,
    o.nome AS projeto,
    COALESCE(o.ativo, false) AS projeto_ativo,
    g.base AS nome_normalizado,
    g.cards,
    g.cards - 1 AS excedentes,
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
          WHERE NOT c.projeto_id IS DISTINCT FROM g.projeto_id
            AND c.base = g.base
            AND NOT c.tipo_teste IS DISTINCT FROM g.tipo_teste) AS nomes,
    -- Colunas novas, no FIM: `create or replace view` não insere no meio.
    g.tipo_teste,
    -- A distância entre as datas de início, para quem olha poder julgar o que
    -- sobrou. Mesma data = quase certamente cadastro em dobro; meses de
    -- distância = reteste. A view mostra, não decide.
    g.datas_distintas,
    g.primeira_data,
    g.ultima_data,
    (g.ultima_data - g.primeira_data) AS dias_entre_as_datas
   FROM g
     LEFT JOIN ofertas_editores o ON o.id = g.projeto_id;

comment on view public.vw_producoes_duplicadas is
  'Criativos com o mesmo código E o mesmo tipo de teste dentro do mesmo '
  'projeto. `tipo_teste` está na chave de propósito: ele é identidade, não '
  'atributo — dois cards com o mesmo nome e tipos diferentes são duas linhas '
  'de teste, não cópia. `data_inicio` NÃO entra na chave (zeraria o detector e '
  'deixaria passar o duplo cadastro com data corrigida), mas aparece como '
  '`dias_entre_as_datas` para quem olha julgar: mesma data é cadastro em '
  'dobro, meses de distância é reteste.';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_antes integer := 69;
begin
  -- 1. A chave tem o tipo de teste.
  if pg_get_viewdef('public.vw_producoes_duplicadas'::regclass, true)
     !~* 'group by[^;]*tipo_teste' then
    v_erros := v_erros || 'tipo_teste nao entrou na chave de agrupamento. ';
  end if;

  -- 2. E `data_inicio` NÃO tem: ela é atributo, e na chave zeraria o detector.
  if pg_get_viewdef('public.vw_producoes_duplicadas'::regclass, true)
     ~* 'group by[^;]*data_inicio' then
    v_erros := v_erros || 'data_inicio entrou na chave — isso zera o detector. ';
  end if;

  -- 3. O detector continua achando alguma coisa. Uma chave apertada demais
  --    daria zero, e aí não haveria mais detector nenhum.
  select count(*) into v_n from public.vw_producoes_duplicadas;
  if v_n = 0 then
    v_erros := v_erros || 'a view zerou: a chave ficou apertada demais. ';
  end if;
  if v_n >= v_antes then
    v_erros := v_erros || format('a view achou %s grupos, nao menos que os %s de antes. ', v_n, v_antes);
  end if;

  -- 4. Os seis falsos positivos de projeto ativo sairam. Eram o mesmo AD em
  --    Vertical, Novo, Horizontal e Iteracao — testes diferentes, nao copias.
  select count(*) into v_n from public.vw_producoes_duplicadas where projeto_ativo;
  if v_n > 2 then
    v_erros := v_erros || format('ainda sobram %s grupos em projeto ativo, esperava no maximo 2. ', v_n);
  end if;

  -- 5. Todo grupo tem o mesmo tipo de teste em todos os cards — e isso prova
  --    que a chave esta sendo respeitada, nao so declarada.
  select count(*) into v_n
    from public.vw_producoes_duplicadas d
    join public.producoes p
      on not p.projeto_id is distinct from d.projeto_id
     and public.fn_nome_criativo(p.nome) = d.nome_normalizado
     and p.tipo = 'criativo'
   where p.tipo_teste is distinct from d.tipo_teste
     and exists (select 1 from public.producoes p2
                  where not p2.projeto_id is distinct from d.projeto_id
                    and public.fn_nome_criativo(p2.nome) = d.nome_normalizado
                    and not p2.tipo_teste is distinct from d.tipo_teste);
  -- (A contagem acima é informativa: cards do mesmo nome com OUTRO tipo de
  --  teste podem existir, e agora eles simplesmente não entram no grupo.)

  -- 6. A distancia entre as datas esta exposta, para quem olha poder julgar.
  if pg_get_viewdef('public.vw_producoes_duplicadas'::regclass, true)
     not like '%dias_entre_as_datas%' then
    v_erros := v_erros || 'a view nao mostra a distancia entre as datas de inicio. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.vw_producoes_duplicadas;
  raise notice 'PROVA OK: a chave ganhou tipo_teste. De % grupos para %, e em projeto ativo de 6 para %.',
    v_antes, v_n, (select count(*) from public.vw_producoes_duplicadas where projeto_ativo);
end $prova$;

notify pgrst, 'reload schema';
