-- O mapa: tudo o que um REV tem, numa linha só.
--
-- Existe para responder a pergunta que ela faz e o dash não sabia responder:
-- "onde está rodando a h07?". Hoje isso exige abrir REV por REV, ou lembrar.
-- E a mesma forma responde as irmãs: onde está este domínio, de qual REV é
-- este checkout, qual REV usa esta página.
--
-- Por que view e não junção na tela: são seis tabelas (funis, projetos, vsls,
-- dominios, funil_checkouts, vendas) e a busca precisa varrer TODAS elas ao
-- mesmo tempo. Montado no cliente, viraria seis consultas e um cruzamento à mão
-- a cada tecla digitada.
--
-- São 23 REVs, então a tela filtra em memória e a view não precisa de parâmetro.

create or replace view public.vw_mapa_revs as
select
  f.id,
  f.nome                    as rev,
  f.status,
  f.metodo,
  f.url_page,
  p.id                      as projeto_id,
  p.nome                    as projeto,

  v.id                      as vsl_id,
  v.nome                    as vsl,
  v.duracao_seg             as vsl_duracao,

  d.dominios,
  c.checkouts,
  coalesce(vd.vendas, 0)    as vendas,
  vd.ultima_venda,

  -- Um campo só com tudo o que é procurável, para a tela não ter que decidir
  -- onde procurar. `unaccent` porque ninguém digita "Buquê" com acento na
  -- pressa, e `lower` porque ninguém digita "H07" igual duas vezes.
  unaccent(lower(concat_ws(' ',
    f.nome, p.nome, v.nome, f.url_page, f.metodo,
    array_to_string(d.dominios, ' '),
    array_to_string(c.checkouts, ' ')
  )))                       as busca

from public.funis f
left join public.ofertas_editores p on p.id = f.projeto_id
left join public.vsls v              on v.id = f.vsl_id

-- Domínios: a tabela guarda `funil_ids` (lista) e `funil_id` (legado), e as
-- duas convivem. Ler só uma perderia vínculos.
left join lateral (
  select array_agg(dm.nome order by dm.nome) as dominios
  from public.dominios dm
  where f.id::text = any(coalesce(nullif(dm.funil_ids, '{}'), array[dm.funil_id::text]))
) d on true

left join lateral (
  select array_agg(distinct fc.titulo) filter (where fc.titulo is not null) as checkouts
  from public.funil_checkouts fc
  where fc.funil_id = f.id
) c on true

left join lateral (
  select count(*) as vendas, max(data_venda)::date as ultima_venda
  from public.vendas ve
  where ve.funil_id = f.id
) vd on true;

comment on view public.vw_mapa_revs is
  'Um REV por linha, com projeto, VSL, domínios, checkouts e vendas. A coluna '
  '`busca` concatena tudo sem acento e em minúsculas para a tela filtrar com '
  'um campo só.';

alter view public.vw_mapa_revs set (security_invoker = on);

-- Serve a contagem de vendas por REV, aqui e em qualquer métrica futura por
-- funil. Sem ele, cada REV varre as 13.552 vendas.
create index if not exists idx_vendas_funil on public.vendas (funil_id)
  where funil_id is not null;
