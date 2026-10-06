-- O alerta de cadastro concorda no plural
-- ============================================================================
--
-- A 20261006l nasceu dizendo, na tela:
--
--   "77 criativo sem veiculação · 69 produção duplicada ·
--    6 oferta vendida e não cadastrada · 2 origem de UTM sem classificar"
--
-- Eu escrevi os rotulos no singular e grudei o numero na frente. Funciona em
-- "1 produção duplicada" e so nesse caso — que e o unico que nao acontece.
--
-- Migracao propria, e nao um conserto por dentro da anterior, porque a `l` ja
-- esta aplicada: reescrever o arquivo dela faria o arquivo discordar do que o
-- banco registrou. Texto errado em producao se conserta com migracao nova,
-- igual a qualquer outra coisa.
--
-- Os dois rotulos ficam guardados no proprio CTE. Nao da para derivar plural
-- de portugues por regra ("origem" -> "origens", "veiculação" -> mantem,
-- "órfã" -> "órfãs"), entao sao escritos, e sao quatro palavras.

create or replace function public.fn_alerta_cadastro_a_arrumar()
returns table(codigo text, severidade text, titulo text, detalhe text)
language sql
stable
as $function$
  with achados(um, varios, n) as (
    select 'criativo sem veiculação', 'criativos sem veiculação',
           (select count(*) from public.vw_criativo_sem_veiculacao)
    union all
    select 'produção duplicada', 'produções duplicadas',
           (select count(*) from public.vw_producoes_duplicadas)
    union all
    select 'oferta vendida e não cadastrada', 'ofertas vendidas e não cadastradas',
           (select count(*) from public.vw_ofertas_faltando)
    union all
    select 'origem de UTM sem classificar', 'origens de UTM sem classificar',
           (select count(*) from public.vw_origens_a_classificar)
    union all
    select 'regra de categoria órfã', 'regras de categoria órfãs',
           (select count(*) from public.vw_regras_orfas)
  ),
  /* So o que tem pendencia entra no detalhe: listar "0 regras orfas" ensinaria
     a pessoa a ignorar a linha. */
  pendentes as (select um, varios, n from achados where n > 0)
  select
    'cadastro_a_arrumar'::text,
    'atencao'::text,
    sum(n)::text || ' ' ||
      case when sum(n) = 1 then 'item de cadastro esperando arrumação'
           else 'itens de cadastro esperando arrumação' end,
    string_agg(n || ' ' || case when n = 1 then um else varios end, ' · ' order by n desc)
  from pendentes
  having sum(n) > 0;
$function$;

comment on function public.fn_alerta_cadastro_a_arrumar() is
  'Junta as cinco views de diagnostico de cadastro numa linha de alerta. Elas '
  'existiam e so apareciam para quem abrisse o editor de SQL. Uma linha e nao '
  'cinco para nao afogar os alertas de verdade. Ver 20261006l e 20261006m.';

-- ── As provas ───────────────────────────────────────────────────────────────
DO $prova$
DECLARE
  v_detalhe text;
  v_total   int;
  v_errados text;
BEGIN
  SELECT detalhe INTO v_detalhe FROM vw_alertas WHERE codigo = 'cadastro_a_arrumar';
  IF v_detalhe IS NULL THEN
    RAISE EXCEPTION 'o alerta sumiu de vw_alertas';
  END IF;

  -- 1. Nenhum rotulo no singular com numero plural na frente. Derivada: vale
  --    para os cinco e para qualquer um que entre depois.
  SELECT string_agg(p[1], ' | ') INTO v_errados
  FROM regexp_matches(v_detalhe, '(\d+ (?:criativo|produção|oferta|origem|regra) [^·]*)', 'g') p
  WHERE p[1] !~ '^1 ';
  IF v_errados IS NOT NULL THEN
    RAISE EXCEPTION 'rotulo no singular com numero plural: %', v_errados;
  END IF;

  -- 2. E a soma continua batendo com as cinco views.
  SELECT (select count(*) from vw_criativo_sem_veiculacao)
       + (select count(*) from vw_producoes_duplicadas)
       + (select count(*) from vw_ofertas_faltando)
       + (select count(*) from vw_origens_a_classificar)
       + (select count(*) from vw_regras_orfas)
    INTO v_total;
  IF (SELECT titulo FROM vw_alertas WHERE codigo='cadastro_a_arrumar')
       NOT LIKE v_total::text || ' %' THEN
    RAISE EXCEPTION 'o titulo deixou de bater com a soma das cinco (%)', v_total;
  END IF;

  RAISE NOTICE 'alerta de cadastro: %', v_detalhe;
END
$prova$;
