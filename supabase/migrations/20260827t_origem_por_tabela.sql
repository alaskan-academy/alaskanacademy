-- A origem da venda sai de tabela, e não de uma lista escrita no código.
--
-- `calcular_origem` conhecia cinco strings: 'facebook', 'instagram', 'meta',
-- 'organic', 'direct'. Tudo o mais virava 'desconhecido' — e depois que a
-- limpeza do UTM tirou o id de sessão de cima das fontes, deu para ver o
-- tamanho do buraco: 113 vendas de agosto em "desconhecido" com fonte
-- perfeitamente conhecida — whatsapp (62), area-membros-handify (26),
-- site-handify (20), chatgpt.com (3), Voxuy (2).
--
-- Acrescentar essas cinco à lista do código repetiria a armadilha nº 3: a
-- SEXTA fonte — um número de WhatsApp novo, um site novo, uma ferramenta nova —
-- cairia calada em "desconhecido" de novo, e ninguém saberia até alguém
-- desconfiar de um número.
--
-- Com a tabela, classificar uma fonte nova é um INSERT, sem deploy. E o
-- 'desconhecido' deixa de ser um balaio para virar FILA: é exatamente "fonte
-- que ninguém classificou ainda", e `vw_origens_a_classificar` mostra quais.

-- ---------------------------------------------------------------------------
-- A tabela
-- ---------------------------------------------------------------------------

create table if not exists public.origens_utm (
  -- Em minúsculas: a Payt manda 'FB' e 'Voxuy', e a fonte é a mesma coisa
  -- escrita de dois jeitos. A busca normaliza antes de comparar.
  utm_source text primary key,
  origem     origem_venda not null,
  observacao text,
  criado_em  timestamptz not null default now()
);

comment on table public.origens_utm is
  'De onde veio cada utm_source. Classificar fonte nova e um INSERT aqui, sem '
  'deploy -- ver vw_origens_a_classificar para as que ainda faltam.';

alter table public.origens_utm enable row level security;

drop policy if exists origens_utm_admin on public.origens_utm;
create policy origens_utm_admin on public.origens_utm
  for all to authenticated using (true) with check (true);

insert into public.origens_utm (utm_source, origem, observacao) values
  ('fb',                   'pago',     'Meta Ads — o que a Payt manda como "FB"'),
  ('ig',                   'pago',     'Meta Ads pelo Instagram'),
  ('facebook',             'pago',     null),
  ('instagram',            'pago',     null),
  ('meta',                 'pago',     null),
  ('whatsapp',             'organico', 'Conversa, não anúncio'),
  ('site-handify',         'organico', 'Site próprio'),
  ('area-membros-handify', 'organico', 'Área de membros — aluna que já é cliente'),
  -- Achada pela própria `vw_origens_a_classificar` no primeiro dia: 20 vendas
  -- de mar/26 a jul/26 que eu não tinha visto por só ter olhado agosto. Entra
  -- pela mesma regra — a instrução foi "area-membros", não uma área específica.
  ('area-membros-laura',   'organico', 'Área de membros — mesma regra da handify'),
  ('chatgpt.com',          'organico', 'Referência de fora, sem custo de mídia'),
  ('voxuy',                'organico', 'Ferramenta própria de mensagem'),
  ('organic',              'organico', null),
  ('(organic)',            'organico', null),
  ('direct',               'direto',   null),
  ('(direct)',             'direto',   null)
on conflict (utm_source) do nothing;

-- ---------------------------------------------------------------------------
-- A classificação
-- ---------------------------------------------------------------------------

-- Deixa de ser IMMUTABLE porque agora lê tabela. Confirmado antes de mudar que
-- ninguém a usa em índice nem em coluna gerada — só `trg_fn_origem`.
create or replace function public.calcular_origem(p_utm_source text, p_utm_medium text)
returns origem_venda
language plpgsql
stable
as $function$
DECLARE
  s TEXT := lower(coalesce(trim(p_utm_source), ''));
  m TEXT := lower(coalesce(trim(p_utm_medium), ''));
  v_origem origem_venda;
BEGIN
  -- Sem fonte nenhuma não há o que classificar. Continua 'organico' como
  -- sempre foi: mudar isso mexeria em 977 vendas de agosto de uma vez, e não
  -- é o que foi pedido.
  IF s = '' THEN RETURN 'organico'; END IF;

  SELECT o.origem INTO v_origem FROM origens_utm o WHERE o.utm_source = s;
  IF v_origem IS NOT NULL THEN RETURN v_origem; END IF;

  IF m IN ('email','newsletter','email_mkt') THEN RETURN 'email'; END IF;

  -- Rede de segurança, e só. Se uma variante de 'FB' escapar da limpeza do
  -- UTM, é melhor contá-la como paga do que deixá-la fora do custo de mídia —
  -- subestimar o investimento é o erro mais caro dos dois.
  IF s LIKE 'fb%' OR s LIKE 'ig%' THEN RETURN 'pago'; END IF;

  -- Fonte que existe e ninguém classificou. É fila, não balaio.
  RETURN 'desconhecido';
END;
$function$;

-- ---------------------------------------------------------------------------
-- A fila
-- ---------------------------------------------------------------------------

-- Sem isto a tabela seria cadastro sem tela de resultado — a armadilha nº 2 —
-- e ninguém voltaria para classificar a fonte nova.
create or replace view public.vw_origens_a_classificar as
select
  v.utm_source,
  count(*)                                                as vendas,
  count(*) filter (where v.status = 'aprovada')           as aprovadas,
  round(sum(v.valor_total) filter (where v.status = 'aprovada')::numeric, 2) as faturamento,
  min((v.data_venda at time zone 'America/Sao_Paulo')::date) as primeira,
  max((v.data_venda at time zone 'America/Sao_Paulo')::date) as ultima
from public.vendas v
where v.utm_source is not null
  and v.utm_source <> ''
  and not exists (
    select 1 from public.origens_utm o where o.utm_source = lower(trim(v.utm_source))
  )
group by v.utm_source
order by 4 desc nulls last, 2 desc;

comment on view public.vw_origens_a_classificar is
  'Fontes que aparecem em vendas e ainda nao tem linha em origens_utm. Sao as '
  'que caem em "desconhecido" -- classificar e um INSERT em origens_utm.';

-- ---------------------------------------------------------------------------
-- O passado
-- ---------------------------------------------------------------------------

-- `trg_origem_venda` recalcula `origem` a cada UPDATE, então tocar as linhas
-- afetadas basta. Carga inicial arruma o que está gravado; o gatilho mantém o
-- presente.
with a_recalcular as (
  select id from public.vendas
  where origem is distinct from
        (case when ad_id_meta is not null then 'pago'::origem_venda
              else calcular_origem(utm_source, utm_medium) end)
)
update public.vendas v set atualizado_em = atualizado_em
from a_recalcular r where v.id = r.id;
