-- O cartão diz o que o descritor esconde.
--
-- A empresa usa um cartão virtual por finalidade, e isso estava no payload o
-- tempo todo em `card.maskedNumber`. É um sinal muito mais forte que o texto:
-- os 540 lançamentos "FACEBK *<id aleatório>" são indistinguíveis entre si, mas
-- os cartões 4353 e 7488 são os de WhatsApp e o resto é campanha.
--
-- Serve para além da Meta: 4294 é o Spedy (R$ 3.428,18, bate ao centavo),
-- 5214 o VTurb, 7055 a UTMify, 4627 a Hostinger, 1488 o Supabase.
create table if not exists public.cartoes (
  masked_number text primary key,
  nome          text,
  finalidade    text,
  definido      boolean not null default false,
  criado_em     timestamptz not null default now()
);

comment on table public.cartoes is
  'Cartões virtuais da Conta Simples. O cartão identifica a finalidade do gasto melhor que o descritor.';
comment on column public.cartoes.finalidade is
  'ads | whatsapp | ferramenta | outros — usada para conciliar com o que a Meta reporta.';

alter table public.cartoes enable row level security;
drop policy if exists cartoes_rw on public.cartoes;
create policy cartoes_rw on public.cartoes
  for all to authenticated using (true) with check (true);

-- Semeia com tudo que já apareceu no extrato, para nenhum cartão ficar de fora
-- da tela quando ela for nomear.
insert into public.cartoes (masked_number)
select distinct payload_raw->'card'->>'maskedNumber'
  from public.transacoes
 where payload_raw->'card'->>'maskedNumber' is not null
on conflict (masked_number) do nothing;

-- Os dois que ela identificou pelo nome no app da Conta Simples.
update public.cartoes set nome = 'Meta WhatsApp - Laur',    finalidade = 'whatsapp', definido = true
 where masked_number = '•••• 4353';
update public.cartoes set nome = 'Meta WhatsApp - Handify', finalidade = 'whatsapp', definido = true
 where masked_number = '•••• 7488';

-- Cartão que só gastou em FACEBK e não é de WhatsApp é de campanha. Inferência,
-- não declaração: fica `definido = false` até ela confirmar.
update public.cartoes c
   set finalidade = 'ads'
  from (
    select payload_raw->'card'->>'maskedNumber' as cartao
      from public.transacoes
     where payload_raw->'card'->>'maskedNumber' is not null and valor < 0
     group by 1
    having count(*) = count(*) filter (where descricao ilike 'FACEBK%')
  ) s
 where c.masked_number = s.cartao and c.finalidade is null;

grant select, insert, update, delete on public.cartoes to authenticated;

-- A conciliação passa a usar o cartão. `coalesce(finalidade,'ads')` porque
-- cartão ainda não classificado que gastou em FACEBK é campanha até prova em
-- contrário — WhatsApp é a exceção, e ela está declarada.
drop view if exists public.vw_conciliacao_meta;

create view public.vw_conciliacao_meta as
with meta as (
  select date_trunc('month', data)::date as mes,
         sum(investimento)::numeric(14,2) as ads_meta
    from public.metricas_meta
   where nivel::text = 'campanha'
   group by 1
),
banco as (
  select date_trunc('month', t.data)::date as mes,
         sum(-t.valor) filter (where coalesce(c.finalidade,'ads') <> 'whatsapp')::numeric(14,2) as ads_banco,
         sum(-t.valor) filter (where c.finalidade = 'whatsapp')::numeric(14,2) as whatsapp,
         sum(-t.valor)::numeric(14,2) as saiu_banco,
         count(*)::int as lancamentos
    from public.transacoes t
    left join public.cartoes c on c.masked_number = t.payload_raw->'card'->>'maskedNumber'
   where t.valor < 0 and t.descricao ilike 'FACEBK%'
   group by 1
)
select coalesce(m.mes, b.mes) as mes,
       m.ads_meta,
       coalesce(b.ads_banco, 0) as ads_banco,
       coalesce(b.whatsapp, 0)  as whatsapp,
       b.saiu_banco,
       b.lancamentos,
       (coalesce(b.ads_banco,0) - m.ads_meta)::numeric(14,2) as residuo,
       case when m.ads_meta > 0
            then round(100.0 * (coalesce(b.ads_banco,0) - m.ads_meta) / m.ads_meta, 1)
       end as pct_residuo,
       (date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
         = coalesce(m.mes, b.mes)) as mes_em_curso
  from meta m
  full join banco b on b.mes = m.mes
 where m.ads_meta is not null or b.saiu_banco is not null;

comment on view public.vw_conciliacao_meta is
  'Saída para a Meta separada por cartão, contra o gasto de campanha reportado.';

grant select on public.vw_conciliacao_meta to authenticated;
