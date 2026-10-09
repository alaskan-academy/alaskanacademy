-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Nem toda linha de venda_itens é um bump                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `20261010g` contava como bump TODA linha de `venda_itens`. São 41 linhas,
-- em 2 códigos, com `tipo = 'oferta_principal'`: o produto do próprio pedido
-- registrado como item. O resultado apareceu na primeira leitura da view —
-- o "Workshop Buquê de Velas" com 39 bumps cujo slot era, literalmente,
-- **"oferta_principal"**.
--
-- Número estranho costuma estar errado, e este estava. Com 1.224 vendas
-- diretas o predominante dele não mudava, mas `formas` dizia 2 quando é 1 —
-- e a view existe exatamente para contar de quantos jeitos a oferta vende.
--
-- ── Por que uma migração nova em vez de editar a anterior ───────────────
--
-- A `g` já tinha sido aplicada. Reescrever o arquivo dela deixaria o
-- repositório diferente do que está em `supabase_migrations.schema_migrations`
-- — e vários testes deste projeto leem as MIGRAÇÕES, não o banco. Arquivo que
-- não bate com o aplicado é a catraca olhando para a definição errada.
--
-- Mesma razão de `20260921d`/`e` terem sido um par: o conserto vem depois,
-- não por cima.
--
-- A lista de colunas é idêntica à de `g`.

begin;

create or replace view public.vw_oferta_como_vende
  with (security_invoker = on) as
with por_venda as (
  -- Como PRODUTO do pedido: ou é a oferta principal, ou é um upsell.
  -- `is_upsell` é a fonte, e é a única: nunca re-derivar do payload (o
  -- CLAUDE.md conta que 608 das 650 marcações vieram de backfill e não têm
  -- payload nenhum).
  select (v.payload_webhook -> 'product' ->> 'code') as code_payt,
         count(*) filter (where not coalesce(v.is_upsell, false)) as como_principal,
         count(*) filter (where v.is_upsell)                      as como_upsell,
         sum(coalesce(v.valor_sem_juros, v.valor_total))
           filter (where not coalesce(v.is_upsell, false))        as receita_principal,
         sum(coalesce(v.valor_sem_juros, v.valor_total))
           filter (where v.is_upsell)                             as receita_upsell,
         max(v.data_venda)                                        as ultima_venda
    from public.vendas v
   where v.status = 'aprovada'
     and (v.payload_webhook -> 'product' ->> 'code') is not null
   group by 1
),
por_item as (
  -- Como BUMP dentro do pedido de outra coisa. A existência da linha É a
  -- conversão: `venda_itens.converteu` é constante `true` e não serve de
  -- filtro (CLAUDE.md).
  --
  -- A data vem da venda-mãe: `venda_itens` não tem coluna de data própria.
  -- Suas colunas são id, venda_id, oferta_id, code_payt, tipo, nome, valor,
  -- converteu e pedido_id_payt — o bump herda o quando do pedido em que entrou.
  select vi.code_payt,
         count(*)                   as como_bump,
         count(distinct vi.tipo)    as slots_de_bump,
         string_agg(distinct vi.tipo::text, ', ' order by vi.tipo::text) as slots,
         max(v.data_venda)          as ultimo_bump
    from public.venda_itens vi
    join public.vendas v on v.id = vi.venda_id
   where vi.code_payt is not null
     -- O FILTRO QUE FALTAVA. Nem toda linha de `venda_itens` é bump: 41
     -- delas, em 2 códigos, têm `tipo = 'oferta_principal'` — é o produto do
     -- próprio pedido registrado como item.
     --
     -- `like 'orderbump%'` e não uma lista dos quatro slots de propósito: o
     -- dia em que a Payt ganhar um orderbump_5, ele entra sozinho. Terceira
     -- armadilha.
     and vi.tipo::text like 'orderbump%'
   group by 1
),
junto as (
  select o.id,
         o.code_payt,
         o.nome,
         o.tipo::text                        as tipo_cadastrado,
         o.produto::text                     as produto,
         o.ativo,
         coalesce(pv.como_principal, 0)      as como_principal,
         coalesce(pv.como_upsell, 0)         as como_upsell,
         coalesce(pi.como_bump, 0)           as como_bump,
         pi.slots                            as slots_de_bump,
         coalesce(pi.slots_de_bump, 0)       as qtd_slots_de_bump,
         round(coalesce(pv.receita_principal, 0) + coalesce(pv.receita_upsell, 0), 2) as receita_como_venda,
         greatest(pv.ultima_venda, pi.ultimo_bump) as ultima_vez
    from public.ofertas o
    left join por_venda pv on pv.code_payt = o.code_payt
    left join por_item  pi on pi.code_payt = o.code_payt
)
select j.*,
       -- De quantos jeitos diferentes ela já foi vendida.
       (case when j.como_principal > 0 then 1 else 0 end)
     + (case when j.como_upsell    > 0 then 1 else 0 end)
     + (case when j.como_bump      > 0 then 1 else 0 end) as formas,
       -- O jeito mais frequente. Serve para comparar com a intenção, nunca
       -- para substituir o campo: num card de 594 bumps, 15 upsells e 8
       -- diretas, dizer só "bump" esconde as outras duas.
       case when j.como_bump >= greatest(j.como_principal, j.como_upsell) and j.como_bump > 0
              then 'bump'
            when j.como_upsell >= j.como_principal and j.como_upsell > 0
              then 'upsell'
            when j.como_principal > 0
              then 'principal'
            else null
       end as predominante,
       -- A intenção bate com o fato? NULO quando nunca vendeu: aí não há fato
       -- para comparar, e dizer "não bate" seria acusar o cadastro de um
       -- silêncio que é do produto.
       case
         when j.como_principal + j.como_upsell + j.como_bump = 0 then null
         when j.como_bump >= greatest(j.como_principal, j.como_upsell) and j.como_bump > 0
           then j.tipo_cadastrado like 'orderbump%'
         when j.como_upsell >= j.como_principal and j.como_upsell > 0
           then j.tipo_cadastrado = 'upsell'
         else j.tipo_cadastrado = 'oferta_principal'
       end as bate_com_o_cadastro
  from junto j;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_r     record;
begin
  -- 1. Nenhum "bump" tem slot 'oferta_principal'. Era o sintoma.
  select count(*) into v_n from public.vw_oferta_como_vende
   where slots_de_bump like '%oferta_principal%';
  if v_n > 0 then
    v_erros := v_erros || format('%s oferta(s) ainda contam oferta_principal como bump. ', v_n);
  end if;

  -- 2. O caso que denunciou: Workshop Buque vende de UMA forma, nao duas.
  select * into v_r from public.vw_oferta_como_vende where code_payt = 'R2JAJA';
  if v_r.code_payt is null then
    v_erros := v_erros || 'nao achei R2JAJA. ';
  elsif v_r.como_bump <> 0 then
    v_erros := v_erros || format('R2JAJA ainda aparece com %s bump(s). ', v_r.como_bump);
  end if;

  -- 3. E a Saboaria, que vende de verdade das tres formas, continua com tres.
  --    Um filtro apertado demais mataria o caso que originou a view inteira.
  select * into v_r from public.vw_oferta_como_vende where code_payt = '4M2WW6';
  if v_r.formas <> 3 or v_r.qtd_slots_de_bump <> 2 then
    v_erros := v_erros || format('4M2WW6 ficou com %s forma(s) e %s slot(s), esperava 3 e 2. ',
      v_r.formas, v_r.qtd_slots_de_bump);
  end if;

  -- 4. A lista de colunas nao mudou em relacao a `g`.
  select count(*) into v_n from information_schema.columns
   where table_name = 'vw_oferta_como_vende';
  if v_n <> 16 then
    v_erros := v_erros || format('a view tem %s colunas, esperava 16. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.vw_oferta_como_vende where formas > 1;
  raise notice 'PROVA OK: so orderbump conta como bump. % oferta(s) vendem de mais de uma forma.', v_n;
end $prova$;

notify pgrst, 'reload schema';
