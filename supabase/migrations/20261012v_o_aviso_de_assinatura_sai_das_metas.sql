-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O aviso de assinatura sai das Metas, e a Saponária sai do plano         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Duas correções pedidas por ela olhando a tela.
--
-- ── 1. "o que isso tem a ver com as metas para ter este aviso aqui?" ──────
--
-- Ela apontou a tarja "8 assinatura(s) ativas com o ciclo vencido" no topo
-- de /metas. Está certa: aquilo não é sobre o plano de crescimento, é
-- higiene de dado.
--
-- O raciocínio que me levou a pôr ali foi: `assinaturas_ativas` é um KPI do
-- plano, e as 8 inflam o número. Isso é verdade — e justifica uma NOTA no
-- indicador, não uma tarja no topo da tela. Uma tela de metas que avisa
-- sobre qualidade de cadastro ensina a ignorar as tarjas dela.
--
-- E o painel já tem o canal certo: `vw_alertas` reúne 17 avisos de higiene e
-- aparece no Início (`SaudeSistema`) e na tarja do topo
-- (`IngestStatusBanner`). O aviso vira o 18º, no padrão `fn_alerta_*` que os
-- outros já seguem.
--
-- `fn_metas_alertas` fica com o que é do plano: ação vencida, ação vencendo,
-- a regra do ROAS de duas semanas e meta andando mais devagar que o prazo.
--
-- ── A view vai por extenso, e a primeira tentativa foi por código ────────
--
-- `vw_alertas` tem dezoito ramos e umas cem linhas. Para não arriscar erro
-- de transcrição numa view que alimenta a tarja de topo do painel inteiro,
-- eu a remontei por código: `pg_get_viewdef` + `union all` + `execute`.
--
-- Funcionou no banco e reprovou no teste, com razão.
-- `rastreio-que-regride-acusa` lê as MIGRAÇÕES para checar que o ramo do
-- alerta está na view — e passou a encontrar esta migração, onde o
-- `create or replace view` existia só dentro de uma string. A definição
-- ficou invisível para a catraca.
--
-- É a regra do CLAUDE.md numa forma mais sutil que a usual: não basta o
-- arquivo existir, o arquivo precisa CONTER a definição. View montada em
-- tempo de execução passa por fora de todo teste que lê SQL.
--
-- Então vai por extenso. O `with (security_invoker = on)` está na própria
-- instrução porque `create or replace view` redefine as reloptions, e
-- omitir apaga — foi o que derrubou `vw_alertas` em 04/10.
--
-- ── 2. "Regularizar a conta de anúncio Saponaria - remova" ────────────────
--
-- Sai das 80 ações. O plano se contradizia sobre ela (a seção 1 dizia que a
-- conta estava em carência, a seção 3 marcava a regularização como feita), e
-- a conta gastou R$ 43,4 mil entre 1 e 10 de outubro — está rodando. Ela
-- decidiu: fora.
--
-- Ficam 79 ações, 2 marcadas como feitas, 3 sem objetivo.

begin;

-- ── A ação sai ────────────────────────────────────────────────────────────
delete from public.plano_acoes
 where titulo = 'Regularizar a conta de anúncio "Saponaria"';

commit;

-- ── O aviso ganha a forma dos outros dezessete ───────────────────────────
create or replace function public.fn_alerta_assinatura_ciclo_vencido()
 returns table (codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- O painel CONTA e nao conserta: status de assinatura e dinheiro de
  -- terceiro, e a ultima vez que um UPDATE em massa mexeu nisso
  -- (`20261012i`) quase matou 11 anuais por ler max() sobre coluna quase
  -- toda nula.
  select 'assinatura_ciclo_vencido'::text,
         'atencao'::text,
         count(*)::text || ' assinatura(s) ativas com o ciclo vencido',
         count(*) filter (where renovou)::text || ' renovaram e só a data ficou velha; '
         || count(*) filter (where not renovou)::text
         || ' não têm venda aprovada depois do ciclo. A mais antiga venceu há '
         || max(current_date - venceu_em)::text || ' dias. '
         || 'Conferir uma a uma: o painel não mexe em status de assinatura sozinho.'
    from (
      select a.data_proximo_ciclo::date as venceu_em,
             exists (select 1 from public.vendas v
                      where v.assinatura_id = a.id and v.status = 'aprovada'
                        and v.data_venda >= a.data_proximo_ciclo::date - 5) as renovou
        from public.assinaturas a
       where a.status = 'ativa'
         and a.data_proximo_ciclo is not null
         and a.data_proximo_ciclo < current_date
    ) q
  having count(*) > 0;
$function$;

comment on function public.fn_alerta_assinatura_ciclo_vencido() is
  'Assinatura marcada como ativa cujo proximo ciclo ja passou. Mora em '
  'vw_alertas e NAO em fn_metas_alertas: e higiene de cadastro, nao desvio '
  'do plano de crescimento.';

revoke all on function public.fn_alerta_assinatura_ciclo_vencido() from public, anon;
grant execute on function public.fn_alerta_assinatura_ciclo_vencido() to authenticated, service_role;

-- ── `vw_alertas` ganha o décimo nono ramo ────────────────────────────────
create or replace view public.vw_alertas
with (security_invoker = on) as
 select 'fonte_parada'::text as codigo,
        case when h.horas_atras > (h.limiar_horas * 4::numeric) then 'critico'::text
             else 'atencao'::text end as severidade,
        h.rotulo || ' sem atualizar'::text as titulo,
        coalesce(h.detalhe, 'Última entrada há '::text ||
          case when h.horas_atras < 48::numeric then round(h.horas_atras)::text || 'h'::text
               else round(h.horas_atras / 24::numeric)::text || ' dias'::text end) as detalhe
   from vw_ingest_health h
  where h.defasado
union all
 select 'conta_sem_produto'::text, 'critico'::text,
        count(*)::text || ' conta(s) de anúncio gastando sem produto definido'::text,
        (fn_brl(sum(x.gasto)) || ' nos últimos 7 dias não entram no cálculo: '::text)
          || string_agg(x.nome, ', '::text)
   from ( select a.nome, sum(m.investimento) as gasto
            from metricas_meta m
            join ad_accounts a on a.id = m.ad_account_id
           where m.nivel = 'campanha'::nivel_meta
             and m.data >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)
             and a.produto is null
           group by a.nome
          having sum(m.investimento) > 0::numeric) x
 having count(*) > 0
union all
 select 'receita_sem_rastreio'::text,
        case when y.pct > 40::numeric then 'critico'::text else 'atencao'::text end,
        round(y.pct)::text || '% da receita de origem desconhecida'::text,
        fn_brl(y.valor) || ' nos últimos 7 dias não vieram de anúncio rastreado nem de origem já identificada'::text
   from ( select 100.0 * sum(vendas.valor_sem_juros) filter (where vendas.ad_id_meta is null and vendas.trafego_pago is not true)
                 / nullif(sum(vendas.valor_sem_juros), 0::numeric) as pct,
                 sum(vendas.valor_sem_juros) filter (where vendas.ad_id_meta is null and vendas.trafego_pago is not true) as valor
            from vendas
           where vendas.status = 'aprovada'::status_venda
             and vendas.is_upsell is not true
             and (vendas.data_venda at time zone 'America/Sao_Paulo'::text)::date
                 >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)) y
  where y.pct > 25::numeric
union all
 select 'meta_divergente'::text, 'critico'::text,
        'Meta reporta mais conversões do que houve vendas'::text,
        ((('Meta: '::text || z.meta::text) || ' conversões · Payt: '::text) || z.total::text)
          || ' vendas no total nos últimos 7 dias. Sinal de contagem duplicada.'::text
   from ( select ( select coalesce(sum(metricas_meta.compras_meta), 0::bigint)
                     from metricas_meta
                    where metricas_meta.nivel = 'campanha'::nivel_meta
                      and metricas_meta.data >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)) as meta,
                 ( select count(*) from vendas
                    where vendas.status = 'aprovada'::status_venda
                      and (vendas.data_venda at time zone 'America/Sao_Paulo'::text)::date
                          >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)) as total) z
  where z.total > 0 and (z.meta::numeric / z.total::numeric) > 1.5
union all
 select fn_alerta_venda_sem_categoria.codigo, fn_alerta_venda_sem_categoria.severidade,
        fn_alerta_venda_sem_categoria.titulo, fn_alerta_venda_sem_categoria.detalhe
   from fn_alerta_venda_sem_categoria() fn_alerta_venda_sem_categoria(codigo, severidade, titulo, detalhe)
union all
 select fn_alerta_webhook_pendente.codigo, fn_alerta_webhook_pendente.severidade,
        fn_alerta_webhook_pendente.titulo, fn_alerta_webhook_pendente.detalhe
   from fn_alerta_webhook_pendente() fn_alerta_webhook_pendente(codigo, severidade, titulo, detalhe)
union all
 select 'venda_sem_liquido'::text, 'atencao'::text,
        count(*)::text || ' venda(s) sem o líquido do produtor'::text,
        fn_brl(sum(vendas.valor_sem_juros))
          || ' nos últimos 7 dias: a Payt mandou a comissão zerada, então o valor a receber fica de fora das somas'::text
   from vendas
  where vendas.status = 'aprovada'::status_venda
    and vendas.valor_liquido_produtor is null
    and (vendas.data_venda at time zone 'America/Sao_Paulo'::text)::date
        >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)
 having count(*) > 0
union all
 select 'venda_nao_normalizada'::text, 'critico'::text,
        count(*)::text || ' venda(s) recebidas da Payt que não viraram registro'::text,
        fn_brl(sum(p.valor)) || ' nos últimos 7 dias estão na camada bruta mas não em vendas'::text
   from vendas_payt p
  where p.status = 'paid'::text
    and p.data >= ((now() at time zone 'America/Sao_Paulo'::text)::date - 7)
    and not (exists ( select 1 from vendas v where v.pedido_id = p.payt_id))
 having count(*) > 0
union all
 select fn_alerta_conta_sem_venda.codigo, fn_alerta_conta_sem_venda.severidade,
        fn_alerta_conta_sem_venda.titulo, fn_alerta_conta_sem_venda.detalhe
   from fn_alerta_conta_sem_venda() fn_alerta_conta_sem_venda(codigo, severidade, titulo, detalhe)
union all
 select fn_alerta_cron_falhando.codigo, fn_alerta_cron_falhando.severidade,
        fn_alerta_cron_falhando.titulo, fn_alerta_cron_falhando.detalhe
   from fn_alerta_cron_falhando() fn_alerta_cron_falhando(codigo, severidade, titulo, detalhe)
union all
 select r.codigo, r.severidade, r.titulo, r.detalhe
   from fn_alerta_rastreio_regredindo() r(codigo, severidade, titulo, detalhe)
union all
 select s.codigo, s.severidade, s.titulo, s.detalhe
   from fn_alerta_payt_silencio() s(codigo, severidade, titulo, detalhe)
union all
 select t.codigo, t.severidade, t.titulo, t.detalhe
   from fn_alerta_trafego_sem_anuncio() t(codigo, severidade, titulo, detalhe)
union all
 select c.codigo, c.severidade, c.titulo, c.detalhe
   from fn_alerta_checkout_sem_rastreio() c(codigo, severidade, titulo, detalhe)
union all
 select x.codigo, x.severidade, x.titulo, x.detalhe
   from fn_alerta_venda_empresa_errada() x(codigo, severidade, titulo, detalhe)
union all
 select x.codigo, x.severidade, x.titulo, x.detalhe
   from fn_alerta_conta_anuncio_invisivel() x(codigo, severidade, titulo, detalhe)
union all
 select x.codigo, x.severidade, x.titulo, x.detalhe
   from fn_alerta_cadastro_a_arrumar() x(codigo, severidade, titulo, detalhe)
union all
 select a.codigo, a.severidade, a.titulo, a.detalhe
   from fn_alerta_avaliacao_parada() a(codigo, severidade, titulo, detalhe)
union all
 -- O ramo novo: o aviso que saiu de /metas.
 select x.codigo, x.severidade, x.titulo, x.detalhe
   from fn_alerta_assinatura_ciclo_vencido() x(codigo, severidade, titulo, detalhe);

-- ── `fn_metas_alertas` fica só com o que é do plano ──────────────────────
create or replace function public.fn_metas_alertas(p_empresa uuid default null)
 returns table (codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select 'acao_vencida'::text, 'critico'::text,
         count(*)::text || ' ação(ões) do plano venceram',
         string_agg(titulo || ' (' || to_char(prazo, 'DD/MM') || ')', ' · ' order by prazo)
    from public.plano_acoes
   where feito_em is null and prazo is not null and prazo < current_date
  having count(*) > 0

  union all

  select 'acao_vencendo'::text, 'atencao'::text,
         count(*)::text || ' ação(ões) vencem nos próximos 7 dias',
         string_agg(titulo || ' (' || to_char(prazo, 'DD/MM') || ')', ' · ' order by prazo)
    from public.plano_acoes
   where feito_em is null and prazo is not null
     and prazo >= current_date and prazo <= current_date + 7
  having count(*) > 0

  union all

  select 'roas_duas_semanas'::text, 'critico'::text,
         'ROAS de 14 dias em ' ||
           replace(to_char(sum(f.faturamento_bruto)
                           / nullif(sum(f.investimento_meta), 0), 'FM9.00'), '.', ',')
           || 'x, abaixo de 1,50x',
         'Regra do plano: a verba volta ao nível de agosto até a oferta nova '
         'estar no ar. Receita ' || public.fn_brl(sum(f.faturamento_bruto)) ||
         ' e investimento ' || public.fn_brl(sum(f.investimento_meta)) ||
         ' entre ' || to_char(current_date - 14, 'DD/MM') || ' e ' ||
         to_char(current_date - 1, 'DD/MM') || '.'
    from public.vw_faturamento_liquido f
   where f.data >= current_date - 14 and f.data < current_date
     and (p_empresa is null or f.empresa_id = p_empresa)
  having sum(f.investimento_meta) > 0
     and sum(f.faturamento_bruto) / sum(f.investimento_meta) < 1.50

  union all

  select 'meta_atrasada'::text, 'atencao'::text,
         count(*)::text || ' meta(s) andando mais devagar que o prazo',
         string_agg(nome || ': ' || round(caminho * 100) || '% do caminho com '
                    || round(tempo * 100) || '% do prazo', ' · '
                    order by (tempo - caminho) desc)
    from public.fn_metas_progresso(p_empresa)
   where e_proximo and situacao = 'atrasada'
  having count(*) > 0;
$function$;

comment on function public.fn_metas_alertas(uuid) is
  'So o que e desvio do PLANO: acao vencida, acao vencendo, a regra do ROAS '
  'de duas semanas e meta mais devagar que o prazo. Higiene de cadastro vai '
  'para vw_alertas, que e o canal que o Inicio e a tarja de topo leem.';

revoke all on function public.fn_metas_alertas(uuid) from public, anon;
grant execute on function public.fn_metas_alertas(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
begin
  -- 1. A Saponaria saiu, e so ela.
  if exists (select 1 from public.plano_acoes
              where titulo = 'Regularizar a conta de anúncio "Saponaria"') then
    v_erros := v_erros || 'a acao da Saponaria continua la. ';
  end if;
  select count(*) into v_n from public.plano_acoes;
  if v_n <> 79 then v_erros := v_erros || format('%s acoes, esperava 79. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where feito_em is not null;
  if v_n <> 2 then v_erros := v_erros || format('%s feitas, esperava 2. ', v_n); end if;

  -- 2. O aviso SAIU das metas.
  if pg_get_functiondef('public.fn_metas_alertas(uuid)'::regprocedure)
       ilike '%assinatura%' then
    v_erros := v_erros || 'fn_metas_alertas ainda fala de assinatura. ';
  end if;
  if exists (select 1 from public.fn_metas_alertas(null)
              where codigo = 'assinatura_ciclo_vencido') then
    v_erros := v_erros || 'o aviso de assinatura ainda sai em fn_metas_alertas. ';
  end if;

  -- 3. ...e ENTROU no canal certo. As duas metades: sumir de um lado sem
  --    aparecer no outro seria perder o aviso, nao move-lo.
  if not exists (select 1 from public.vw_alertas where codigo = 'assinatura_ciclo_vencido') then
    v_erros := v_erros || 'o aviso nao aparece em vw_alertas. ';
  end if;

  -- 4. Os avisos que ja existiam continuam saindo. Remontar a view por
  --    codigo e seguro, mas nao e de graca: se o texto vier truncado, os
  --    ramos antigos somem em silencio.
  select count(*) into v_n from public.vw_alertas;
  if v_n < 1 then v_erros := v_erros || 'vw_alertas ficou vazia. '; end if;

  -- 5. O invoker sobreviveu ao replace. Ja caiu uma vez neste projeto, em
  --    04/10, exatamente assim.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='vw_alertas'
       and 'security_invoker=on' = any(c.reloptions)
  ) then
    v_erros := v_erros || 'vw_alertas perdeu o security_invoker. ';
  end if;

  -- 6. A funcao nova nao ficou aberta.
  if has_function_privilege('anon', 'public.fn_alerta_assinatura_ciclo_vencido()', 'execute') then
    v_erros := v_erros || 'anon consegue executar fn_alerta_assinatura_ciclo_vencido. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % acoes (% feitas), % avisos em vw_alertas, % avisos de plano em fn_metas_alertas.',
    (select count(*) from public.plano_acoes),
    (select count(*) from public.plano_acoes where feito_em is not null),
    (select count(*) from public.vw_alertas),
    (select count(*) from public.fn_metas_alertas(null));
end $prova$;

notify pgrst, 'reload schema';
