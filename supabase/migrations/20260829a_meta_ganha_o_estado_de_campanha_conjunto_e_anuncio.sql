-- O dashboard sabia o DESEMPENHO de cada anúncio e não sabia se ele estava
-- ligado.
--
-- O motivo é a API: `/insights` devolve gasto, impressão e conversão, nunca
-- configuração. Status mora em três outros endereços — /campaigns, /adsets e
-- /ads — e é isso que esta migração passa a guardar.
--
-- POR QUE NÃO DEU PARA DEDUZIR DA IMPRESSÃO
--
-- A hipótese era "sem impressão há 2 dias = desligado". Medido contra 4 meses
-- (821 anúncios, 751 episódios de silêncio com desfecho observável): a regra
-- erra 33,6% das vezes — 252 anúncios ficaram 2+ dias calados e VOLTARAM a
-- rodar. Quem volta fica em média 4,6 dias calado; o recorde ficou 88 dias.
--
-- Esticar a janela conserta o erro e mata a utilidade: 7 dias derrubam o erro
-- para 5,0%, mas aí a tela responde "o que estava ativo semana passada". Ou é
-- rápido e errado, ou é certo e lento.
--
-- E três coisas a impressão nunca responde: anúncio reprovado nunca teve uma
-- impressão e por isso não tem nem LINHA em `metricas_meta` (é invisível, não
-- mal classificado); anúncio pausado hoje de manhã gastou ontem e parece
-- ligado; e o zero não tem motivo — conjunto pausado, campanha pausada,
-- orçamento estourado e reprovação produzem exatamente o mesmo zero.

create table if not exists public.meta_objetos (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,

  -- O enum que `metricas_meta` já usa, e não um `text` com check próprio: dois
  -- lugares definindo "quais são os níveis" divergiriam no dia em que a Meta
  -- ganhasse um quarto, e o join com metricas_meta precisaria de cast.
  nivel public.nivel_meta not null,
  objeto_id text not null,
  nome text,

  -- O pai: conjunto aponta para a campanha, anúncio aponta para o conjunto.
  --
  -- Só o pai DIRETO. A API devolve `campaign_id` também na aresta /ads, e
  -- guardar os dois seria a primeira armadilha do CLAUDE.md — dois campos
  -- dizendo a mesma coisa até divergirem. A campanha de um anúncio sai do
  -- salto duplo, e quando o salto falha isso é informação: significa que o
  -- conjunto sumiu da API.
  pai_id text,

  -- Os dois status, que juntos são o motivo desta tabela existir.
  --
  --   status            a chave que a pessoa virou: ACTIVE, PAUSED, ARCHIVED
  --   effective_status  o status de verdade, já considerando os pais e a
  --                     revisão: CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED,
  --                     PENDING_REVIEW, WITH_ISSUES, IN_PROCESS…
  --
  -- Um anúncio ACTIVE dentro de um conjunto pausado tem effective_status
  -- ADSET_PAUSED. É a resposta para "está ligado e não roda — por quê?".
  --
  -- Texto livre, SEM check constraint: a Meta acrescenta valor novo sem avisar,
  -- e uma lista fechada aqui rejeitaria o registro inteiro no dia em que isso
  -- acontecesse. É a terceira armadilha do CLAUDE.md — lista fixa que envelhece
  -- em silêncio. Valor desconhecido tem que APARECER cru na tela, não sumir.
  status text,
  effective_status text,

  -- Em unidades de moeda, já divididos por 100: a API devolve em centavos.
  -- Anúncio não tem orçamento próprio — os dois ficam nulos nesse nível.
  orcamento_diario numeric,
  orcamento_total numeric,

  objetivo text,               -- só campanha
  criado_em_meta timestamptz,
  atualizado_em_meta timestamptz,

  -- A quarta armadilha do CLAUDE.md: todo espelho precisa de gatilho, não de
  -- carga inicial. Aqui o "gatilho" é o sync reescrever `visto_em` a cada
  -- rodada. Um objeto que parou de vir da API mantém o `visto_em` velho — então
  -- dá para dizer "sumiu da API há N dias" em vez de mostrar um status
  -- congelado como se fosse atual. Sem isto, um anúncio arquivado ficaria
  -- eternamente ACTIVE na tela e nada denunciaria.
  visto_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (ad_account_id, nivel, objeto_id)
);

comment on table public.meta_objetos is
  'Estado atual (não histórico) de campanhas, conjuntos e anúncios da Meta. '
  'Uma linha por objeto, reescrita a cada rodada do sync. O histórico de '
  'desempenho continua em metricas_meta.';

comment on column public.meta_objetos.visto_em is
  'Última vez que a API confirmou este objeto. Se ficou para trás, o objeto '
  'sumiu da API e o status abaixo é passado, não presente.';

-- Casar com `metricas_meta`, que guarda o id da Meta em colunas de texto.
create index if not exists meta_objetos_lookup
  on public.meta_objetos (nivel, objeto_id);
create index if not exists meta_objetos_pai
  on public.meta_objetos (pai_id) where pai_id is not null;
create index if not exists meta_objetos_conta
  on public.meta_objetos (ad_account_id, nivel);

alter table public.meta_objetos enable row level security;

drop policy if exists meta_objetos_authenticated on public.meta_objetos;
create policy meta_objetos_authenticated on public.meta_objetos
  for all to authenticated using (true) with check (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- A leitura cruzada: o que a Meta diz × o que entregou
--
-- Os dois sinais respondem perguntas diferentes, e é o cruzamento que gera
-- ação. Nenhuma destas quatro linhas existe com um sinal só:
--
--   ACTIVE      + calado há 2 dias   ligado e NÃO entregando — verba, público, lance
--   ACTIVE      + entregando         rodando
--   PAUSED      + gastou ontem       pausado hoje, normal
--   DISAPPROVED + nunca entregou     reprovado — resolver hoje
--
-- `ativo` é DERIVADO aqui, nunca guardado ao lado do effective_status: dois
-- campos dizendo a mesma coisa sempre divergem (primeira armadilha).
-- ─────────────────────────────────────────────────────────────────────────────
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
  c.nome                                 as conta,
  o.nivel,
  o.objeto_id,
  o.nome,
  o.pai_id,
  -- O salto duplo até a campanha. Nulo aqui significa que o conjunto do anúncio
  -- não veio da API — ausência que precisa aparecer, não ser preenchida por
  -- chute.
  case o.nivel
    when 'campanha' then o.objeto_id
    when 'adset'    then o.pai_id
    when 'ad'       then pai.pai_id
  end                                    as campanha_id,
  o.status,
  o.effective_status,
  o.orcamento_diario,
  o.orcamento_total,
  o.objetivo,

  /* A Meta usa ACTIVE no `effective_status` só quando o objeto está de fato
     liberado para rodar — qualquer bloqueio de pai ou de revisão substitui o
     valor. Por isso a comparação é exata, e qualquer valor novo cai como não
     ativo em vez de virar ativo por engano. */
  (o.effective_status = 'ACTIVE')        as ativo,

  e.ultima_entrega,
  e.ultimo_gasto,
  e.inv_30d,
  case
    when e.ultima_entrega is null then null
    else (current_date - e.ultima_entrega)
  end                                    as dias_sem_entregar,

  /* O cruzamento, em uma palavra. `sem_dado` cobre o objeto que a API não
     confirma mais: o status guardado é passado, e afirmar qualquer coisa sobre
     ele seria inventar. */
  case
    when o.visto_em < now() - interval '2 days'                      then 'sem_dado'
    when o.effective_status = 'ACTIVE' and e.ultima_entrega is null   then 'ativo_nunca_entregou'
    when o.effective_status = 'ACTIVE'
         and e.ultima_entrega < current_date - 1                      then 'ativo_sem_entregar'
    when o.effective_status = 'ACTIVE'                                then 'rodando'
    when o.effective_status in ('DISAPPROVED', 'WITH_ISSUES')         then 'bloqueado'
    when o.effective_status in ('PENDING_REVIEW', 'IN_PROCESS')       then 'em_analise'
    else 'parado'
  end                                    as situacao,

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
  'Uma linha por campanha, conjunto e anúncio.';
