-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O sufixo RMKT não depende do nome da conta                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A `20261010i` só tentava o sufixo quando a CONTA se chamava RMKT. Achou 4
-- cards e parou. Sobraram 18 na Saponária — e medindo os 16 que tinham anúncio
-- gêmeo:
--
--   cards com o nome exato do anúncio ..... 0   em TODOS os 16
--   anúncios órfãos com esse nome ......... 1   em TODOS os 16
--
-- A condição do nome da conta estava bloqueando 16 casos tão inequívocos
-- quanto os 4 que passaram, e sem proteger de nada: a proteção real são as
-- outras duas condições, não essa.
--
-- ── O argumento que fecha: uma pessoa já fez isto três vezes ─────────────
--
-- A prova da `i` encontrou 5 vínculos com `origem = 'manual'`, fixados em
-- 24/08, 05/09 e 14/09, ligando anúncio de conta NORMAL (`Saponaria Brasil -
-- TSL`) a card COM sufixo:
--
--   AD 038 H02 V01  ->  AD 038 H02 V01 RMKT
--   AD 038 H03 V01  ->  AD 038 H03 V01 RMKT
--
-- A regra nova não está inventando critério nenhum: está automatizando um
-- julgamento que já foi feito à mão, em conta que não se chama RMKT, três
-- vezes. Quando a máquina e a pessoa chegam ao mesmo lugar por caminhos
-- independentes, é bom sinal sobre o caminho.
--
-- ── E o perigo que a condição pretendia evitar não existe ────────────────
--
-- O medo era: anúncio de PROSPECÇÃO sem card acaba no card de remarketing, e a
-- verba de topo entra no lugar errado.
--
-- Mas para isso acontecer é preciso que NÃO exista card com o nome exato do
-- anúncio. E se não existe, não há a quem mais atribuir — a escolha real não é
-- entre "card certo" e "card errado", é entre "o único card daquele criativo"
-- e "órfão para sempre". Deixar órfão não protege ninguém: só esconde a verba,
-- e foi assim que R$ 2.191 ficaram invisíveis.
--
-- ── O que fica em pé ─────────────────────────────────────────────────────
--
-- Duas condições, e as duas sobre DADO em vez de convenção de nome:
--
--   1. nenhum card casa com o nome exato do anúncio — a primeira passada já
--      teve sua chance e não achou ninguém;
--   2. existe EXATAMENTE UM card com o nome + sufixo.
--
-- Havendo dois candidatos, ninguém decide — como na primeira passada. Um
-- palpite gravado é permanente, e a tela continua acusando "sem veiculação"
-- até alguém escolher, que é o comportamento certo.
--
-- ── Resultado ────────────────────────────────────────────────────────────
--
-- A Saponária sai de 22 criativos sem veiculação para 2, e os 2 que restam são
-- legítimos: `AD 029 H03 V06 RMKT`, cujo anúncio gêmeo não existe em conta
-- nenhuma, e `AD 045 H05 V04`, que não é remarketing e nunca rodou mesmo (o
-- V05 é que foi ao ar).

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
  -- PRIMEIRA PASSADA, inalterada desde 20260824b: nome exato, um candidato só.
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
  -- SEGUNDA PASSADA: o card de remarketing.
  --
  -- Quem carrega o RMKT do lado da produção é o NOME DO CARD. Do lado do Meta,
  -- às vezes é a conta (`RMKT Saponaria - TSL`), às vezes nada (o mesmo
  -- criativo rodando dentro da conta principal). Por isso a regra olha o card,
  -- que é onde a convenção é consistente.
  remarketing as (
    select a.ad_id, (array_agg(p.id))[1] as producao_id
      from ads a
      join ad_accounts ac on ac.id = a.ad_account_id and ac.projeto_id is not null
      join producoes p
        -- As duas grafias que existem: "AD 029 H01 V01 - RMKT" e
        -- "AD 029 H03 V02 RMKT".
        on public.fn_nome_criativo(p.nome) in (
             public.fn_nome_criativo(a.ad_nome || ' - RMKT'),
             public.fn_nome_criativo(a.ad_nome || ' RMKT'))
       and p.fase = 'postado' and p.tipo = 'criativo'
       and p.projeto_id = ac.projeto_id
       and p.responsavel_id is not null
     -- A PROTEÇÃO: só quando a primeira passada não tem a quem dar. Havendo
     -- card com o nome exato, o anúncio é dele e o sufixo nem é tentado.
     where not exists (
         select 1 from producoes p2
          where public.fn_nome_criativo(p2.nome) = public.fn_nome_criativo(a.ad_nome)
            and p2.fase = 'postado' and p2.tipo = 'criativo'
            and p2.projeto_id = ac.projeto_id
            and p2.responsavel_id is not null)
     group by a.ad_id
    -- E só havendo UM candidato com sufixo. Dois, e alguém decide à mão.
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
  'Grava o vínculo anúncio↔card quando não há dúvida. Duas passadas: o nome '
  'exato e, quando ele não acha ninguém, o nome do anúncio mais o sufixo RMKT '
  '— ainda exigindo candidato único. Do lado da produção quem carrega o RMKT é '
  'o nome do CARD; do lado do Meta às vezes a conta, às vezes nada, e por isso '
  'a regra olha o card. A proteção não é o nome da conta: é não existir card '
  'com o nome exato e existir exatamente um com o sufixo.';

commit;

-- Encontra os que estavam órfãos. Fora da transação porque é trabalho, não
-- estrutura — o mesmo padrão de `20260824b`.
select public.fn_fixar_vinculo_ads();

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros  text := '';
  v_n      integer;
  v_sobrou integer;
  v_verba  numeric;
begin
  -- 1. A invariante que importa: nenhum anúncio foi parar num card de nome
  --    diferente HAVENDO card com o nome exato dele. É a única forma de a
  --    segunda passada roubar de alguém.
  select count(*) into v_n
    from public.producao_ads pa
    join public.producoes p on p.id = pa.producao_id
    join (select ad_id, max(ad_nome) as ad_nome, ad_account_id
            from public.metricas_meta where nivel='ad'
           group by ad_id, ad_account_id) m on m.ad_id = pa.ad_id
    join public.ad_accounts ac on ac.id = m.ad_account_id
   where pa.origem = 'automatico'
     and public.fn_nome_criativo(p.nome) <> public.fn_nome_criativo(m.ad_nome)
     and exists (select 1 from public.producoes p2
                  where public.fn_nome_criativo(p2.nome) = public.fn_nome_criativo(m.ad_nome)
                    and p2.fase='postado' and p2.tipo='criativo'
                    and p2.projeto_id = ac.projeto_id
                    and p2.responsavel_id is not null);
  if v_n > 0 then
    v_erros := v_erros || format('%s vinculo(s) automaticos foram para card de nome diferente havendo card de nome exato. ', v_n);
  end if;

  -- 2. E todo vínculo automático de nome diferente é pelo sufixo RMKT, não por
  --    qualquer outra semelhança que alguém acrescente depois.
  select count(*) into v_n
    from public.producao_ads pa
    join public.producoes p on p.id = pa.producao_id
    join (select ad_id, max(ad_nome) as ad_nome from public.metricas_meta
           where nivel='ad' group by ad_id) m on m.ad_id = pa.ad_id
   where pa.origem = 'automatico'
     and public.fn_nome_criativo(p.nome) <> public.fn_nome_criativo(m.ad_nome)
     and p.nome not ilike '%rmkt%';
  if v_n > 0 then
    v_erros := v_erros || format('%s vinculo(s) automaticos com nome diferente que nao sao RMKT. ', v_n);
  end if;

  -- 3. `producao_ads` é por anúncio: um anúncio, um card.
  select count(*) into v_n from (
    select ad_id from public.producao_ads group by ad_id having count(*) > 1) x;
  if v_n > 0 then
    v_erros := v_erros || format('%s anuncio(s) com mais de um card. ', v_n);
  end if;

  -- 4. A fila da Saponária encolheu de verdade: de 22 para uns poucos.
  select count(*) into v_sobrou
    from public.vw_criativo_sem_veiculacao sv
    join public.producoes p on p.id = sv.producao_id
    join public.ofertas_editores oe on oe.id = p.projeto_id
   where oe.nome = 'Saponaria Brasil';
  if v_sobrou > 4 then
    v_erros := v_erros || format('a Saponaria ainda tem %s sem veiculacao, esperava poucos. ', v_sobrou);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select round(sum(m.investimento)) into v_verba
    from public.metricas_meta m
    join public.producao_ads pa on pa.ad_id = m.ad_id
    join public.producoes p on p.id = pa.producao_id
   where m.nivel='ad' and p.nome ilike '%rmkt%';
  raise notice 'PROVA OK: R$ % de verba de remarketing tem card. Restam % criativo(s) sem veiculacao na Saponaria.',
    v_verba, v_sobrou;
end $prova$;

notify pgrst, 'reload schema';
