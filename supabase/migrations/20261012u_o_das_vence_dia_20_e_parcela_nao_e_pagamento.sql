-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O DAS vence dia 20, e parcela não é pagamento                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A tela Financeiro → Resultado mostra setembro/2026 com **R$ 575,54** de
-- Simples. O correto é ~R$ 14.934 (base R$ 215.315,73 × 6,9359%). São
-- **R$ 14.358 de lucro que não existe**, numa tela que diz "extrato" — ou
-- seja, afirmando como pago algo que não foi.
--
-- Ela confirmou as duas peças, sem eu perguntar:
--
--   "setembro - imposto ainda não foi pago, por isso, falta pagar
--    este valor foi apenas uma parcela"
--   "Imposto é sempre pago no mês seguinte dia 20"
--
-- O defeito está no TypeScript (`resultado.ts`, `if (pago > 0) return fato`),
-- e vai num commit junto. Esta migração resolve as DUAS regras de negócio que
-- ele precisa ter, do lado onde elas já moravam pela metade.
--
-- ── Regra 1: o vencimento é o dia 20, não a virada do mês ─────────────────
--
-- A view dizia `pagamento_fechado = (mês+1) < mês corrente`: o imposto de
-- setembro só contaria como fato em NOVEMBRO. Pela regra real, dia 21/10 já
-- se sabe. São dez dias por mês em que a alíquota medida fica velha à toa.
--
-- Hoje (12/10) as duas regras dão exatamente o mesmo resultado em todos os
-- meses, e a prova lá embaixo exige isso: a troca é um no-op verificável
-- agora, e só passa a divergir a partir de 21/10.
--
-- ── Regra 2: uma parcela não fecha o mês ──────────────────────────────────
--
-- Só a regra 1 criaria um defeito novo. Em 21/10, setembro passaria a contar
-- como "fechado" com os R$ 575,54 da parcela, e uma alíquota de **0,27%**
-- entraria na média móvel de três meses — contaminando dezembro e janeiro.
-- O defeito de hoje viraria um defeito pior, com dez dias de atraso.
--
-- O corte não é arbitrário: **4% é a alíquota do primeiro degrau do Anexo I,
-- o piso de todo o Simples Nacional.** Nenhum anexo começa abaixo disso.
-- Logo, implícita menor que 4% não é alíquota — é pagamento incompleto.
--
-- Fica em `configuracoes` e não escrito na view porque é parâmetro fiscal, e
-- parâmetro fiscal neste projeto mora em tabela e se lê por `fn_config`
-- (armadilha 3). Se a lei mudar o degrau, muda uma linha e não um deploy.
--
-- ── O que isso move ───────────────────────────────────────────────────────
--
-- `vw_faturamento_liquido` e `fn_aliquota_simples` leem esta view. A prova
-- exige que os valores de hoje fiquem IDÊNTICOS aos de antes — se mudarem,
-- a migração falha em vez de empurrar número novo para /resumo sem aviso.

begin;

insert into public.configuracoes (chave, valor, descricao)
values ('simples_aliquota_minima_pct', 4.0,
        'Piso legal do Simples Nacional (%) — 1º degrau do Anexo I. Pagamento '
        'cuja alíquota implícita fica abaixo disto é PARCELA, não o DAS do mês, '
        'e não entra na média que estima os meses em aberto.')
on conflict do nothing;

commit;

create or replace view public.vw_aliquota_simples_mes
with (security_invoker = on) as
  with pago as (
    select date_trunc('month', t.data::timestamp with time zone)::date as mes_pagamento,
           t.empresa_id,
           sum(abs(t.valor)) as pago
      from transacoes t
     where t.valor < 0::numeric and t.categoria = 'Impostos e Tributos'::text
     group by 1, 2
  ), cruzado as (
    select b.mes,
           b.empresa_id,
           sum(b.base) as base,
           sum(p.pago) as pago,
           grouping(b.empresa_id) = 1 as eh_grupo
      from vw_base_simples_mes b
      left join pago p on p.empresa_id = b.empresa_id
                      and p.mes_pagamento = (b.mes + interval '1 month')::date
     where b.base > 0::numeric
     group by grouping sets ((b.mes, b.empresa_id), (b.mes))
  ), medido as (
    select c.mes,
           case when c.eh_grupo then null::uuid else c.empresa_id end as empresa_id,
           c.eh_grupo,
           c.base,
           c.pago,
           -- Dia 20 do mes seguinte. `mes` e sempre dia 1, entao +19 dias.
           ((c.mes + interval '1 month')::date + 19) as vencimento,
           (now() at time zone 'America/Sao_Paulo')::date
             > ((c.mes + interval '1 month')::date + 19) as ja_venceu
      from cruzado c
  ), classificado as (
    select m.mes, m.empresa_id, m.eh_grupo, m.base, m.pago, m.vencimento, m.ja_venceu,
           -- Fechado = venceu E o que foi pago parece o DAS inteiro. Abaixo do
           -- piso legal do Anexo I nao e aliquota, e parcela.
           (m.ja_venceu
            and m.pago is not null
            and m.base > 0::numeric
            and (100.0 * m.pago / m.base)
                >= coalesce(public.fn_config('simples_aliquota_minima_pct', m.empresa_id), 4.0)
           ) as pagamento_fechado
      from medido m
  ), janela as (
    select c.mes, c.empresa_id, c.eh_grupo, c.base, c.pago, c.vencimento,
           c.pagamento_fechado,
           case
             when c.pagamento_fechado then
               sum(case when c.pagamento_fechado then coalesce(c.pago, 0::numeric) end)
                 over (partition by c.eh_grupo, c.empresa_id order by c.mes
                       rows between 2 preceding and current row)
               / nullif(sum(case when c.pagamento_fechado then c.base end)
                 over (partition by c.eh_grupo, c.empresa_id order by c.mes
                       rows between 2 preceding and current row), 0::numeric) * 100::numeric
             else null::numeric
           end as aliquota_3m
      from classificado c
  )
  select mes,
         empresa_id,
         round(base, 2) as base,
         round(pago, 2) as imposto_pago,
         pagamento_fechado,
         round(100::numeric * pago / nullif(base, 0::numeric), 2) as aliquota_do_mes,
         round(aliquota_3m, 4) as aliquota_3m,
         round(coalesce(aliquota_3m, (
           select j2.aliquota_3m from janela j2
            where j2.eh_grupo = j.eh_grupo
              and not j2.empresa_id is distinct from j.empresa_id
              and j2.aliquota_3m is not null
              and j2.mes <= j.mes
            order by j2.mes desc limit 1)), 4) as aliquota_vigente,
         eh_grupo,
         vencimento
    from janela j;

comment on view public.vw_aliquota_simples_mes is
  'A aliquota do Simples MEDIDA: imposto pago sobre a base que o gerou. '
  'O DAS vence dia 20 do mes seguinte (coluna `vencimento`), e so conta como '
  'fechado se o valor pago chegar ao piso legal do Anexo I — parcela nao '
  'fecha o mes, e uma aliquota implicita de 0,27% contaminaria a media.';

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  r       record;
begin
  -- 1. O invoker sobreviveu ao replace.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='vw_aliquota_simples_mes'
       and 'security_invoker=on' = any(c.reloptions)
  ) then
    v_erros := v_erros || 'a view perdeu o security_invoker. ';
  end if;

  -- 2. O VENCIMENTO e dia 20 do mes seguinte, em toda linha. E a regra que
  --    ela enunciou, e e o unico lugar do painel que a conhece.
  select count(*) into v_n from public.vw_aliquota_simples_mes
   where extract(day from vencimento) <> 20
      or date_trunc('month', vencimento::timestamp)::date <> (mes + '1 mon'::interval)::date;
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) com vencimento fora do dia 20 do mes seguinte. ', v_n);
  end if;

  -- 3. SETEMBRO CONTINUA EM ABERTO. E o caso concreto: a parcela de R$ 575,54
  --    nao pode fechar o mes, nem hoje nem no dia 21.
  select * into r from public.vw_aliquota_simples_mes
   where mes = date '2026-09-01' and empresa_id is null;
  if not found then
    v_erros := v_erros || 'nao achei setembro no agregado. ';
  else
    if r.pagamento_fechado then
      v_erros := v_erros || format('setembro aparece como fechado com %s pago sobre base %s. ',
                                   r.imposto_pago, r.base);
    end if;
    if r.vencimento <> date '2026-10-20' then
      v_erros := v_erros || format('vencimento de setembro deu %s, esperava 2026-10-20. ', r.vencimento);
    end if;
    -- A aliquota que vale para estimar setembro vem dos meses fechados.
    if r.aliquota_vigente is null or r.aliquota_vigente < 5 or r.aliquota_vigente > 9 then
      v_erros := v_erros || format('aliquota vigente de setembro deu %s; esperava ~6,94. ',
                                   r.aliquota_vigente);
    end if;
  end if;

  -- 4. A PARCELA NAO ENTRA NA MEDIA. Se entrasse, 0,27% puxaria a vigente
  --    para baixo e contaminaria dezembro e janeiro.
  select count(*) into v_n from public.vw_aliquota_simples_mes
   where pagamento_fechado and aliquota_do_mes < 4;
  if v_n > 0 then
    v_erros := v_erros || format('%s mes(es) fechados com aliquota abaixo do piso legal. ', v_n);
  end if;

  -- 5. JULHO E AGOSTO continuam fechados, com as aliquotas que ja tinham.
  --    Se a regra nova derrubasse um mes que estava certo, a media mudaria
  --    sem ninguem pedir.
  select count(*) into v_n from public.vw_aliquota_simples_mes
   where mes in (date '2026-07-01', date '2026-08-01') and empresa_id is null
     and pagamento_fechado;
  if v_n <> 2 then
    v_erros := v_erros || format('%s de 2 meses (jul, ago) fechados; esperava os dois. ', v_n);
  end if;

  -- 6. O NO-OP: hoje a regra do dia 20 e a regra do fim do mes concordam em
  --    TODA linha. Isto e o que torna a troca segura agora — e a prova falha
  --    de proposito se alguem rodar esta migracao depois do dia 20, quando as
  --    duas ja divergem e a mudanca deixa de ser verificavel assim.
  select count(*) into v_n
    from public.vw_aliquota_simples_mes v
   where v.pagamento_fechado
     <> ((v.mes + '1 mon'::interval)::date
          < date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
         and v.imposto_pago is not null
         and v.base > 0
         and (100.0 * v.imposto_pago / v.base) >= 4);
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) onde a regra nova discorda da antiga. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % linhas, % fechadas; setembro vence em % e segue em aberto com % pago de uma base de %.',
    (select count(*) from public.vw_aliquota_simples_mes),
    (select count(*) from public.vw_aliquota_simples_mes where pagamento_fechado),
    (select vencimento from public.vw_aliquota_simples_mes where mes=date '2026-09-01' and empresa_id is null),
    (select imposto_pago from public.vw_aliquota_simples_mes where mes=date '2026-09-01' and empresa_id is null),
    (select base from public.vw_aliquota_simples_mes where mes=date '2026-09-01' and empresa_id is null);
end $prova$;

notify pgrst, 'reload schema';
