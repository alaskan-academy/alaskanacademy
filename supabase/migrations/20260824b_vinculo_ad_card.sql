-- 2026-08-24 (parte 2) — o vínculo anúncio↔card deixa de ser adivinhado
--
-- Depende de 20260824_criativo_como_unidade.sql.
--
-- Até aqui a tela descobria o dono de cada anúncio casando o nome do criativo com
-- o nome do card e desempatando pela data. Isso nunca vai ser confiável: `AD 006
-- H01 V01` existe em 18 projetos, e o desempate mudava de resposta conforme o
-- filtro de data da tela. Agora o vínculo é gravado, e o casamento por nome vira
-- só o palpite inicial de quem ainda não tem vínculo.

begin;

-- ---------------------------------------------------------------------------
-- 1. producao_ads — onde o vínculo mora
-- ---------------------------------------------------------------------------
-- Uma coluna em `producoes` não daria conta: 564 anúncios apontam para 333 cards,
-- porque o mesmo criativo sobe como vários anúncios no Meta. `producoes.ad_id_meta`
-- é única, então guardava 333 e deixava 233 anúncios (41%) sem onde ser registrados.
-- Aqui a chave é o anúncio; o card é o lado que se repete.
create table if not exists producao_ads (
  ad_id       text primary key,
  producao_id uuid not null references producoes(id) on delete cascade,
  origem      text not null default 'automatico',   -- 'automatico' | 'manual'
  fixado_em   timestamptz not null default now()
);

create index if not exists idx_producao_ads_card on producao_ads (producao_id);

alter table producao_ads enable row level security;
create policy producao_ads_read  on producao_ads for select to authenticated using (true);
create policy producao_ads_write on producao_ads for all    to authenticated using (true) with check (true);

-- O que já havia sido escolhido à mão na coluna antiga continua valendo.
insert into producao_ads (ad_id, producao_id, origem)
select ad_id_meta, id, 'manual' from producoes where ad_id_meta is not null
on conflict (ad_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. fn_fixar_vinculo_ads — grava o vínculo quando não há dúvida
-- ---------------------------------------------------------------------------
-- Só grava quando existe EXATAMENTE UM card postado, do tipo criativo, com
-- responsável, no projeto da conta do anúncio. Havendo dois, não escolhe: um
-- palpite gravado é permanente, e a tela continua mostrando o anúncio como
-- pendente até alguém decidir.
--
-- `force_custom_plan` pelo mesmo motivo de fn_criativos_meta: com plano genérico
-- o planejador estima 1 linha por CTE e a função passa de segundos a minutos.
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
  gravados as (
    insert into producao_ads (ad_id, producao_id, origem)
    select ad_id, producao_id, 'automatico' from unico
    on conflict (ad_id) do nothing
    returning 1
  )
  select count(*) into fixados from gravados;
  return fixados;
end;
$function$;

commit;

-- ---------------------------------------------------------------------------
-- 3. Vínculo do histórico
-- ---------------------------------------------------------------------------
-- Fora da transação porque é trabalho, não estrutura. Em 24/08/2026 gravou 564
-- vínculos sobre 333 cards; em agosto, `sugerido` foi de 276 a 0 e `confirmado`
-- de 2 a 278 dos 289 anúncios (R$ 86.813,94).
select public.fn_fixar_vinculo_ads();

begin;

-- ---------------------------------------------------------------------------
-- 4. fn_criativos_meta lê o vínculo gravado
-- ---------------------------------------------------------------------------
-- Única mudança em relação a 20260824: a fonte do vínculo explícito deixa de ser
-- `producoes.ad_id_meta` e passa a ser `producao_ads`. O corpo vai inteiro porque
-- 20260824 documentou a conversão para PL/pgSQL em comentário sem trazer o texto —
-- daqui em diante a cadeia de migrations reproduz a função que está no ar.
CREATE OR REPLACE FUNCTION public.fn_criativos_meta(p_ini date, p_fim date, p_conta uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ad_id text, ad_nome text, conta_id uuid, conta text, estreia date, investimento numeric, impressoes bigint, cliques_link bigint, video_3s bigint, video_75pct bigint, checkouts bigint, visualizacoes bigint, vendas integer, receita numeric, vendas_meta integer, receita_meta numeric, producao_id uuid, editor_id uuid, editor text, projeto text, avaliacao text, status_veiculacao text, tipo_teste text, angulo_teste text, nivel_consciencia text, formato text, vinculo text, candidatos integer, conta_hook numeric, conta_ctr numeric, conta_conexao numeric, conta_cpa numeric, conta_roas numeric, conta_cpa_meta numeric, conta_roas_meta numeric, conta_pct_atribuido numeric)
 LANGUAGE plpgsql
 STABLE
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
begin
  return query
  with contas_ativas as (
    select m.ad_account_id from metricas_meta m
     where m.nivel = 'campanha' and m.data between p_ini and p_fim
     group by m.ad_account_id having sum(m.investimento) > 0
  ),
  ad as (
    select m.ad_id, max(m.ad_nome) as ad_nome, m.ad_account_id,
           sum(m.investimento) as investimento,
           -- `impressoes` e bigint, e sum(bigint) devolve numeric: em plpgsql isso
           -- derruba a funcao com "structure of query does not match".
           sum(m.impressoes)::bigint as impressoes,
           sum(m.cliques_link)::bigint as cliques_link,
           sum(m.video_3s)::bigint as video_3s,
           sum(m.video_75pct)::bigint as video_75pct,
           sum(m.initiate_checkout)::bigint as checkouts,
           sum(m.visualizacoes_pagina)::bigint as visualizacoes,
           sum(m.compras_meta)::integer as vendas_meta,
           sum(m.faturamento_atribuido) as receita_meta
      from metricas_meta m
      join contas_ativas c on c.ad_account_id = m.ad_account_id
     where m.nivel = 'ad' and m.data between p_ini and p_fim and m.ad_id is not null
       and (p_conta is null or m.ad_account_id = p_conta)
     group by m.ad_id, m.ad_account_id
  ),
  estreia_real as (
    select m.ad_id, min(m.data) as estreia
      from metricas_meta m
     where m.nivel = 'ad' and m.ad_id is not null
       and m.ad_id in (select a.ad_id from ad a)
     group by m.ad_id
  ),
  venda as (
    select v.ad_id_meta as ad_id, count(*)::integer as vendas,
           sum(coalesce(v.valor_sem_juros, v.valor_total)) as receita
      from vendas v
     where v.status = 'aprovada' and not coalesce(v.is_upsell, false)
       and v.ad_id_meta is not null
       and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
     group by v.ad_id_meta
  ),
  atribuicao as (
    select v.ad_account_id, round(100.0 * count(v.ad_id_meta) / nullif(count(*), 0), 1) as pct
      from vendas v
     where v.status = 'aprovada' and not coalesce(v.is_upsell, false)
       and v.ad_account_id is not null
       and (v.data_venda at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
     group by v.ad_account_id
  ),
  cand as (
    select a.ad_id, er.estreia, p.id, p.responsavel_id, p.criado_em::date as criado,
           (ac.projeto_id is not null) as conta_mapeada,
           (p.projeto_id is not null and p.projeto_id = ac.projeto_id) as no_projeto
      from ad a
      join ad_accounts ac  on ac.id = a.ad_account_id
      join estreia_real er on er.ad_id = a.ad_id
      join producoes p
        on public.fn_nome_criativo(p.nome) = public.fn_nome_criativo(a.ad_nome)
       and p.fase = 'postado' and p.tipo = 'criativo'
  ),
  cand_ok as (select * from cand where no_projeto or not conta_mapeada),
  resumo as (
    select c.ad_id, count(*) as cards, count(c.responsavel_id) as com_editor,
           count(distinct c.responsavel_id) as editores
      from cand_ok c group by c.ad_id
  ),
  ranqueado as (
    select c.ad_id, c.id,
           row_number() over (partition by c.ad_id
             order by (c.criado <= c.estreia) desc, abs(c.criado - c.estreia)) as pos
      from cand_ok c where c.responsavel_id is not null
  ),
  pela_data as (select r.ad_id, r.id as producao_id from ranqueado r where r.pos = 1),
  sem_dono as (
    select c.ad_id, (array_agg(c.id order by c.criado desc))[1] as producao_id
      from cand_ok c group by c.ad_id
  ),
  so_outro_projeto as (
    select c.ad_id from cand c where c.conta_mapeada
     group by c.ad_id having count(*) filter (where c.no_projeto) = 0
  ),
  fora as (
    select a.ad_id from ad a
      join producoes p on public.fn_nome_criativo(p.nome) = public.fn_nome_criativo(a.ad_nome)
     where p.fase <> 'postado' or p.tipo <> 'criativo'
     group by a.ad_id
  ),
  escolha as (
    select a.ad_id,
           coalesce(e.producao_id, d.producao_id, s.producao_id) as producao_id,
           case when e.producao_id is not null then 'confirmado'
                when op.ad_id is not null then 'outro_projeto'
                when coalesce(r.cards,0) = 0 and f.ad_id is not null then 'fora_do_recorte'
                when coalesce(r.cards,0) = 0 then 'sem_card'
                when r.com_editor = 0 then 'sem_responsavel'
                when r.editores > 1 then 'por_data'
                else 'sugerido' end as vinculo,
           coalesce(r.editores, 0)::integer as candidatos
      from ad a
      left join (select pa.ad_id, pa.producao_id from producao_ads pa) e on e.ad_id = a.ad_id
      left join pela_data d on d.ad_id = a.ad_id
      left join sem_dono  s on s.ad_id = a.ad_id
      left join resumo    r on r.ad_id = a.ad_id
      left join fora      f on f.ad_id = a.ad_id
      left join so_outro_projeto op on op.ad_id = a.ad_id
  ),
  ref as (
    select a.ad_account_id,
           round(sum(a.video_3s)     * 100.0 / nullif(sum(a.impressoes), 0), 2)   as hook,
           round(sum(a.cliques_link) * 100.0 / nullif(sum(a.impressoes), 0), 2)   as ctr,
           round(sum(a.visualizacoes)* 100.0 / nullif(sum(a.cliques_link), 0), 2) as conexao,
           round(sum(a.investimento) / nullif(sum(v.vendas), 0), 2)               as cpa,
           round(sum(v.receita) / nullif(sum(a.investimento), 0), 2)              as roas,
           round(sum(a.investimento) / nullif(sum(a.vendas_meta), 0), 2)          as cpa_meta,
           round(sum(a.receita_meta) / nullif(sum(a.investimento), 0), 2)         as roas_meta
      from ad a left join venda v on v.ad_id = a.ad_id
     group by a.ad_account_id
  )
  select
    a.ad_id, a.ad_nome, a.ad_account_id, c.nome::text, er.estreia,
    round(a.investimento, 2), a.impressoes, a.cliques_link,
    a.video_3s, a.video_75pct, a.checkouts, a.visualizacoes,
    coalesce(v.vendas, 0), round(coalesce(v.receita, 0), 2),
    coalesce(a.vendas_meta, 0), round(coalesce(a.receita_meta, 0), 2),
    p.id, p.responsavel_id, perf.nome::text, of.nome::text,
    p.avaliacao::text, p.status_veiculacao::text,
    p.tipo_teste::text, p.angulo_teste::text, p.nivel_consciencia::text, p.formato::text,
    e.vinculo, e.candidatos,
    r.hook, r.ctr, r.conexao, r.cpa, r.roas, r.cpa_meta, r.roas_meta,
    coalesce(atr.pct, 0)
  from ad a
  join ad_accounts c    on c.id = a.ad_account_id
  join estreia_real er  on er.ad_id = a.ad_id
  join escolha e        on e.ad_id = a.ad_id
  left join venda v     on v.ad_id = a.ad_id
  left join producoes p on p.id = e.producao_id
  left join perfis perf on perf.id = p.responsavel_id
  left join ofertas_editores of on of.id = p.projeto_id
  left join ref r       on r.ad_account_id = a.ad_account_id
  left join atribuicao atr on atr.ad_account_id = a.ad_account_id
  order by a.investimento desc;
end;
$function$;

commit;

-- ---------------------------------------------------------------------------
-- 5. O anúncio novo é fixado na hora seguinte
-- ---------------------------------------------------------------------------
-- `meta-sync-horario` roda em '0 * * * *'; dez minutos depois o anúncio que
-- acabou de subir já tem seu card gravado, enquanto só existe um candidato.
-- Esperar mais aumenta a chance de aparecer um segundo card com o mesmo nome —
-- e aí ninguém grava nada e alguém precisa decidir na mão.
--
-- `cron.schedule` com nome existente substitui o agendamento, então isto é
-- idempotente. Fica comentado como o resto dos agendamentos do baseline:
-- pg_cron só existe no banco hospedado.
/*
select cron.schedule('atribuicao-horaria', '10 * * * *', $cmd$
    SELECT fn_resolver_conta_das_vendas();
    SELECT fn_herdar_origem_do_upsell();
    SELECT fn_fixar_vinculo_ads();
  $cmd$);
*/
