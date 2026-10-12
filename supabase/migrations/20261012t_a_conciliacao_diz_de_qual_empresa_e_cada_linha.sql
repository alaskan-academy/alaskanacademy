-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A conciliação diz de qual empresa é cada linha                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Achado por acaso, varrendo o console atrás de outra coisa: o React avisava
-- "Encountered two children with the same key, 2026-09-01" na tela de Meta
-- Ads, e o aviso termina com "children may be duplicated and/or omitted".
--
-- A causa: `vw_conciliacao_meta` devolve uma linha por mês POR EMPRESA, e
-- `ConciliacaoMeta.tsx` usava `key={l.mes}`. Com o seletor em "Ambas",
-- setembro aparece duas vezes com o mesmo rótulo:
--
--     set/26   Meta R$ 124.956,66   banco R$ 138.684,79   +11,0%
--     set/26   Meta R$   9.498,57   banco R$   9.683,54   + 1,9%
--
-- Duas linhas iguais no rótulo, com números que diferem em uma ordem de
-- grandeza, e nada na tela dizendo que a primeira é a Alaskan Academy e a
-- segunda a Aeliss. É exatamente o que o CLAUDE.md proíbe: "em 'Ambas' os
-- números aparecem lado a lado ou somados COM O RÓTULO DIZENDO ISSO".
--
-- E não é cosmético. Outubro da Aeliss está em −26,7% de resíduo contra
-- −0,6% da Alaskan: o cartão pagou R$ 2,1 mil a MENOS do que a Meta reporta
-- ter gasto. Isso é uma pergunta de verdade — fatura atrasada, estorno,
-- cartão de outra empresa pagando — e hoje ela está escondida atrás de uma
-- linha que parece repetida.
--
-- ── Por que a empresa entra na view e não numa busca à parte ──────────────
--
-- A tela poderia buscar `empresas` e casar por id. Seria a quinta vez que
-- esse mesmo `select id, nome from empresas` é escrito no projeto, e a
-- primeira numa tela que já tem a chave na mão. O nome viaja com a linha.
--
-- `with (security_invoker = on)` escrito na própria instrução, como manda o
-- CLAUDE.md: `create or replace view` REDEFINE as reloptions, e omitir a
-- opção apagaria a que estava lá — foi o que derrubou `vw_alertas` e
-- `vw_rev_tendencia` em 04/10.

create or replace view public.vw_conciliacao_meta
with (security_invoker = on) as
  with meta as (
    select date_trunc('month', m_1.data::timestamp with time zone)::date as mes,
           m_1.empresa_id,
           sum(m_1.investimento)::numeric(14,2) as ads_meta
      from metricas_meta m_1
     -- `nivel = 'campanha'` nao e detalhe: metricas_meta guarda a mesma
     -- verba em mais de um nivel, e somar tudo triplica o investimento.
     where m_1.nivel::text = 'campanha'::text
     group by 1, 2
  ), banco as (
    select date_trunc('month', t.data::timestamp with time zone)::date as mes,
           t.empresa_id,
           sum(- t.valor) filter (where coalesce(c.finalidade, 'ads') <> 'whatsapp')::numeric(14,2) as ads_banco,
           sum(- t.valor) filter (where c.finalidade = 'whatsapp')::numeric(14,2) as whatsapp,
           sum(- t.valor)::numeric(14,2) as saiu_banco,
           count(*)::integer as lancamentos
      from transacoes t
      left join cartoes c on c.masked_number = ((t.payload_raw -> 'card') ->> 'maskedNumber')
     where t.valor < 0::numeric and t.descricao ilike 'FACEBK%'
     group by 1, 2
  )
  select coalesce(m.mes, b.mes) as mes,
         m.ads_meta,
         coalesce(b.ads_banco, 0::numeric) as ads_banco,
         coalesce(b.whatsapp, 0::numeric) as whatsapp,
         b.saiu_banco,
         b.lancamentos,
         (coalesce(b.ads_banco, 0::numeric) - m.ads_meta)::numeric(14,2) as residuo,
         case
           when m.ads_meta > 0::numeric
             then round(100.0 * (coalesce(b.ads_banco, 0::numeric) - m.ads_meta) / m.ads_meta, 1)
           else null::numeric
         end as pct_residuo,
         date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
           = coalesce(m.mes, b.mes) as mes_em_curso,
         coalesce(m.empresa_id, b.empresa_id) as empresa_id,
         -- O nome e o slug viajam com a linha para a tela nao precisar de uma
         -- segunda busca so para dizer de quem e o numero. O slug escolhe o
         -- token de cor em index.css (`--empresa-<slug>`); hex nunca vem daqui.
         e.nome as empresa_nome,
         e.slug as empresa_slug
    from meta m
    full join banco b on b.mes = m.mes and not b.empresa_id is distinct from m.empresa_id
    left join empresas e on e.id = coalesce(m.empresa_id, b.empresa_id)
   where m.ads_meta is not null or b.saiu_banco is not null;

comment on view public.vw_conciliacao_meta is
  'O que a Meta diz ter gasto em campanha contra o que saiu dos cartoes de '
  'ads, por mes e POR EMPRESA. O nome da empresa vem na linha porque a tela '
  'mostra os dois lados juntos em "Ambas" e precisa dizer de quem e cada um.';

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_antes numeric;
  v_depois numeric;
begin
  -- 1. O invoker sobreviveu ao replace. Omiti-lo APAGA a opcao, e a view
  --    voltaria a rodar com os direitos do dono.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vw_conciliacao_meta'
       and 'security_invoker=on' = any(c.reloptions)
  ) then
    v_erros := v_erros || 'vw_conciliacao_meta perdeu o security_invoker. ';
  end if;

  -- 2. Toda linha agora sabe dizer de quem e. Se alguma vier sem nome, a tela
  --    volta a ter duas linhas indistinguiveis.
  select count(*) into v_n from public.vw_conciliacao_meta where empresa_nome is null;
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) sem nome de empresa. ', v_n);
  end if;

  -- 3. O par (mes, empresa) e unico. Era o que a chave do React presumia e a
  --    view nao garantia; se deixar de ser, o defeito volta com outra cara.
  select count(*) into v_n from (
    select mes, empresa_id from public.vw_conciliacao_meta
     group by 1,2 having count(*) > 1
  ) q;
  if v_n > 0 then
    v_erros := v_erros || format('%s par(es) (mes, empresa) repetidos na view. ', v_n);
  end if;

  -- 4. Os numeros nao mudaram. A view so ganhou duas colunas de texto, e o
  --    LEFT JOIN em empresas nao pode ter multiplicado nenhuma linha —
  --    seria o classico de um join alargando a base sem ninguem notar.
  select sum(ads_meta) into v_depois from public.vw_conciliacao_meta;
  select sum(m.investimento) into v_antes from public.metricas_meta m
   where m.nivel::text = 'campanha';
  if v_antes is null or v_depois is null or abs(v_antes - v_depois) > 1 then
    v_erros := v_erros || format('a view soma %s de ads_meta e metricas_meta tem %s. ',
                                 v_depois, v_antes);
  end if;

  -- 5. O caso concreto: setembro tem duas linhas, com nomes diferentes.
  select count(distinct empresa_nome) into v_n from public.vw_conciliacao_meta
   where mes = date '2026-09-01';
  if v_n < 2 then
    v_erros := v_erros || format('setembro tem %s empresa(s) distintas; esperava 2, que e '
                                 'o caso que gerou a chave duplicada. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % linhas, % empresas, nenhum par (mes,empresa) repetido, ads_meta soma %.',
    (select count(*) from public.vw_conciliacao_meta),
    (select count(distinct empresa_nome) from public.vw_conciliacao_meta),
    v_depois;
end $prova$;

notify pgrst, 'reload schema';
