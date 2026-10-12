-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A meta de recuperação passa a ser sobre o VALOR                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- "Refaça esta meta então, analise o voxuy se necessário, e junto as ações
-- com elas." A meta antiga (15% em dez/26, 20% em mar e jul) nasceu morta:
-- medida direito, a recuperação já estava em 35,4%.
--
-- ── A série, que diz o que o alvo tem de ser ─────────────────────────────
--
--     mês      casos  % casos   R$ perdido  R$ recuperado  % valor
--     mai/26     166    26,5%       17.392         2.952    17,0%
--     jun/26     194    38,1%       18.875         5.728    30,4%
--     jul/26     395    41,0%       49.695        15.927    32,1%
--     ago/26     577    32,4%       75.369        17.827    23,7%
--     set/26     632    35,4%       89.283        20.102    22,5%
--
-- Duas leituras saem daí, e elas discordam:
--
--   · a taxa POR PESSOA está parada em ~35% há quatro meses, subindo e
--     descendo sem relação com esforço nenhum
--   · o dinheiro perdido QUADRUPLICOU (R$ 18,9 mil → R$ 89,3 mil) e a
--     recuperação por VALOR está caindo (32,1% → 22,5%)
--
-- Em setembro, R$ 69 mil não voltaram.
--
-- Um alvo sobre a taxa por pessoa mediria ruído. O alvo passa a ser sobre o
-- valor, que é o que cai, o que paga, e o que as ações movem.
--
-- ── O que a diferença entre as duas taxas revela ─────────────────────────
--
-- 35,4% dos CASOS voltam, mas só 22,5% do VALOR. O carrinho perdido médio é
-- R$ 141 e o recuperado médio é R$ 90: **os caros são os que não voltam.**
--
-- E o plano já tem a ação para isso, escrita antes de alguém medir:
-- "para carrinho com bump abandonado, oferecer só o curso por R$ 67 em vez
-- de 20% sobre o pacote". Ela está entre as 14 ligadas a esta meta.
--
-- ── O Voxuy, sem precisar abrir o Voxuy ──────────────────────────────────
--
-- `vendas.cart_recovered` passou a ser preenchida em 11/08/2026 — o plano
-- diz que ela "nunca é preenchida", e isso envelheceu. Com ela dá para
-- separar quem a automação trouxe de quem voltou sozinha. Setembro:
--
--     pela automação      26 casos   R$  2.432
--     voltaram sozinhas  198 casos   R$ 17.669
--
-- **A automação responde por 12% da recuperação.** Os outros 88% são
-- pessoas que voltaram por conta própria — e isso bate com o plano, que
-- registra R$ 3,2 mil na automação contra R$ 3,8 mil no atendimento humano.
--
-- Por isso nasce o indicador de apoio: dos R$ 89,3 mil perdidos, a
-- automação recuperou 2,72%. É esse número que as 14 ações movem, e
-- separá-lo do total impede que o crescimento orgânico seja lido como
-- resultado do trabalho.
--
-- ── Os alvos novos, e de onde saem ───────────────────────────────────────
--
--     dez/26   28%   voltar ao melhor que a casa já fez (julho, 32,1%),
--                    com quatro pontos de folga
--     mar/27   32%   bater julho
--     jul/27   35%   um terço do perdido voltando
--
-- Não são chute: julho provou que 32% é alcançável com a operação de hoje,
-- antes de qualquer uma das 14 ações. Os alvos antigos (15/20/20) ficam
-- registrados em `metas.observacao`, porque apagar o que o plano pedia
-- tiraria a única referência de quanto a definição mudou.

begin;

-- ── A função passa a separar o que a automação trouxe ────────────────────
-- Ganha tres colunas, e `create or replace` nao muda tipo de retorno. O
-- drop apaga os grants junto, por isso eles sao reemitidos logo abaixo.
drop function if exists public.fn_checkout_recuperado(uuid, date);

create function public.fn_checkout_recuperado(p_empresa uuid default null,
                                              p_mes date default null)
 returns table (
   casos                     bigint,
   tentativas                bigint,
   recuperadas               bigint,
   pct_casos                 numeric,
   valor_perdido             numeric,
   valor_recuperado          numeric,
   pct_valor                 numeric,
   recuperadas_automacao     bigint,
   valor_automacao           numeric,
   pct_valor_automacao       numeric
 )
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with ref as (
    select coalesce(p_mes,
             date_trunc('month', date_trunc('month', current_date)::date - 1)::date) as mes
  ),
  base as (
    select v.data_venda, v.status::text as status, v.meio_pagamento::text as meio,
           v.produto::text as produto,
           coalesce(v.cart_recovered, false) as pela_automacao,
           coalesce(v.valor_sem_juros, v.valor_total) as valor,
           coalesce(nullif(btrim(c.cpf), ''), 'id:' || c.id::text) as pessoa
      from vendas v
      join clientes c on c.id = v.cliente_id
     where v.pedido_id not like 'TEST%' and v.pedido_id not like 'LC-%'
       and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  -- Um caso e o par (CPF, produto): produto diferente e outro funil.
  falhou as (
    select b.pessoa, b.produto, min(b.data_venda) as quando,
           count(*) as tentativas, sum(b.valor) as perdido
      from base b, ref r
     where b.data_venda >= r.mes
       and b.data_venda <  (r.mes + interval '1 month')
       and ((b.meio = 'pix' and b.status in ('expirada','pendente'))
         or (b.meio = 'cartao_credito' and b.status = 'cancelada'))
     group by 1, 2
  ),
  recuperou as (
    select f.pessoa, f.produto, f.perdido,
           -- O meio fica livre: 25 pessoas trocaram de cartao para Pix ou o
           -- contrario, e exigir o mesmo meio perderia o caso.
           (select sum(b.valor) from base b
             where b.pessoa = f.pessoa and b.produto = f.produto
               and b.status = 'aprovada'
               and b.data_venda >  f.quando
               and b.data_venda <= f.quando + interval '30 days') as recuperado,
           -- `cart_recovered` so passou a ser gravada em 11/08/2026. Antes
           -- disso este numero e zero por falta de dado, nao por falta de
           -- recuperacao — e a serie comeca ali.
           (select sum(b.valor) from base b
             where b.pessoa = f.pessoa and b.produto = f.produto
               and b.status = 'aprovada' and b.pela_automacao
               and b.data_venda >  f.quando
               and b.data_venda <= f.quando + interval '30 days') as recuperado_automacao
      from falhou f
  )
  select
    (select count(*) from falhou)::bigint,
    (select coalesce(sum(tentativas),0) from falhou)::bigint,
    (select count(*) from recuperou where recuperado is not null)::bigint,
    round(100.0 * (select count(*) from recuperou where recuperado is not null)
                / nullif((select count(*) from falhou), 0), 2),
    round((select coalesce(sum(perdido),0) from falhou), 2),
    round((select coalesce(sum(recuperado),0) from recuperou), 2),
    round(100.0 * (select coalesce(sum(recuperado),0) from recuperou)
                / nullif((select sum(perdido) from falhou), 0), 2),
    (select count(*) from recuperou where recuperado_automacao is not null)::bigint,
    round((select coalesce(sum(recuperado_automacao),0) from recuperou), 2),
    -- Mesmo denominador do total: assim a fatia da automacao e lida como
    -- "2,72 dos 22,51 pontos", e nao como um percentual de outra coisa.
    round(100.0 * (select coalesce(sum(recuperado_automacao),0) from recuperou)
                / nullif((select sum(perdido) from falhou), 0), 2);
$function$;

comment on function public.fn_checkout_recuperado(uuid, date) is
  'Quem gerou cobranca e nao pagou, e voltou. A unidade e o PAR (CPF, '
  'produto). Devolve a taxa por caso e por VALOR, e separa o que a '
  'automacao trouxe (cart_recovered) do que voltou sozinho — em setembro, '
  '12% contra 88%.';

revoke all on function public.fn_checkout_recuperado(uuid, date) from public, anon;
grant execute on function public.fn_checkout_recuperado(uuid, date) to authenticated, service_role;

commit;

begin;

-- ── A meta vira o VALOR, e ganha dois apoios ─────────────────────────────
update public.metas_kpi
   set nome = 'Checkout recuperado (valor)',
       observacao = 'Fatia do VALOR perdido em checkout que voltou: par (CPF, produto) que '
                    'gerou cobranca e nao pagou, e que comprou O MESMO produto em ate 30 '
                    'dias, por qualquer meio. Mede VALOR e nao casos porque a taxa por '
                    'pessoa esta parada em ~35% ha quatro meses, sem relacao com esforco, '
                    'enquanto o valor recuperado caiu de 32,1% para 22,5% e o dinheiro '
                    'perdido quadruplicou. Alvos refeitos em 12/10/2026.'
 where chave = 'checkout_recuperado_pct';

insert into public.metas_kpi (chave, nome, unidade, direcao, automatico, e_meta, ordem, objetivo, observacao) values
  ('checkout_recuperado_casos_pct', 'Checkout recuperado (casos)', 'percentual', 'piso',
   true, false, 71, 'roas_pix_recuperado',
   'A mesma conta, contando CASOS em vez de reais. Existe ao lado do valor '
   'porque a distancia entre os dois e a informacao: 35,4% dos casos voltam '
   'mas so 22,5% do valor. O carrinho perdido medio e R$ 141 e o recuperado '
   'medio e R$ 90 — os caros sao os que nao voltam.'),

  ('checkout_recuperado_automacao_pct', 'Recuperado pela automação', 'percentual', 'piso',
   true, false, 72, 'roas_pix_recuperado',
   'A fatia do valor perdido que a automacao trouxe, por `cart_recovered`. '
   'MESMO denominador do indicador principal, entao le-se "2,72 dos 22,51 '
   'pontos". Em setembro: 26 casos e R$ 2.432 pela automacao contra 198 e '
   'R$ 17.669 que voltaram sozinhas — 12% contra 88%. E este numero que as '
   '14 acoes movem; sem separa-lo, crescimento organico seria lido como '
   'resultado do trabalho. A coluna cart_recovered so e gravada desde '
   '11/08/2026: antes disso o zero e falta de dado.')
on conflict (chave) do nothing;

-- ── Os alvos novos, com o que o plano pedia preservado ao lado ───────────
update public.metas m
   set valor_alvo = v.alvo,
       observacao = 'Alvo refeito em 12/10/2026. O plano pedia ' || v.antigo ||
                    '%, sobre uma definicao que media so o que a automacao do Voxuy '
                    'reivindicava (~9%); medindo todo o valor recuperado a base ja era '
                    '22,5%. O novo sai do melhor mes que a casa ja fez: julho/26, 32,1%.'
  from (values
    (date '2026-12-31', 28::numeric, '15'),
    (date '2027-03-31', 32::numeric, '20'),
    (date '2027-07-31', 35::numeric, '20')
  ) as v(prazo, alvo, antigo)
 where m.kpi = 'checkout_recuperado_pct' and m.prazo = v.prazo;

update public.metas m set valor_base_medido = (
    select r.pct_valor from public.fn_checkout_recuperado(null, date '2026-09-01') r)
 where m.kpi = 'checkout_recuperado_pct';

commit;

-- ── A medicao lê o valor, e publica os dois apoios ───────────────────────
create or replace function public.fn_metas_medir(p_empresa uuid default null, p_ref date default current_date)
 returns table (kpi text, valor numeric)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with vendas_ok as (
    select v.cliente_id, v.data_venda,
           coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0) as valor,
           coalesce(v.ad_id_meta is not null or coalesce(v.trafego_pago, false), false) as eh_trafego,
           nullif(btrim(coalesce(v.utm_source, '')), '') is not null as tem_utm
      from vendas v
     where v.status = 'aprovada'
       and v.pedido_id not like 'TEST%' and v.pedido_id not like 'LC-%'
       and v.data_venda < (p_ref + 1)
       and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  pessoa_total as (
    select coalesce(nullif(btrim(c.cpf), ''), 'id:' || c.id::text) p,
           sum(w.valor) total, count(*) compras
      from vendas_ok w join clientes c on c.id = w.cliente_id
     group by 1
  ),
  pessoa_90 as (
    select coalesce(nullif(btrim(c.cpf), ''), 'id:' || c.id::text) p, count(*) n
      from vendas_ok w join clientes c on c.id = w.cliente_id
     where w.data_venda >= (p_ref - 90)
     group by 1
  ),
  fechado as (
    select (date_trunc('month', p_ref)::date - 1) as dia,
           date_trunc('month', date_trunc('month', p_ref)::date - 1)::date as mes
  ),
  -- Uma chamada so para os tres indicadores de recuperacao: a funcao varre
  -- vendas duas vezes, e chama-la tres vezes triplicaria isso.
  recup as (
    select r.* from fechado f, lateral public.fn_checkout_recuperado(p_empresa, f.mes) r
  )
  select 'assinaturas_ativas'::text,
         (select count(*) from assinaturas where status = 'ativa')::numeric
  union all
  select 'base_whatsapp_pct'::text,
         (select round(100.0 * count(nullif(trim(telefone), '')) / nullif(count(*), 0), 2) from clientes)
  union all
  select 'ltv_medio'::text,           (select round(avg(total), 2) from pessoa_total)
  union all
  select 'compras_por_pessoa'::text,  (select round(avg(compras), 3) from pessoa_total)
  union all
  select 'clientes_unicos_90d'::text, (select count(*)::numeric from pessoa_90)
  union all
  select 'recompra_90d_pct'::text,
         (select round(100.0 * count(*) filter (where n > 1) / nullif(count(*), 0), 2) from pessoa_90)
  union all
  select 'receita_fora_trafego_pct'::text,
         (select round(100.0 * sum(valor) filter (where not eh_trafego and tem_utm)
                       / nullif(sum(valor), 0), 2)
            from vendas_ok where data_venda >= (p_ref - 30))
  union all
  select 'receita_sem_utm_pct'::text,
         (select round(100.0 * sum(valor) filter (where not eh_trafego and not tem_utm)
                       / nullif(sum(valor), 0), 2)
            from vendas_ok where data_venda >= (p_ref - 30))
  union all
  select 'lucro_liquido_mes'::text,
         (select round(x.sobrou_depois_das_retiradas, 2)
            from public.fn_resultado_mes(p_empresa) x, fechado f
           where x.mes = f.mes)
  union all
  select 'roas_medio'::text,
         (select round(sum(v.faturamento_bruto) / nullif(sum(v.investimento_meta), 0), 2)
            from public.vw_faturamento_liquido v, fechado f
           where date_trunc('month', v.data)::date = f.mes
             and (p_empresa is null or v.empresa_id = p_empresa))
  union all
  select 'checkout_recuperado_pct'::text,           (select pct_valor from recup)
  union all
  select 'checkout_recuperado_casos_pct'::text,     (select pct_casos from recup)
  union all
  select 'checkout_recuperado_automacao_pct'::text, (select pct_valor_automacao from recup);
$function$;

revoke all on function public.fn_metas_medir(uuid, date) from public, anon;
grant execute on function public.fn_metas_medir(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := ''; v_n bigint; r record;
  v_valor numeric; v_casos numeric; v_auto numeric;
begin
  select * into r from public.fn_checkout_recuperado(null, date '2026-09-01');

  -- 1. A conta antiga nao se mexeu: casos e tentativas continuam os mesmos.
  if r.casos <> 632 or r.tentativas <> 789 or r.recuperadas <> 224 then
    v_erros := v_erros || format('setembro mudou: %s casos, %s tentativas, %s recuperadas. ',
                                 r.casos, r.tentativas, r.recuperadas);
  end if;

  -- 2. A fatia da automacao bate com o que eu medi a mao: 26 casos, R$ 2.432.
  if r.recuperadas_automacao <> 26 then
    v_erros := v_erros || format('%s casos pela automacao, esperava 26. ', r.recuperadas_automacao);
  end if;
  if abs(r.valor_automacao - 2432) > 50 then
    v_erros := v_erros || format('automacao recuperou %s, esperava ~2.432. ', r.valor_automacao);
  end if;

  -- 3. A automacao e PARTE do total, nunca maior. Se inverter, o
  --    denominador foi trocado em um dos dois.
  if r.pct_valor_automacao > r.pct_valor then
    v_erros := v_erros || format('a automacao (%s%%) ficou maior que o total (%s%%). ',
                                 r.pct_valor_automacao, r.pct_valor);
  end if;
  if r.recuperadas_automacao > r.recuperadas then
    v_erros := v_erros || 'mais casos pela automacao do que recuperados no total. ';
  end if;

  -- 4. O indicador principal passou a ser o VALOR. Se continuar devolvendo
  --    os 35,44% dos casos, a troca nao aconteceu.
  select valor into v_valor from public.fn_metas_medir(null) where kpi='checkout_recuperado_pct';
  select valor into v_casos from public.fn_metas_medir(null) where kpi='checkout_recuperado_casos_pct';
  select valor into v_auto  from public.fn_metas_medir(null) where kpi='checkout_recuperado_automacao_pct';

  if v_valor is null or abs(v_valor - 22.51) > 1 then
    v_erros := v_erros || format('a meta deu %s; esperava ~22,51 (valor), nao 35,44 (casos). ', v_valor);
  end if;
  if v_casos is null or abs(v_casos - 35.44) > 1 then
    v_erros := v_erros || format('o apoio de casos deu %s, esperava ~35,44. ', v_casos);
  end if;
  if v_auto is null or abs(v_auto - 2.72) > 0.5 then
    v_erros := v_erros || format('o apoio da automacao deu %s, esperava ~2,72. ', v_auto);
  end if;

  -- 5. Os alvos novos entraram, e o que o plano pedia ficou registrado.
  select count(*) into v_n from public.metas
   where kpi = 'checkout_recuperado_pct' and valor_alvo in (28, 32, 35);
  if v_n <> 3 then
    v_erros := v_erros || format('%s alvos novos, esperava 3 (28, 32, 35). ', v_n);
  end if;
  select count(*) into v_n from public.metas
   where kpi = 'checkout_recuperado_pct' and observacao like '%O plano pedia%';
  if v_n <> 3 then
    v_erros := v_erros || format('%s alvos guardam o que o plano pedia, esperava 3. ', v_n);
  end if;

  -- 6. A meta deixou de estar batida. Era o motivo de refaze-la: 22,51
  --    contra 28 em dez/26 e um alvo que ainda significa alguma coisa.
  if exists (select 1 from public.fn_metas_progresso(null)
              where kpi = 'checkout_recuperado_pct' and situacao in ('batida','ja_estava_batida')) then
    v_erros := v_erros || 'a meta continua batida de saida; o alvo novo nao mordeu. ';
  end if;

  -- 7. Os dois apoios sao APOIO, nao meta: as dez metas continuam dez.
  select count(*) into v_n from public.metas_kpi where e_meta;
  if v_n <> 10 then
    v_erros := v_erros || format('%s indicadores marcados como meta, esperava 10. ', v_n);
  end if;

  -- 8. As 14 acoes continuam penduradas na meta.
  select count(*) into v_n from public.plano_acoes a
   join public.plano_objetivos o on o.id = a.objetivo_id
   where o.chave = 'roas_pix_recuperado';
  if v_n <> 14 then
    v_erros := v_erros || format('%s acoes ligadas a recuperacao, esperava 14. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: valor %, casos %, automacao % (de % perdidos, % voltaram).',
    v_valor, v_casos, v_auto, r.valor_perdido, r.valor_recuperado;
end $prova$;

notify pgrst, 'reload schema';
