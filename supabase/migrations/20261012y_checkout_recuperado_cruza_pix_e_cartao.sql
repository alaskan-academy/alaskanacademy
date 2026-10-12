-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Checkout recuperado cruza Pix e cartão, e conta PESSOAS                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Ela pediu em três mensagens seguidas, e cada uma apertou a definição:
--
--   "Faça automático cruzando o CPF de quem gera e não paga, excluindo os
--    pagantes ou mais de 1 geração de pix"
--   "adicione o mesmo para cartão recusado"
--   "cruze os pix e cartão, pois tem pessoas que abandona cartão e compra
--    pix e vice e versa"
--
-- ── O que o banco diz ────────────────────────────────────────────────────
--
-- Setembro, conferido contra o plano (que registra 511 Pix pendentes e 290
-- cartões recusados):
--
--     Pix expirado/pendente     503   R$ 56.341
--     Cartão cancelado          286   R$ 32.943
--     ────────────────────────────────────────
--     789 tentativas, de 620 pessoas — e **632 pares (CPF, produto)**
--
-- Cento e sessenta e nove pessoas tentaram mais de uma vez. Contar
-- tentativas em vez de gente inflaria o denominador em 27% — é o "ou mais de
-- 1 geração de pix" dela, e sem o CPF não haveria como juntar.
--
-- ── O número, e por que ele contradiz o plano ────────────────────────────
--
-- Dos 632 pares, **224 voltaram e pagaram o MESMO produto em até 30 dias**:
-- 35,4%. Por valor, R$ 25.207 de R$ 89.283 — 28,2%.
--
-- O plano registra "~9% do pendente". A diferença não é erro de ninguém: o
-- plano contou o que a automação do Voxuy reivindicou (R$ 4,8 mil), e isto
-- conta quem voltou por QUALQUER caminho — sozinha, pelo suporte, tentando
-- de novo. São perguntas diferentes, e a segunda é a que a meta faz.
--
-- Consequência: os alvos do plano (15% em dez/26, 20% em mar/27 e jul/27)
-- já estão superados nesta definição. A tela vai dizer "já estava batida",
-- que é a verdade — e a verdade útil, porque mostra que o esforço de
-- recuperação precisa de um alvo novo, não do antigo.
--
-- ── As três variantes que medi antes de escolher ─────────────────────────
--
--     qualquer produto, 30 dias     243   39,2%
--     MESMO produto, 30 dias        224   35,4%   ← escolhida
--     qualquer produto, 7 dias      227   36,6%
--
-- A escolhida é a estrita: "recuperado" tem de significar que a pessoa
-- voltou e comprou AQUILO. As três quase coincidem, o que é um bom sinal —
-- se a frouxa fosse muito maior, estaria contando compra sem relação.
--
-- E o meio de pagamento fica livre de propósito: **25 pessoas trocaram de
-- meio** entre a tentativa e a compra. Exigir o mesmo meio perderia
-- exatamente o caso que ela levantou.
--
-- ── O nome da chave muda, porque o antigo mentiria ───────────────────────
--
-- `pix_pendente_recuperado_pct` passa a medir cartão também. Nome que diz
-- menos do que mede é a primeira armadilha em forma de rótulo — alguém
-- leria "Pix" e tiraria conclusão sobre Pix. Vira
-- `checkout_recuperado_pct`, e o nó da árvore vira "Pix e cartão
-- recuperados".

begin;

-- ── A chave nova, e as metas migradas para ela ───────────────────────────
insert into public.metas_kpi (chave, nome, unidade, direcao, automatico, e_meta, ordem, objetivo, observacao)
select 'checkout_recuperado_pct',
       'Checkout recuperado (Pix + cartão)',
       k.unidade, k.direcao, true, k.e_meta, k.ordem, k.objetivo,
       'Pessoas que geraram cobranca e nao pagaram, e que voltaram e compraram '
       'O MESMO produto em ate 30 dias — por qualquer meio. Conta PESSOA e nao '
       'tentativa: em setembro foram 789 tentativas de 620 pessoas, e contar '
       'tentativa inflaria o denominador em 27%. O meio fica livre porque 25 '
       'pessoas trocaram de cartao para Pix ou o contrario. O plano registra '
       '~9%, mas aquilo era so o que a automacao do Voxuy reivindicava; medindo '
       'quem voltou por qualquer caminho sao 35,4%.'
  from public.metas_kpi k
 where k.chave = 'pix_pendente_recuperado_pct'
on conflict (chave) do nothing;

update public.metas set kpi = 'checkout_recuperado_pct'
 where kpi = 'pix_pendente_recuperado_pct';

delete from public.metas_kpi where chave = 'pix_pendente_recuperado_pct';

update public.plano_objetivos
   set titulo = 'Pix e cartão recuperados',
       descricao = 'Em setembro, 503 Pix expiraram (R$ 56,3 mil) e 286 cartões foram '
                   'recusados (R$ 32,9 mil) — 789 tentativas de 620 pessoas. Delas, '
                   '224 voltaram e compraram o mesmo produto em até 30 dias.'
 where chave = 'roas_pix_recuperado';

-- ── A alavanca 3 perde as duas frentes, e as duas por decisão dela ───────
--
--   "Retirada de sócios atrelada à margem — não temos pretensão de reduzir
--    os 12 mil, pois realmente é custo de vida, então podemos remover isto"
--
--   "Jurídico tratado como projeto com teto — não faz sentido isso, faz? Já
--    que não temos a opção de pagar menos impostos ou não pagar?"
--
-- A segunda cai pela mesma razão que derrubou a linha do custo fixo: os
-- R$ 14,3 mil de "jurídico" eram o Simples com o rótulo errado. Não existe
-- jurídico para colocar teto, e imposto não é escolha.
--
-- A alavanca em si fica, mas com a premissa corrigida: o plano acreditava
-- num custo fixo de ~R$ 39 mil e o extrato tem ~R$ 26 mil.

update public.plano_acoes a set objetivo_id = (
    select o.id from public.plano_objetivos o where o.chave = 'alavanca_custo_fixo')
 where a.objetivo_id in (
   select id from public.plano_objetivos where chave in ('fixo_retirada_socios','fixo_juridico_com_teto'));

delete from public.plano_objetivos
 where chave in ('fixo_retirada_socios', 'fixo_juridico_com_teto');

update public.plano_objetivos
   set descricao = 'O plano contava ~R$ 39 mil de custo fixo em setembro, mas R$ 14,3 mil '
                   'daquilo era o Simples com o rótulo de "jurídico" — o extrato tem '
                   'R$ 954 no centro Jurídico. O custo fixo real de setembro foi ~R$ 26 mil: '
                   'editor R$ 8,9 mil, sócios R$ 12,0 mil, softwares R$ 4,4 mil, contábil '
                   'R$ 1,0 mil. As duas frentes que o plano listava saíram por decisão dela '
                   'em 12/10: a retirada de sócios não se pretende reduzir (é custo de vida) '
                   'e não há jurídico recorrente para pôr teto. O que resta de controle é a '
                   'regra de dezembro, que já é automática.'
 where chave = 'alavanca_custo_fixo';

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- A medição
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_checkout_recuperado(p_empresa uuid default null,
                                                         p_mes date default null)
 returns table (
   -- A unidade e o PAR (CPF, produto), nao a pessoa. Palavras dela:
   -- "considere CPF e produto, pois a pessoa deixar o pix nao pago em outro
   -- produto e outro funil de recuperacao". Em setembro sao 632 pares de
   -- 620 pessoas — doze abandonaram dois produtos diferentes.
   casos            bigint,
   tentativas       bigint,
   recuperadas      bigint,
   pct_casos        numeric,
   valor_perdido    numeric,
   valor_recuperado numeric,
   pct_valor        numeric
 )
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with ref as (
    -- Mes fechado por padrao: uma tentativa de ontem nao teve chance de ser
    -- recuperada, e inclui-la empurraria o indicador para baixo todo dia 1.
    select coalesce(p_mes,
             date_trunc('month', date_trunc('month', current_date)::date - 1)::date) as mes
  ),
  base as (
    select v.data_venda, v.status::text as status, v.meio_pagamento::text as meio,
           v.produto::text as produto,
           coalesce(v.valor_sem_juros, v.valor_total) as valor,
           coalesce(nullif(btrim(c.cpf), ''), 'id:' || c.id::text) as pessoa
      from vendas v
      join clientes c on c.id = v.cliente_id
     where v.pedido_id not like 'TEST%' and v.pedido_id not like 'LC-%'
       and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  -- Uma linha por (pessoa, produto): a pessoa que gerou tres Pix do mesmo
  -- curso e UM caso, nao tres.
  falhou as (
    select b.pessoa, b.produto,
           min(b.data_venda) as quando,
           count(*)          as tentativas,
           sum(b.valor)      as perdido
      from base b, ref r
     where b.data_venda >= r.mes
       and b.data_venda <  (r.mes + interval '1 month')
       and ((b.meio = 'pix' and b.status in ('expirada','pendente'))
         or (b.meio = 'cartao_credito' and b.status = 'cancelada'))
     group by 1, 2
  ),
  recuperou as (
    select f.pessoa, f.produto, f.perdido,
           -- O meio NAO entra na comparacao: 25 pessoas trocaram de cartao
           -- para Pix ou o contrario, e exigir o mesmo meio perderia o caso.
           (select sum(b.valor) from base b
             where b.pessoa = f.pessoa and b.produto = f.produto
               and b.status = 'aprovada'
               and b.data_venda >  f.quando
               and b.data_venda <= f.quando + interval '30 days') as recuperado
      from falhou f
  )
  select
    -- `count(*)` e nao `count(distinct pessoa)`: `falhou` ja esta agrupada
    -- por (pessoa, produto), entao cada linha e um funil de recuperacao.
    (select count(*) from falhou)::bigint,
    (select coalesce(sum(tentativas),0) from falhou)::bigint,
    (select count(*) from recuperou where recuperado is not null)::bigint,
    round(100.0 * (select count(*) from recuperou where recuperado is not null)
                / nullif((select count(*) from falhou), 0), 2),
    round((select coalesce(sum(perdido),0) from falhou), 2),
    round((select coalesce(sum(recuperado),0) from recuperou), 2),
    round(100.0 * (select coalesce(sum(recuperado),0) from recuperou)
                / nullif((select sum(perdido) from falhou), 0), 2);
$function$;

comment on function public.fn_checkout_recuperado(uuid, date) is
  'Quem gerou cobranca e nao pagou, e voltou. Conta PESSOA (por CPF) e nao '
  'tentativa, cruza Pix com cartao nos dois sentidos, e exige o MESMO '
  'produto em ate 30 dias. Definicao dela, 12/10/2026.';

revoke all on function public.fn_checkout_recuperado(uuid, date) from public, anon;
grant execute on function public.fn_checkout_recuperado(uuid, date) to authenticated, service_role;

-- `fn_metas_medir` troca a chave manual pela medida.
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
  select 'checkout_recuperado_pct'::text,
         (select r.pct_casos
            from fechado f, lateral public.fn_checkout_recuperado(p_empresa, f.mes) r);
$function$;

revoke all on function public.fn_metas_medir(uuid, date) from public, anon;
grant execute on function public.fn_metas_medir(uuid, date) to authenticated, service_role;

begin;
update public.metas m set valor_base_medido = (
    select r.pct_casos from public.fn_checkout_recuperado(null, date '2026-09-01') r)
 where m.kpi = 'checkout_recuperado_pct';
commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := ''; v_n bigint; r record; v_val numeric;
begin
  -- 1. Setembro reproduz o que eu medi a mao, e o que o plano registra.
  select * into r from public.fn_checkout_recuperado(null, date '2026-09-01');
  if r.casos <> 632 then
    v_erros := v_erros || format('%s casos, esperava 632 pares (CPF, produto). ', r.casos);
  end if;
  if r.tentativas <> 789 then
    v_erros := v_erros || format('%s tentativas, esperava 789. ', r.tentativas);
  end if;
  if r.recuperadas <> 224 then
    v_erros := v_erros || format('%s recuperadas, esperava 224 (mesmo produto, 30 dias). ', r.recuperadas);
  end if;

  -- 2. A deduplicacao por pessoa ESTA acontecendo. Se tentativas e pessoas
  --    ficarem iguais, alguem trocou o group by e o denominador inflou 27%.
  if r.tentativas <= r.casos then
    v_erros := v_erros || 'tentativas nao supera pessoas: a deduplicacao por CPF sumiu. ';
  end if;

  -- 3. O indicador sai medido pelo fn_metas_medir, e nao e mais manual.
  select valor into v_val from public.fn_metas_medir(null) where kpi = 'checkout_recuperado_pct';
  if v_val is null then v_erros := v_erros || 'checkout_recuperado_pct voltou nulo. '; end if;
  if v_val is not null and abs(v_val - 35.44) > 1 then
    v_erros := v_erros || format('checkout recuperado deu %s, esperava ~35,44. ', v_val);
  end if;
  if exists (select 1 from public.metas_kpi where chave = 'checkout_recuperado_pct' and not automatico) then
    v_erros := v_erros || 'checkout_recuperado_pct continua manual. ';
  end if;

  -- 4. A chave velha sumiu e ninguem ficou apontando para ela.
  if exists (select 1 from public.metas_kpi where chave = 'pix_pendente_recuperado_pct') then
    v_erros := v_erros || 'a chave pix_pendente_recuperado_pct continua existindo. ';
  end if;
  select count(*) into v_n from public.metas where kpi = 'checkout_recuperado_pct';
  if v_n <> 3 then
    v_erros := v_erros || format('%s alvos migrados para a chave nova, esperava 3. ', v_n);
  end if;

  -- 5. Sobram DUAS manuais: as duas da Area de Membros.
  select count(*) into v_n from public.metas_kpi where e_meta and not automatico;
  if v_n <> 2 then
    v_erros := v_erros || format('%s metas manuais, esperava 2 (alunas, bumps). ', v_n);
  end if;

  -- 6. A alavanca 3 perdeu as duas frentes, e nenhuma acao ficou orfa.
  select count(*) into v_n from public.plano_objetivos
   where chave in ('fixo_retirada_socios','fixo_juridico_com_teto');
  if v_n > 0 then
    v_erros := v_erros || format('%s frente(s) da alavanca 3 continuam la. ', v_n);
  end if;
  select count(*) into v_n from public.plano_objetivos o
   join public.plano_objetivos p on p.id = o.parte_de
   where p.chave = 'alavanca_custo_fixo';
  if v_n <> 0 then
    v_erros := v_erros || format('a alavanca 3 ainda tem %s filho(s). ', v_n);
  end if;
  -- "Arrumar o financeiro" apontava para o juridico; tem de ter subido para
  -- a alavanca em vez de virar orfa.
  if not exists (
    select 1 from public.plano_acoes a
      join public.plano_objetivos o on o.id = a.objetivo_id
     where a.titulo = 'Arrumar o financeiro' and o.chave = 'alavanca_custo_fixo') then
    v_erros := v_erros || '"Arrumar o financeiro" nao subiu para a alavanca. ';
  end if;

  -- 7. Nao ficou aberta.
  if has_function_privilege('anon', 'public.fn_checkout_recuperado(uuid,date)', 'execute') then
    v_erros := v_erros || 'anon consegue executar fn_checkout_recuperado. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % casos em % tentativas, % recuperadas, % por cento; % metas ainda manuais.',
    r.casos, r.tentativas, r.recuperadas, r.pct_casos,
    (select count(*) from public.metas_kpi where e_meta and not automatico);
end $prova$;

notify pgrst, 'reload schema';
