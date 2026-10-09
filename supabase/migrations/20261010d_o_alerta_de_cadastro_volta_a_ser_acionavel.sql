-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O alerta de cadastro volta a ser acionável                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- O alerta dizia "155 itens de cadastro esperando arrumação". Revisado item a
-- item em 10/10/2026, **115 deles não eram arrumáveis** — e os dois que custam
-- dinheiro agora pesavam 4% do número.
--
--   78 criativos sem veiculação   →  26 reais
--   69 produções duplicadas       →   6 reais
--    6 ofertas não cadastradas    →   6, e é aqui que está o dinheiro
--    2 origens de UTM             →   2
--
-- São duas coisas diferentes, e por isso o conserto vai em dois lugares.
--
-- ── 1. O BUG: VSL não pode ter veiculação, por construção ────────────────
--
-- `vw_criativo_sem_veiculacao` não filtrava `tipo`, e 7 dos 78 eram VSL ou
-- aula. `fn_fixar_vinculo_ads` — a ÚNICA coisa que escreve em `producao_ads` —
-- exige `p.tipo = 'criativo'`. Uma VSL nunca pode ganhar vínculo, então
-- cobrá-la de "sem veiculação" é acusar alguém de não ter feito algo que o tipo
-- do card nunca faz.
--
-- É exatamente o defeito que `src/test/aula-e-vsl-nao-viram-anuncio.test.ts`
-- existe para impedir — ele nasceu de "O que eu aprovei" mostrando "nunca virou
-- anúncio" em laranja para uma Aula — e esta view escapou dele. Isto é correção
-- de FATO, e por isso vai na view.
--
-- ── 2. A CALIBRAÇÃO: projeto encerrado não é trabalho ────────────────────
--
-- 45 dos 78 cards são de **Velas Perfeitas**, que está inativo e **não tem
-- nenhuma conta de anúncio mapeada** — 744 criativos postados, zero contas.
-- Esses cards não podem ganhar vínculo nem em teoria. E 63 das 69 duplicatas
-- também são de projeto encerrado.
--
-- Conferido antes de filtrar: dos 22 projetos sem conta de anúncio, **todos os
-- 22 estão inativos**, e nenhum tem card postado nos últimos 90 dias. Então o
-- filtro por `ativo` não esconde nenhum problema estrutural — se um projeto
-- ATIVO ficasse sem conta, ele continuaria aparecendo.
--
-- Isto é JULGAMENTO sobre o que é acionável, não correção de fato, e por isso
-- vai no ALERTA e não nas views. As views continuam respondendo "o que está
-- duplicado?" por inteiro; o alerta responde "o que eu preciso arrumar?".
--
-- Pude separar assim porque nada mais consome essas views: nenhuma tela do
-- `src/` as cita, e `pg_depend` não aponta nenhuma view dependente. Se houvesse
-- uma tela, filtrar no alerta criaria dois números para a mesma pergunta —
-- primeira armadilha — e o certo seria filtrar na view.
--
-- ── E o que sai da conta continua visível ────────────────────────────────
--
-- O alerta passa a dizer "(N em projeto encerrado, fora da conta)". Esconder
-- sem avisar seria trocar um número inútil por um número incompleto; dizer
-- quanto ficou de fora mantém a porta aberta para uma limpeza futura sem
-- poluir a fila do dia.
--
-- ── Por que isto importa ─────────────────────────────────────────────────
--
-- Um alerta que não pode zerar é um alerta que o olho para de ver — a mesma
-- razão pela qual `parado_recente` existe em vez de pintar todo parado de
-- âmbar (ver `20260924a`). E o preço aqui é concreto: enterrada entre 115
-- itens mortos estava a oferta `RAOJGY` — "Guia do Comportamento na Sala de
-- Aula" —, **195 vendas e R$ 22.949,86 desde 02/09, ainda vendendo hoje, e sem
-- cadastro**.
--
-- As ofertas e as origens de UTM **não são filtradas**: elas não pertencem a
-- projeto, e são justamente as que estão certas.

begin;

-- ---------------------------------------------------------------------------
-- 1. O bug: só criativo pode ser cobrado de veiculação
-- ---------------------------------------------------------------------------
create or replace view public.vw_criativo_sem_veiculacao
  with (security_invoker = on) as
 SELECT id AS producao_id,
    projeto_id,
    nome,
    data_inicio,
    CURRENT_DATE - data_inicio AS dias_desde_a_postagem
   FROM producoes p
  WHERE fase = 'postado'::text
    -- A correção. `fn_fixar_vinculo_ads` exige tipo='criativo', então VSL e
    -- aula não podem ter vínculo por construção. Ver `aula-e-vsl-nao-viram-anuncio`.
    AND tipo = 'criativo'::text
    AND data_inicio >= '2026-05-01'::date
    AND data_inicio <= (CURRENT_DATE - 7)
    AND NOT (EXISTS ( SELECT 1
           FROM producao_ads pa
          WHERE pa.producao_id = p.id));

comment on view public.vw_criativo_sem_veiculacao is
  'Criativos postados há mais de 7 dias que nunca ganharam vínculo com anúncio. '
  'Só `tipo = criativo`: VSL e aula não podem ter vínculo por construção, '
  'porque fn_fixar_vinculo_ads exige esse tipo. NÃO filtra projeto encerrado — '
  'quem decide o que é acionável é fn_alerta_cadastro_a_arrumar.';

-- ---------------------------------------------------------------------------
-- 2. A calibração: o alerta conta só o que dá para arrumar
-- ---------------------------------------------------------------------------
create or replace function public.fn_alerta_cadastro_a_arrumar()
 returns table(codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
as $function$
  with achados(um, varios, n) as (
    -- Projeto encerrado não recebe criativo novo nem ganha conta de anúncio.
    select 'criativo sem veiculação', 'criativos sem veiculação',
           (select count(*) from public.vw_criativo_sem_veiculacao sv
              join public.producoes p on p.id = sv.producao_id
              join public.ofertas_editores oe on oe.id = p.projeto_id
             where oe.ativo)
    union all
    select 'produção duplicada', 'produções duplicadas',
           (select count(*) from public.vw_producoes_duplicadas where projeto_ativo)
    union all
    -- Ofertas e origens NÃO são filtradas: não pertencem a projeto, e são as
    -- que trazem dinheiro. A RAOJGY sozinha fez R$ 22.949,86 desde 02/09.
    select 'oferta vendida e não cadastrada', 'ofertas vendidas e não cadastradas',
           (select count(*) from public.vw_ofertas_faltando)
    union all
    select 'origem de UTM sem classificar', 'origens de UTM sem classificar',
           (select count(*) from public.vw_origens_a_classificar)
    union all
    select 'regra de categoria órfã', 'regras de categoria órfãs',
           (select count(*) from public.vw_regras_orfas)
  ),
  -- O que ficou de fora, para a mensagem poder dizer. Esconder sem avisar
  -- trocaria um número inútil por um número incompleto.
  encerrados(n) as (
    select (select count(*) from public.vw_criativo_sem_veiculacao sv
              join public.producoes p on p.id = sv.producao_id
              left join public.ofertas_editores oe on oe.id = p.projeto_id
             where coalesce(oe.ativo, false) is false)
         + (select count(*) from public.vw_producoes_duplicadas where not projeto_ativo)
  ),
  pendentes as (select um, varios, n from achados where n > 0)
  select
    'cadastro_a_arrumar'::text,
    'atencao'::text,
    sum(n)::text || ' ' ||
      case when sum(n) = 1 then 'item de cadastro esperando arrumação'
           else 'itens de cadastro esperando arrumação' end,
    string_agg(n || ' ' || case when n = 1 then um else varios end, ' · ' order by n desc)
    || coalesce((select ' · (' || e.n || ' em projeto encerrado, fora da conta)'
                   from encerrados e where e.n > 0), '')
  from pendentes
  having sum(n) > 0;
$function$;

comment on function public.fn_alerta_cadastro_a_arrumar() is
  'O que dá para arrumar hoje. Criativos sem veiculação e produções duplicadas '
  'contam só em projeto ATIVO — projeto encerrado não recebe criativo novo nem '
  'ganha conta de anúncio, e 115 dos 155 itens de 10/10/2026 eram disso. '
  'Ofertas e origens de UTM não são filtradas: não pertencem a projeto. O que '
  'fica de fora aparece no fim da mensagem, para não virar número incompleto.';

revoke all on function public.fn_alerta_cadastro_a_arrumar() from anon;
grant execute on function public.fn_alerta_cadastro_a_arrumar() to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_det   text;
  v_tit   text;
begin
  -- 1. O BUG: nenhuma VSL nem aula na lista de "sem veiculação".
  select count(*) into v_n
    from public.vw_criativo_sem_veiculacao sv
    join public.producoes p on p.id = sv.producao_id
   where p.tipo <> 'criativo';
  if v_n <> 0 then
    v_erros := v_erros || format('%s card(s) que nao sao criativo seguem na lista de sem veiculacao. ', v_n);
  end if;

  -- 2. E a view NÃO filtra projeto: ela continua respondendo o fato inteiro.
  --    Quem julga o que é acionável é o alerta.
  select count(*) into v_n
    from public.vw_criativo_sem_veiculacao sv
    join public.producoes p on p.id = sv.producao_id
    left join public.ofertas_editores oe on oe.id = p.projeto_id
   where coalesce(oe.ativo, false) is false;
  if v_n = 0 then
    v_erros := v_erros || 'a view passou a filtrar projeto encerrado — isso e julgamento e pertence ao alerta. ';
  end if;

  -- 3. A CALIBRAÇÃO: o alerta conta bem menos que a soma crua das views.
  select titulo, detalhe into v_tit, v_det from public.fn_alerta_cadastro_a_arrumar();
  if v_tit is null then
    v_erros := v_erros || 'o alerta parou de devolver linha. ';
  else
    if v_det not like '%projeto encerrado%' then
      v_erros := v_erros || 'o alerta nao diz quantos ficaram de fora. ';
    end if;
    -- O número do título tem de ser a soma dos grupos do detalhe, e tem de ser
    -- bem menor que os 155 de antes. Faixa larga de propósito: isto muda com o
    -- trabalho dela, e um teste que exige um número exato quebra na primeira
    -- oferta cadastrada.
    v_n := (regexp_match(v_tit, '^(\d+)'))[1]::integer;
    if v_n > 80 then
      v_erros := v_erros || format('o alerta ainda conta %s itens; a calibracao nao pegou. ', v_n);
    end if;
    if v_n = 0 then
      v_erros := v_erros || 'o alerta zerou — filtrou demais. ';
    end if;
  end if;

  -- 4. As ofertas NÃO foram filtradas. São o grupo que tem dinheiro dentro, e
  --    filtrá-las por engano esconderia R$ 22.949,86 vendendo hoje.
  select count(*) into v_n from public.vw_ofertas_faltando;
  if v_n > 0 and (v_det is null or v_det not like '%oferta%') then
    v_erros := v_erros || 'as ofertas nao cadastradas sumiram do alerta. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: %. Detalhe: %', v_tit, v_det;
end $prova$;

notify pgrst, 'reload schema';
