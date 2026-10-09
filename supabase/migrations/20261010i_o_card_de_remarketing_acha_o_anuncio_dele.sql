-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O card de remarketing acha o anúncio dele                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Dos 26 criativos que o alerta acusava como "sem veiculação", **22 eram da
-- Saponária e 21 deles terminam em RMKT**. Eles não são cards que nunca
-- rodaram: são cards de remarketing cujo anúncio existe, gastou e nunca foi
-- encontrado.
--
-- ── O desencontro, em uma linha ──────────────────────────────────────────
--
--   o CARD se chama   `AD 029 H01 V01 - RMKT`
--   o ANÚNCIO se chama `AD 029 H01 V01`, dentro da conta `RMKT Saponaria - TSL`
--
-- Quem carrega o "RMKT" do lado do Meta é a CONTA; do lado da produção é o
-- NOME DO CARD. `fn_fixar_vinculo_ads` casa nome com nome, então nunca se
-- encontram — e 9 anúncios com **R$ 2.191** de verba ficaram órfãos.
--
-- ── Por que isto é seguro, medido antes de mexer ─────────────────────────
--
-- Para cada um dos 9 anúncios da conta de remarketing:
--
--   cards com o nome exato do anúncio ....... 0   (nenhum, em todos os 9)
--   cards com o nome + sufixo RMKT .......... 1   (exatamente um, em todos os 9)
--
-- Ou seja: não há a quem atribuir errado. E conferido também que nenhum desses
-- anúncios já estava vinculado a outro card — a verba de remarketing **não**
-- estava sendo creditada ao card de prospecção, que era o estrago que eu
-- esperava encontrar e felizmente não estava lá.
--
-- ── Por que a segunda passada exige TRÊS condições ───────────────────────
--
-- A tentação é só "tentar o nome com sufixo". Isso seria perigoso ao contrário:
-- um anúncio de PROSPECÇÃO cujo card não exista acabaria vinculado ao card de
-- remarketing, e aí a verba de topo entraria no card errado.
--
-- Por isso a segunda passada só roda quando as três valem:
--
--   1. a conta é de remarketing (o nome dela contém RMKT);
--   2. NENHUM card casa com o nome exato do anúncio — a primeira passada já
--      teve sua chance e não achou nada;
--   3. existe EXATAMENTE UM card com o nome + sufixo.
--
-- A primeira condição é a frágil: ela depende de a conta se chamar RMKT. É uma
-- convenção de nome, e convenção envelhece — por isso ela é a MAIS restritiva
-- das três, e não a única. Se um dia houver conta de remarketing com outro
-- nome, o sintoma volta a ser "sem veiculação", que é visível, e não um
-- vínculo errado, que não é.
--
-- ── Passada, e não gatilho novo ──────────────────────────────────────────
--
-- Isto entra dentro da MESMA `fn_fixar_vinculo_ads` que o cron das :10 já
-- chama. Card de remarketing novo passa a ser encontrado sozinho na hora
-- seguinte — não é carga, é a quarta armadilha respeitada.

begin;

create or replace function public.fn_fixar_vinculo_ads()
 returns integer
 language plpgsql
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare fixados integer;
begin
  with ads as (
    select m.ad_id, max(m.ad_nome) as ad_nome, m.ad_account_id
      from metricas_meta m
     where m.nivel = 'ad' and m.ad_id is not null
       and not exists (select 1 from producao_ads pa where pa.ad_id = m.ad_id)
     group by m.ad_id, m.ad_account_id
  ),
  -- PRIMEIRA PASSADA, inalterada: nome exato, um candidato só.
  unico as (
    select a.ad_id, (array_agg(p.id))[1] as producao_id
      from ads a
      join ad_accounts ac on ac.id = a.ad_account_id and ac.projeto_id is not null
      join producoes p
        on public.fn_nome_criativo(p.nome) = public.fn_nome_criativo(a.ad_nome)
       and p.fase = 'postado' and p.tipo = 'criativo'
       and p.projeto_id = ac.projeto_id
       and p.responsavel_id is not null
     group by a.ad_id
    having count(p.id) = 1
  ),
  -- SEGUNDA PASSADA: o card de remarketing. Ver o cabeçalho para as três
  -- condições e por que a ordem delas importa.
  remarketing as (
    select a.ad_id, (array_agg(p.id))[1] as producao_id
      from ads a
      join ad_accounts ac on ac.id = a.ad_account_id and ac.projeto_id is not null
      join producoes p
        -- O card é o nome do anúncio MAIS o sufixo. As duas grafias que
        -- existem hoje: "AD 029 H01 V01 - RMKT" e "AD 029 H03 V02 RMKT".
        on public.fn_nome_criativo(p.nome) in (
             public.fn_nome_criativo(a.ad_nome || ' - RMKT'),
             public.fn_nome_criativo(a.ad_nome || ' RMKT'))
       and p.fase = 'postado' and p.tipo = 'criativo'
       and p.projeto_id = ac.projeto_id
       and p.responsavel_id is not null
     where ac.nome ilike '%rmkt%'
       -- A primeira passada já teve sua chance: se existe card com o nome
       -- exato, é dele o anúncio, e não se tenta o sufixo.
       and not exists (
         select 1 from producoes p2
          where public.fn_nome_criativo(p2.nome) = public.fn_nome_criativo(a.ad_nome)
            and p2.fase = 'postado' and p2.tipo = 'criativo'
            and p2.projeto_id = ac.projeto_id
            and p2.responsavel_id is not null)
     group by a.ad_id
    having count(p.id) = 1
  ),
  gravados as (
    insert into producao_ads (ad_id, producao_id, origem)
    select ad_id, producao_id, 'automatico' from unico
    union all
    select ad_id, producao_id, 'automatico' from remarketing
    on conflict (ad_id) do nothing
    returning 1
  )
  select count(*) into fixados from gravados;
  return fixados;
end;
$function$;

comment on function public.fn_fixar_vinculo_ads() is
  'Grava o vínculo anúncio↔card quando não há dúvida. Duas passadas: nome '
  'exato, e — só em conta de remarketing, só quando o nome exato não achou '
  'nada, e só havendo um candidato — o nome do anúncio mais o sufixo RMKT. '
  'Do lado do Meta quem carrega o RMKT é a CONTA; do lado da produção é o nome '
  'do CARD, e por isso os dois nunca se encontravam.';

commit;

-- ---------------------------------------------------------------------------
-- Encontra os que estavam órfãos. Fora da transação porque é trabalho, não
-- estrutura — o mesmo padrão de `20260824b`.
-- ---------------------------------------------------------------------------
select public.fn_fixar_vinculo_ads();

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros  text := '';
  v_n      integer;
  v_verba  numeric;
  v_sobrou integer;
begin
  -- Os anuncios, DISTINTOS. A primeira versao desta prova contou linhas de
  -- metricas_meta (uma por anuncio por dia) e acusou 113 onde havia 5.
  select count(distinct m.ad_id) into v_n
    from metricas_meta m
    join ad_accounts ac on ac.id = m.ad_account_id
   where m.nivel = 'ad' and ac.nome = 'RMKT Saponaria - TSL'
     and not exists (select 1 from producao_ads pa where pa.ad_id = m.ad_id);
  if v_n > 0 then
    v_erros := v_erros || format('%s anuncio(s) de remarketing seguem sem card. ', v_n);
  end if;

  select count(distinct m.ad_id) into v_n
    from metricas_meta m
    join ad_accounts ac on ac.id = m.ad_account_id
    join producao_ads pa on pa.ad_id = m.ad_id
    join producoes p on p.id = pa.producao_id
   where m.nivel = 'ad' and ac.nome ilike '%rmkt%'
     and pa.origem = 'automatico'
     and p.nome not ilike '%rmkt%';
  if v_n > 0 then
    v_erros := v_erros || format('%s anuncio(s) de remarketing foram para card sem RMKT no nome. ', v_n);
  end if;

  -- So vinculos AUTOMATICOS: os 5 manuais de 24/08, 05/09 e 14/09 sao decisao
  -- humana, e acusa-los seria o teste reprovando quem arrumou a mao.
  select count(distinct m.ad_id) into v_n
    from metricas_meta m
    join ad_accounts ac on ac.id = m.ad_account_id
    join producao_ads pa on pa.ad_id = m.ad_id
    join producoes p on p.id = pa.producao_id
   where m.nivel = 'ad' and ac.nome not ilike '%rmkt%'
     and pa.origem = 'automatico'
     and m.ad_nome not ilike '%rmkt%'
     and p.nome ilike '%rmkt%';
  if v_n > 0 then
    v_erros := v_erros || format('%s anuncio(s) de prospeccao foram parar em card de remarketing. ', v_n);
  end if;

  select count(*) into v_sobrou
    from public.vw_criativo_sem_veiculacao sv
    join public.producoes p on p.id = sv.producao_id
    join public.ofertas_editores oe on oe.id = p.projeto_id
   where oe.nome = 'Saponaria Brasil';
  if v_sobrou >= 22 then
    v_erros := v_erros || format('a Saponaria segue com %s criativo(s) sem veiculacao: nada foi encontrado. ', v_sobrou);
  end if;

  select count(*) into v_n from (
    select ad_id from public.producao_ads group by ad_id having count(*) > 1) x;
  if v_n > 0 then
    v_erros := v_erros || format('%s anuncio(s) com mais de um card. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select round(sum(m.investimento)) into v_verba
    from metricas_meta m join ad_accounts ac on ac.id = m.ad_account_id
   where m.nivel='ad' and ac.nome = 'RMKT Saponaria - TSL';
  raise notice 'PROVA OK: os anuncios de remarketing da Saponaria (R$ %) acharam seus cards, nenhum vinculo automatico cruzou prospeccao com remarketing, e restam % criativo(s) sem veiculacao na Saponaria.',
    v_verba, v_sobrou;
end $prova$;

notify pgrst, 'reload schema';
