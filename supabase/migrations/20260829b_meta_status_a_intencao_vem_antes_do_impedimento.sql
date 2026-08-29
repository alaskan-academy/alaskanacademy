-- A primeira leitura classificava como "bloqueado" três anúncios cujo `status`
-- era PAUSED. Estão com WITH_ISSUES, mas a pessoa DESLIGOU: o impedimento só
-- importa se alguém quer que aquilo rode.
--
-- Então a intenção vem primeiro. `status` é a chave que a pessoa virou;
-- `effective_status` só é consultado quando a chave está ligada. Isso separa
-- "não quero que rode" de "quero e não roda", e só a segunda gera trabalho.
--
-- E ganha uma situação que faltava: `barrado_pelo_pai`. Um anúncio ACTIVE dentro
-- de conjunto pausado vem como ADSET_PAUSED, e até agora caía no balaio
-- "parado" junto com o que foi desligado de propósito — sumindo exatamente o
-- caso que fez esta tabela existir. Medido logo depois: são 28 anúncios e 1
-- conjunto, R$ 2.347,21 de verba em 30 dias, todos invisíveis antes.
create or replace view public.vw_meta_status as
with entrega as (
  select
    nivel,
    coalesce(ad_id, adset_id, campanha_id) as objeto_id,
    max(data) filter (where impressoes > 0)   as ultima_entrega,
    max(data) filter (where investimento > 0) as ultimo_gasto,
    sum(investimento) filter (where data >= current_date - 30) as inv_30d
  from public.metricas_meta
  group by 1, 2
)
select
  o.id,
  o.ad_account_id,
  c.nome as conta,
  o.nivel,
  o.objeto_id,
  o.nome,
  o.pai_id,
  -- O salto duplo até a campanha. Nulo significa que o conjunto do anúncio não
  -- veio da API: ausência que precisa aparecer, não ser preenchida por chute.
  case o.nivel
    when 'campanha' then o.objeto_id
    when 'adset'    then o.pai_id
    when 'ad'       then pai.pai_id
  end as campanha_id,
  o.status,
  o.effective_status,
  o.orcamento_diario,
  o.orcamento_total,
  o.objetivo,
  -- Derivado, nunca guardado ao lado do effective_status: dois campos dizendo a
  -- mesma coisa sempre divergem.
  (o.effective_status = 'ACTIVE') as ativo,
  e.ultima_entrega,
  e.ultimo_gasto,
  e.inv_30d,
  case when e.ultima_entrega is null then null
       else (current_date - e.ultima_entrega) end as dias_sem_entregar,
  case
    -- A API não confirma mais este objeto: o status guardado é passado, e
    -- afirmar qualquer coisa sobre ele seria inventar.
    when o.visto_em < now() - interval '2 days'                     then 'sem_dado'
    -- A pessoa desligou. Fim da consulta: o que a Meta acha não importa.
    when o.status is distinct from 'ACTIVE'                          then 'parado'
    -- Daqui para baixo a chave está LIGADA, e a pergunta é por que não roda.
    when o.effective_status = 'ACTIVE' and e.ultima_entrega is null  then 'ativo_nunca_entregou'
    when o.effective_status = 'ACTIVE'
         and e.ultima_entrega < current_date - 1                     then 'ativo_sem_entregar'
    when o.effective_status = 'ACTIVE'                               then 'rodando'
    when o.effective_status in ('DISAPPROVED', 'WITH_ISSUES')        then 'bloqueado'
    when o.effective_status in ('PENDING_REVIEW', 'IN_PROCESS')      then 'em_analise'
    when o.effective_status in ('CAMPAIGN_PAUSED', 'ADSET_PAUSED')   then 'barrado_pelo_pai'
    -- Valor que a Meta inventou depois: aparece como desconhecido em vez de
    -- cair calado num balaio. Terceira armadilha do CLAUDE.md.
    else 'desconhecido'
  end as situacao,
  o.visto_em,
  o.atualizado_em
from public.meta_objetos o
left join public.ad_accounts c on c.id = o.ad_account_id
left join public.meta_objetos pai
       on pai.ad_account_id = o.ad_account_id
      and pai.nivel = 'adset'
      and pai.objeto_id = o.pai_id
      and o.nivel = 'ad'
left join entrega e on e.nivel = o.nivel and e.objeto_id = o.objeto_id;

comment on view public.vw_meta_status is
  'O que a Meta diz (status) cruzado com o que o objeto entregou (impressão). '
  'A intenção (status) vem antes do impedimento (effective_status): só faz '
  'sentido perguntar por que não roda o que alguém ligou.';
