-- 2026-08-23 (parte 2) — o casamento anúncio↔card e as views da tela de Vendas
-- Depende de 20260823_atribuicao_alertas_e_vendas.sql (cria ad_accounts.projeto_id).

begin;

-- ---------------------------------------------------------------------------
-- 4. fn_criativos_meta: o mesmo anúncio tinha dois donos
-- ---------------------------------------------------------------------------
-- Dois defeitos, ambos silenciosos:
--
-- A estreia era `min(data)` DENTRO da janela filtrada na tela. O AD 006 H01 V01
-- "estreava" em 01/08 quando se olhava agosto e caía num card da Jessica; olhando
-- desde junho estreava em 30/06 e caía num da Jaqueline. Trocar o filtro trocava a
-- autoria, e nada na tela sugeria isso. Agora vem do histórico inteiro do anúncio.
--
-- Os candidatos a card eram todos os que tinham o nome, de qualquer projeto —
-- `AD 006 H01 V01` existe em 18 projetos diferentes. O desempate por proximidade
-- de data escolhia entre eles quase ao acaso. Agora só concorrem cards do projeto
-- da conta; conta sem projeto mapeado continua aceitando qualquer um, para a tela
-- não regredir enquanto o mapeamento não estiver completo.
--
-- Efeito medido em agosto/2026: 15 anúncios casados com card de projeto errado
-- (R$ 11.281,86) foram a zero, e o vínculo `por_data` desapareceu dos 89 que
-- dependiam dele.

create or replace function public.fn_criativos_meta(p_ini date, p_fim date, p_conta uuid default null::uuid)
 returns table(ad_id text, ad_nome text, conta_id uuid, conta text, estreia date, investimento numeric, impressoes bigint, cliques_link bigint, video_3s bigint, video_75pct bigint, checkouts bigint, visualizacoes bigint, vendas integer, receita numeric, vendas_meta integer, receita_meta numeric, producao_id uuid, editor_id uuid, editor text, projeto text, avaliacao text, status_veiculacao text, tipo_teste text, angulo_teste text, nivel_consciencia text, formato text, vinculo text, candidatos integer, conta_hook numeric, conta_ctr numeric, conta_conexao numeric, conta_cpa numeric, conta_roas numeric, conta_cpa_meta numeric, conta_roas_meta numeric, conta_pct_atribuido numeric)
 language sql
 stable
as $function$
  with contas_ativas as (
    select m.ad_account_id from metricas_meta m
     where m.nivel = 'campanha' and m.data between p_ini and p_fim
     group by m.ad_account_id having sum(m.investimento) > 0
  ),
  ad as (
    select m.ad_id, max(m.ad_nome) as ad_nome, m.ad_account_id,
           sum(m.investimento) as investimento, sum(m.impressoes) as impressoes,
           sum(m.cliques_link) as cliques_link, sum(m.video_3s) as video_3s,
           sum(m.video_75pct) as video_75pct, sum(m.initiate_checkout) as checkouts,
           sum(m.visualizacoes_pagina) as visualizacoes,
           sum(m.compras_meta)::integer as vendas_meta,
           sum(m.faturamento_atribuido) as receita_meta
      from metricas_meta m
      join contas_ativas c on c.ad_account_id = m.ad_account_id
     where m.nivel = 'ad' and m.data between p_ini and p_fim and m.ad_id is not null
       and (p_conta is null or m.ad_account_id = p_conta)
     group by m.ad_id, m.ad_account_id
  ),
  -- Do histórico inteiro, nunca da janela da tela.
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
  cand_ok as (
    select * from cand where no_projeto or not conta_mapeada
  ),
  resumo as (
    select ad_id, count(*) as cards, count(responsavel_id) as com_editor,
           count(distinct responsavel_id) as editores
      from cand_ok group by ad_id
  ),
  ranqueado as (
    select ad_id, id,
           row_number() over (
             partition by ad_id
             order by (criado <= estreia) desc, abs(criado - estreia)
           ) as pos
      from cand_ok where responsavel_id is not null
  ),
  pela_data as (select ad_id, id as producao_id from ranqueado where pos = 1),
  sem_dono as (
    select ad_id, (array_agg(id order by criado desc))[1] as producao_id
      from cand_ok group by ad_id
  ),
  -- Existe card com o nome, mas nenhum do projeto desta conta: não atribui.
  so_outro_projeto as (
    select c.ad_id from cand c
     where c.conta_mapeada
     group by c.ad_id
    having count(*) filter (where c.no_projeto) = 0
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
      left join (select ad_id_meta as ad_id, id as producao_id
                   from producoes where ad_id_meta is not null) e on e.ad_id = a.ad_id
      left join pela_data d ON d.ad_id = a.ad_id
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
$function$;

-- ---------------------------------------------------------------------------
-- 5. As views da aba de análise de Vendas
-- ---------------------------------------------------------------------------
-- `vw_vendas_temporal` nunca existiu: o gráfico "Faturamento por Dia" recebia 404
-- desde sempre. As outras quatro não tinham `ad_account_id`, mas a página sempre
-- filtrou por ele — escolher uma conta derrubava a aba inteira com erro de coluna.

create or replace view public.vw_vendas_temporal as
select (v.data_venda at time zone 'America/Sao_Paulo')::date as data,
       v.produto::text as produto, v.ad_account_id,
       count(*) filter (where v.status='aprovada' and v.upsell_de is null) as vendas_aprovadas,
       count(*) filter (where v.status='pendente' and v.upsell_de is null) as vendas_pendentes,
       sum(case when v.status='aprovada' then v.valor_total else 0 end) as faturamento
  from vendas v
 where v.pedido_id not like 'TEST%' and v.pedido_id not like 'LC-%'
 group by 1, 2, 3;

-- Venda sem hora registrada não informa distribuição horária: 7.856 registros têm
-- `data_venda` na meia-noite exata porque o horário nunca foi capturado (as com hora
-- real só começam em 08/03/26). Todas caíam na barra das 0h e a tela anunciava um
-- "Pico: 0h" que não existe — o pico real é 8h. `base_taxa` sai junto para o front
-- recalcular a taxa sobre os totais somados, em vez de fazer média de percentuais.
drop view if exists public.vw_vendas_por_horario;
create view public.vw_vendas_por_horario as
select hora_venda as hora, produto::text as produto, ad_account_id,
       count(*) filter (where status='aprovada' and upsell_de is null) as vendas_aprovadas,
       count(*) filter (where status='pendente' and upsell_de is null) as vendas_pendentes,
       count(*) filter (where upsell_de is null)                        as base_taxa,
       sum(case when status='aprovada' then valor_total else 0 end)     as faturamento,
       round(count(*) filter (where status='aprovada' and upsell_de is null)::numeric
             / nullif(count(*) filter (where upsell_de is null),0) * 100, 2) as taxa_aprovacao_pct
  from vendas
 where pedido_id not like 'TEST%'
   and (data_venda at time zone 'America/Sao_Paulo')::time <> time '00:00:00'
 group by hora_venda, produto, ad_account_id;

drop view if exists public.vw_vendas_por_dia_semana;
create view public.vw_vendas_por_dia_semana as
select extract(dow from (data_venda at time zone 'America/Sao_Paulo'))::int as dia_semana,
       (array['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[extract(dow from (data_venda at time zone 'America/Sao_Paulo'))::int + 1] as dia_nome,
       produto::text as produto, ad_account_id,
       count(*) filter (where status='aprovada' and upsell_de is null) as vendas_aprovadas,
       sum(case when status='aprovada' then valor_total else 0 end) as faturamento,
       round(count(*) filter (where status='aprovada' and upsell_de is null)::numeric
             / nullif(count(*) filter (where upsell_de is null),0) * 100, 2) as taxa_aprovacao_pct
  from vendas where pedido_id not like 'TEST%'
 group by 1, 2, 3, 4;

drop view if exists public.vw_vendas_por_mes;
create view public.vw_vendas_por_mes as
select mes_ano, produto::text as produto, ad_account_id,
       count(*) filter (where status='aprovada' and upsell_de is null) as vendas_aprovadas,
       count(*) filter (where status='pendente' and upsell_de is null) as vendas_pendentes,
       sum(case when status='aprovada' then valor_total else 0 end) as faturamento,
       round(count(*) filter (where status='aprovada' and upsell_de is null)::numeric
             / nullif(count(*) filter (where upsell_de is null),0) * 100, 2) as taxa_aprovacao_pct,
       round(sum(case when status='aprovada' then valor_total else 0 end)
             / nullif(count(*) filter (where status='aprovada' and upsell_de is null),0), 2) as ticket_medio
  from vendas
 where pedido_id not like 'TEST%' and pedido_id not like 'LC-%'
 group by mes_ano, produto, ad_account_id;

drop view if exists public.vw_vendas_por_pagamento;
create view public.vw_vendas_por_pagamento as
select coalesce(meio_pagamento::text,'desconhecido') as meio_pagamento,
       produto::text as produto, ad_account_id,
       count(*) as total_tentativas,
       count(*) filter (where status='aprovada') as aprovadas,
       count(*) filter (where status='pendente') as pendentes,
       count(*) filter (where status='cancelada') as canceladas,
       count(*) filter (where status='expirada') as expiradas,
       count(*) filter (where status in ('reembolsada','chargeback')) as reembolsadas,
       sum(case when status='aprovada' then valor_total else 0 end) as faturamento,
       round(count(*) filter (where status='aprovada')::numeric / nullif(count(*),0) * 100, 2) as taxa_aprovacao_pct,
       round(sum(case when status='aprovada' then valor_total else 0 end)
             / nullif(count(*) filter (where status='aprovada'),0), 2) as ticket_medio
  from vendas
 where pedido_id not like 'TEST%' and pedido_id not like 'LC-%'
 group by 1, 2, 3;

commit;
