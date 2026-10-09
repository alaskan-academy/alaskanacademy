-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Como a oferta vende DE VERDADE                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Ela disse, olhando a Saboaria Energética: **"vende como as duas formas —
-- bump e up"**. O dado confirma, e vai além: o código `4M2WW6` vende de
-- QUATRO jeitos.
--
--   4M2WW6  cadastrado como orderbump_4
--           8 vendas diretas · 15 como upsell · 594 linhas de bump,
--           em DOIS slots diferentes (orderbump_2 e orderbump_4)
--
-- E não é caso isolado. Medido sobre as 49 ofertas que já venderam:
--
--   vende de 1 forma só ....... 35
--   vende de 2 formas ......... 13
--   vende de 3 formas .......... 1
--   (e 15 ofertas cadastradas nunca venderam nada)
--
-- **29% das ofertas que vendem fazem isso de mais de um jeito.** Um campo de
-- valor único não tem como estar certo nelas.
--
-- ── Isto já estava escrito no CLAUDE.md, e agora tem número ──────────────
--
-- *"um mesmo produto vende como upsell e direto (o Handify Completo: 57 e 9),
-- então o tipo é da venda e não do produto"* — e a conclusão de lá:
-- `ofertas` serve para dar NOME ao upsell, por LEFT JOIN, jamais para decidir
-- se ele é um. Exigir os dois em `vw_conversao_upsell` já cortou 384 vendas e
-- R$ 28.895,49.
--
-- ── Por que NÃO estou "corrigindo" o campo ───────────────────────────────
--
-- A tentação é trocar o `orderbump_4` do `4M2WW6` pelo modo predominante. Seria
-- trocar um valor errado por outro valor errado: 594 bumps, 15 upsells e 8
-- diretas não cabem numa palavra, e escolher a maior esconde as outras duas.
--
-- `tipo` é NOT NULL e tem uso legítimo — é o que a tela de cadastro mostra como
-- INTENÇÃO: para que a oferta foi criada. O que faltava era o resultado ao
-- lado, que é a segunda armadilha do CLAUDE.md: *"nenhuma tela de cadastro sem
-- a coluna de resultado ao lado"*. Os 134 UTMs e os 36 order bumps morreram
-- exatamente assim.
--
-- Esta view é essa coluna. Ela não corrige nada e não decide nada: ela conta.
--
-- ── Os três casos em que a intenção já diverge do fato ───────────────────
--
-- Entre as 49 que venderam, 3 têm `tipo` cadastrado diferente do modo
-- predominante. O mais claro é `4OMBNZ`, cadastrado como `upsell` e com **7
-- vendas diretas e zero upsells**. A view expõe isso em `bate_com_o_cadastro`
-- — sem apagar o campo, porque a divergência entre intenção e fato é
-- informação, do mesmo jeito que a marcação contra o Meta.

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
   -- NOTA: falta aqui o filtro de bump. Corrigido em `20261010h` — ver lá o
   -- motivo. Este arquivo fica como foi aplicado, para o que está em
   -- `supabase_migrations.schema_migrations` continuar batendo com o que está
   -- no repositório.
   where vi.code_payt is not null
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

comment on view public.vw_oferta_como_vende is
  'Como cada oferta vendeu DE VERDADE: quantas vezes como produto principal, '
  'quantas como upsell e quantas como order bump (e em quais slots). Existe '
  'porque `ofertas.tipo` é um campo de valor único e 29% das ofertas que vendem '
  'fazem isso de mais de um jeito — a Saboaria Energética (4M2WW6) vende de '
  'quatro. Esta view NÃO corrige nem decide nada: ela é a coluna de resultado '
  'ao lado do cadastro, que é o que faltava. `tipo` continua sendo a INTENÇÃO; '
  '`predominante` é o fato; `bate_com_o_cadastro` é a divergência, que é '
  'informação e não erro.';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_r     record;
  v_bate  boolean;
begin
  -- 1. Toda oferta cadastrada aparece, inclusive as que nunca venderam: a view
  --    é a coluna de resultado do cadastro, e cadastro sem resultado é
  --    exatamente o que ela existe para mostrar (são 15 hoje).
  select count(*) into v_n from public.ofertas;
  if (select count(*) from public.vw_oferta_como_vende) <> v_n then
    v_erros := v_erros || 'a view nao cobre todas as ofertas cadastradas. ';
  end if;

  select count(*) into v_n from public.vw_oferta_como_vende where formas = 0;
  if v_n = 0 then
    v_erros := v_erros || 'nenhuma oferta sem venda apareceu — a view esta filtrando quem nunca vendeu. ';
  end if;

  -- 2. O CASO QUE ORIGINOU ISTO. A Saboaria do codigo curto vende das tres
  --    formas e em dois slots de bump; se qualquer uma dessas contagens zerar,
  --    a view parou de enxergar um dos canais.
  select * into v_r from public.vw_oferta_como_vende where code_payt = '4M2WW6';
  if v_r.code_payt is null then
    v_erros := v_erros || 'nao achei 4M2WW6 na view. ';
  else
    if v_r.formas < 3 then
      v_erros := v_erros || format('4M2WW6 aparece com %s forma(s), e vende de 3. ', v_r.formas);
    end if;
    if v_r.como_bump = 0 or v_r.como_upsell = 0 or v_r.como_principal = 0 then
      v_erros := v_erros || format('4M2WW6: principal=%s upsell=%s bump=%s — algum canal zerou. ',
        v_r.como_principal, v_r.como_upsell, v_r.como_bump);
    end if;
    if v_r.qtd_slots_de_bump < 2 then
      v_erros := v_erros || '4M2WW6 deveria aparecer em 2 slots de bump. ';
    end if;
  end if;

  -- 3. `bate_com_o_cadastro` e NULO para quem nunca vendeu. Dizer "nao bate"
  --    ali seria acusar o cadastro de um silencio que e do produto.
  select count(*) into v_n from public.vw_oferta_como_vende
   where formas = 0 and bate_com_o_cadastro is not null;
  if v_n > 0 then
    v_erros := v_erros || format('%s oferta(s) sem venda receberam veredito de divergencia. ', v_n);
  end if;

  -- 4. E a divergencia aparece onde existe: 4OMBNZ esta cadastrado como upsell
  --    e vende 7 diretas, zero upsells.
  select bate_com_o_cadastro into v_bate
    from public.vw_oferta_como_vende where code_payt = '4OMBNZ';
  if v_bate is not false then
    v_erros := v_erros || '4OMBNZ deveria aparecer como divergente (cadastrado upsell, vende direto). ';
  end if;

  -- 5. A view NAO escreve nada. Garantia estrutural: e view, nao funcao.
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='vw_oferta_como_vende' and c.relkind='v') then
    v_erros := v_erros || 'vw_oferta_como_vende nao e uma view. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.vw_oferta_como_vende where formas > 1;
  raise notice 'PROVA OK: % oferta(s) vendem de mais de uma forma, e agora da para ver de quais.', v_n;
end $prova$;

notify pgrst, 'reload schema';
