-- O ESTADO DO CARD USA A MESMA REGRA DA TELA
--
-- `vw_producao_estado_ads` classificava `effective_status` cru, com vocabulario
-- proprio (ativo/pausado/reprovado/com_problema). `vw_meta_status` ja faz essa
-- mesma classificacao para a tela do Meta Ads, com outro vocabulario
-- (rodando/parado/barrado_pelo_pai/...). Duas regras respondendo "este anuncio
-- esta no ar?" -- a primeira armadilha do CLAUDE.md, e ela ja divergia.
--
-- ONDE DIVERGIAM (medido em 16/09/2026, sobre 865 vinculos em producao_ads)
--
--   effective_status   vw_meta_status       vw_producao_estado_ads   anuncios
--   PAUSED             parado               pausado                     595
--   ADSET_PAUSED       barrado_pelo_pai     pausado                     109   <-
--   ACTIVE             rodando              ativo                       100
--   (sem objeto)       (sem linha)          sem_anuncio                  58
--   WITH_ISSUES        parado               com_problema                  3   <-
--
-- Os 109 sao o caso que custa: alguem LIGOU o anuncio e o conjunto acima dele
-- esta desligado. Chamar isso de "pausado" junta quem desligou de proposito com
-- quem esqueceu o conjunto fechado, e some com o unico grupo que pede acao.
-- Os 3 WITH_ISSUES sao os mesmos que a migracao 20260829b ja tinha reclassificado
-- do outro lado -- a prova de que manter duas regras nao se sustenta.
--
-- EFEITO NA TELA DE AVALIACAO
--
--   pausado      -> parado               304 cards  (so muda o nome)
--   ativo        -> rodando               92 cards  (so muda o nome)
--   pausado      -> barrado_pelo_pai      87 cards  <- o ganho
--   com_problema -> parado                 3 cards
--   sem_anuncio  -> sem_anuncio           35 cards
--
-- A PRECEDENCIA NAO E A ORDEM DA TELA
--
-- `ORDEM_SITUACAO` em src/features/ads/situacao.ts ordena por "quem pede acao
-- primeiro", e por isso poe bloqueado e barrado_pelo_pai ANTES de rodando. Usar
-- essa ordem para resumir um card com varios anuncios faria 8 cards que estao
-- entregando lerem "Pai pausado". Aqui a pergunta e outra -- "este criativo ainda
-- esta no ar?" -- e "rodando" ganha de tudo. Sao duas ordens porque sao duas
-- perguntas; a de tela mora no TypeScript, a de resumo mora aqui.
--
-- `ultimo_gasto` CONTINUA VINDO DE `metricas_meta`
--
-- `vw_meta_status` tem a coluna, e trocar a fonte pareceria mais limpo. Nao e:
-- 58 vinculos apontam para anuncio que a API nao confirma mais, e 35 cards ficam
-- so com eles. Esses cards TEM historico de gasto em `metricas_meta` e perderiam
-- a data na tela -- some a linha "gastou pela ultima vez em". A fonte antiga
-- responde por anuncio que sumiu; a nova, nao.
--
-- DROP E CREATE, E NAO CREATE OR REPLACE
--
-- As colunas mudam de nome (ativos -> rodando, pausados -> parados), e
-- `create or replace view` so aceita coluna NOVA no fim. Os dois ficam na mesma
-- transacao para nao existir instante sem a view. O front le apenas
-- producao_id, estado e ultimo_gasto -- os tres sobrevivem.

begin;

drop view if exists public.vw_producao_estado_ads;

create view public.vw_producao_estado_ads as
with gasto as (
  select m.ad_id,
         max(m.data) filter (where m.investimento > 0) as ultimo_dia
    from public.metricas_meta m
   where m.nivel = 'ad'
   group by m.ad_id
),
por_card as (
  select pa.producao_id,
         count(*)                as ads_ligados,
         count(ms.objeto_id)     as ads_conhecidos,
         count(*) filter (where ms.situacao = 'rodando') as rodando,
         count(*) filter (where ms.situacao in ('bloqueado','ativo_nunca_entregou',
                'ativo_sem_entregar','barrado_pelo_pai','em_analise')) as pede_acao,
         count(*) filter (where ms.situacao = 'parado')   as parados,
         count(*) filter (where ms.situacao = 'sem_dado') as sem_dado,
         -- A pior entre as que pedem acao, nominal: o selo diz "Pai pausado" e
         -- nao um balaio "pede acao". A ordem e a de ORDEM_SITUACAO, menos o
         -- `rodando`, que e tratado antes.
         min(array_position(array['bloqueado','ativo_nunca_entregou',
               'ativo_sem_entregar','barrado_pelo_pai','em_analise'],
               ms.situacao)) as pior,
         max(ms.visto_em)   as visto_em,
         max(g.ultimo_dia)  as ultimo_gasto
    from public.producao_ads pa
    left join public.vw_meta_status ms
           on ms.nivel = 'ad' and ms.objeto_id = pa.ad_id
    left join gasto g on g.ad_id = pa.ad_id
   group by pa.producao_id
)
select producao_id,
       ads_ligados,
       ads_conhecidos,
       rodando,
       pede_acao,
       parados,
       sem_dado,
       visto_em,
       case
         when ads_conhecidos = 0 then 'sem_anuncio'
         when rodando   > 0 then 'rodando'
         when pede_acao > 0 then (array['bloqueado','ativo_nunca_entregou',
              'ativo_sem_entregar','barrado_pelo_pai','em_analise'])[pior]
         when parados   > 0 then 'parado'
         when sem_dado  > 0 then 'sem_dado'
         else 'sem_anuncio'
       end as estado,
       ultimo_gasto
  from por_card;

comment on view public.vw_producao_estado_ads is
  'O estado dos anuncios de cada card, no vocabulario de vw_meta_status.situacao mais "sem_anuncio". '
  'A regra de "esta no ar?" e uma so, e mora em vw_meta_status. Aqui so se resume varios anuncios '
  'num card: rodando ganha de tudo, depois a pior das que pedem acao. Derivado na leitura, sem gatilho '
  'de proposito -- o estado muda todo dia e guardar seria a quarta armadilha.';

-- Parity com a irma `vw_meta_status`. As duas herdam tambem grant para `anon`
-- das default privileges do schema; apertar isso e decisao separada e vale para
-- as duas juntas, nao para uma so no meio de outra migracao.
grant select on public.vw_producao_estado_ads to authenticated;

-- O campo digitado a mao continua existindo, mas passa a dizer o que e.
comment on column public.producoes.status_veiculacao is
  'INTENCAO digitada a mao, nao fato. O fato esta em vw_producao_estado_ads.estado, derivado de '
  'vw_meta_status. Em 16/09/2026, 2.604 cards tinham este campo preenchido e so 470 tinham anuncio '
  'ligado para conferir; desses 470, 26 ja divergiam (9 marcados "Pausado" com anuncio rodando). '
  'Nao use este campo para decidir se um anuncio esta no ar.';

commit;

-- ---------------------------------------------------------------------------
-- Provas de aceite
-- ---------------------------------------------------------------------------
-- Fora da transacao porque sao conferencia, nao estrutura. Se qualquer uma
-- falhar, a view subiu errada e o erro aparece aqui, e nao tres semanas depois
-- numa tela que ninguem desconfiou.
do $$
declare
  v_traidores  integer;
  v_cards_view integer;
  v_cards_ponte integer;
  v_desconhecidos text;
begin
  -- 1. A invariante da precedencia: card com anuncio entregando NUNCA le outra
  --    coisa. E o erro que o desenho original cometia, e ele seria invisivel:
  --    o contador de contradicao continuaria parecido, com outros casos dentro.
  select count(*) into v_traidores
    from public.vw_producao_estado_ads
   where rodando > 0 and estado <> 'rodando';
  if v_traidores <> 0 then
    raise exception 'vw_producao_estado_ads: % card(s) com anuncio rodando classificados como outra coisa', v_traidores;
  end if;

  -- 2. Nenhum card sumiu da view.
  select count(*) into v_cards_view from public.vw_producao_estado_ads;
  select count(distinct producao_id) into v_cards_ponte from public.producao_ads;
  if v_cards_view <> v_cards_ponte then
    raise exception 'vw_producao_estado_ads: % cards na view contra % em producao_ads', v_cards_view, v_cards_ponte;
  end if;

  -- 3. Terceira armadilha: a Meta inventa `effective_status` novo sem avisar.
  --    Se um valor cair fora do vocabulario conhecido, ele tem que gritar aqui
  --    em vez de virar celula em branco na tela.
  select string_agg(distinct estado, ', ') into v_desconhecidos
    from public.vw_producao_estado_ads
   where estado not in ('rodando','parado','barrado_pelo_pai','bloqueado',
                        'ativo_nunca_entregou','ativo_sem_entregar','em_analise',
                        'sem_dado','sem_anuncio');
  if v_desconhecidos is not null then
    raise exception 'vw_producao_estado_ads: estado fora do vocabulario conhecido: %', v_desconhecidos;
  end if;

  raise notice 'vw_producao_estado_ads: % cards, precedencia e vocabulario conferidos', v_cards_view;
end $$;
