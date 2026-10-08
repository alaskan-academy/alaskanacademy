-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Cada nota esperada diz de qual empresa ela é                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `fn_nfs_do_editor` gera as notas que cada editor deve: uma por (competência,
-- subtipo). Faltava a empresa, e por isso a aba tirava a empresa do seletor do
-- cabeçalho — o editor acabava decidindo, por um seletor que não é para isso,
-- o CNPJ de uma nota que ele já tinha emitido.
--
-- Agora a empresa vem com a linha, de `fn_empresa_do_editor` (20261008d). Três
-- consequências que são o ponto:
--
-- - **O editor não escolhe.** A tela MOSTRA de qual empresa é cada nota, e o
--   upload usa essa. Quem define é a administração, que conhece o contrato.
-- - **Serviço e comissão podem ser de empresas diferentes no mesmo envio**, e
--   a tela diz isso linha por linha, porque a empresa sai da COMPETÊNCIA de
--   cada uma e a comissão atrasa um mês.
-- - **Nulo é visível.** Editor sem vigência declarada aparece sem empresa, e o
--   upload recusa, em vez de herdar um palpite.
--
-- `drop` e não `create or replace`: mudar `returns table` exige recriar. As
-- colunas antigas continuam com os mesmos nomes, então o cliente que ainda não
-- deployou segue funcionando — ele só não lê as três novas.

drop function if exists public.fn_nfs_do_editor(uuid, date);

create or replace function public.fn_nfs_do_editor(
  p_editor_id uuid,
  p_mes date default (date_trunc('month', (now() at time zone 'America/Sao_Paulo')))::date
)
returns table(
  subtipo       text,
  competencia   date,
  rotulo        text,
  prazo         date,
  pagamento_em  date,
  quando_paga   text,
  situacao      text,
  dias          integer,
  documento_id  uuid,
  nome_arquivo  text,
  drive_url     text,
  enviada_em    timestamptz,
  -- As três novas. `empresa_id` é o que o upload carimba; nome e slug existem
  -- para a tela não precisar de uma segunda consulta só para escrever o rótulo
  -- e pintar o ponto da cor da marca.
  empresa_id    uuid,
  empresa_nome  text,
  empresa_slug  text
)
language sql
stable
as $function$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  /* O piso: o mes em que a pessoa comecou. Sem isto, um editor criado hoje
     abria a aba com cobrancas vermelhas de meses em que nao existia. Quem
     comecou dia 15 DEVE o servico daquele mes, entao o proprio mes de entrada
     conta — por isso `date_trunc`, e nao a data crua. `data_inicio` nulo nao
     peneira nada: ausencia de informacao nao vira cobranca nem perdao. */
  inicio as (
    select date_trunc('month', ed.data_inicio)::date as piso
      from public.editores ed where ed.id = p_editor_id
  ),
  competencias as (
    select (p_mes - interval '1 month')::date as c
    union all select p_mes
  ),
  esperadas as (
    select 'pagamento'::text as subtipo,
           c.c as competencia,
           'Serviço mensal'::text as rotulo,
           (c.c + interval '19 days')::date as prazo,
           (c.c + interval '1 month' + interval '4 days')::date as pagamento_em,
           'pago no dia 5 do mês seguinte'::text as quando_paga
      from competencias c
    union all
    select 'comissao',
           c.c,
           'Comissão',
           (c.c + interval '1 month' + interval '19 days')::date,
           (c.c + interval '1 month' + interval '7 days')::date,
           'paga na semana em que a NF chega'
      from competencias c
  )
  select e.subtipo, e.competencia, e.rotulo, e.prazo, e.pagamento_em, e.quando_paga,
         case when d.id is not null               then 'enviada'
              when (select d from hoje) > e.prazo then 'atrasada'
              else 'a_vencer' end as situacao,
         (e.prazo - (select d from hoje))::int as dias,
         d.id, d.nome_arquivo, d.drive_url, d.criado_em,
         /* A empresa VIGENTE para a competência desta linha. Da nota já
            enviada mostramos a empresa com que ela FOI gravada, e não a
            vigente: se a vigência mudar depois, a tela tem de continuar
            dizendo o que está no documento — senão a tela e o arquivo passam
            a discordar, e quem olha não tem como saber qual dos dois está
            certo. */
         coalesce(d.empresa_id, public.fn_empresa_do_editor(p_editor_id, e.competencia)) as empresa_id,
         emp.nome, emp.slug
    from esperadas e
    left join public.documentos_fiscais d
           on d.editor_id   = p_editor_id
          and d.tipo        = 'servico'
          and d.subtipo     = e.subtipo
          and d.competencia = e.competencia
    left join public.empresas emp
           on emp.id = coalesce(d.empresa_id,
                                public.fn_empresa_do_editor(p_editor_id, e.competencia))
   where e.prazo <= (p_mes + interval '1 month' - interval '1 day')::date
     and e.competencia >= coalesce((select piso from inicio), e.competencia)
   order by (d.id is not null), e.prazo;
$function$;

comment on function public.fn_nfs_do_editor(uuid, date) is
  'As notas que o editor deve no mês do envio, uma por (competência, subtipo), '
  'cada uma com a empresa vigente para a SUA competência. Da nota já enviada '
  'mostra a empresa gravada no documento, para a tela não discordar do arquivo.';

-- ── A prova ────────────────────────────────────────────────────────────────
-- O caso real da virada: em outubro a Jessica deve serviço/2026-10 (Aeliss) e
-- comissão/2026-09 (Alaskan) ao mesmo tempo. É a linha que um campo único em
-- `editores` erraria, então é a que tem de ser conferida.

do $$
declare
  v_jessica uuid;
  v_servico text;
  v_comissao text;
  v_sem_empresa int;
begin
  select id into v_jessica from public.editores where nome = 'Jessica Maihato';
  if v_jessica is null then
    raise notice 'Sem a Jessica Maihato para provar.';
    return;
  end if;

  select empresa_slug into v_servico
    from public.fn_nfs_do_editor(v_jessica, '2026-10-01')
   where subtipo = 'pagamento' and competencia = '2026-10-01';

  select empresa_slug into v_comissao
    from public.fn_nfs_do_editor(v_jessica, '2026-10-01')
   where subtipo = 'comissao' and competencia = '2026-09-01';

  if v_servico is distinct from 'aeliss' then
    raise exception 'PROVA FALHOU: serviço de outubro deveria ser aeliss, veio %.', v_servico;
  end if;
  if v_comissao is distinct from 'alaskan' then
    raise exception 'PROVA FALHOU: comissão de setembro deveria ser alaskan, veio %.', v_comissao;
  end if;

  -- E ninguém fica sem empresa, porque todos têm vigência semeada.
  select count(*) into v_sem_empresa
  from public.editores ed
  cross join lateral public.fn_nfs_do_editor(ed.id, '2026-10-01') n
  where ed.ativo and n.empresa_id is null;

  if v_sem_empresa > 0 then
    raise exception 'PROVA FALHOU: % nota(s) esperada(s) sem empresa.', v_sem_empresa;
  end if;

  raise notice 'PROVA OK: serviço/2026-10 = aeliss, comissão/2026-09 = alaskan, e nenhuma nota sem empresa.';
end $$;
