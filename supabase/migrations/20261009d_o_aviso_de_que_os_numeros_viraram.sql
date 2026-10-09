-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O aviso de que os números viraram                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A régua nunca sobrescreve o que ela confirmou. Mas "não sobrescrever" sozinho
-- é omissão: um card que ela validou em agosto e que hoje gasta R$ 300 por dia
-- com ROAS 0,65 continua dizendo "Validado" na tela, e nada denuncia.
--
-- Duas perguntas diferentes, dois objetos:
--
--   vw_criativo_virou_contra   "está se pagando AINDA?"   — os últimos 7 dias
--   o chip "régua discorda"    "a régua mudou de opinião?" — já vem de
--                              avaliacao_sugerida, não precisa de view
--
-- A primeira usa `vw_ad_morrendo` e não a régua, por um motivo que importa: a
-- régua julga a VIDA INTEIRA do anúncio (`fn_criativos_metricas(null, null)`),
-- então um card com ROAS acumulado 2,1 continua passando enquanto os últimos 7
-- dias desabam. `vw_ad_morrendo` compara 7 dias contra os 7 anteriores, já exige
-- `inv_7 >= 100` e `vd_ant >= 6`, e já está calibrada contra parede âmbar — 6
-- anúncios em 102. Era o objeto certo esperando ser usado.
--
-- ── Avisar NÃO é atualizar, e por isso isto vale para a base antiga ──────
--
-- A régua só opina sobre cards novos (`20261009b`). Este aviso, não: ele vale
-- justamente para os 393 cards que alguém julgou de verdade, que é onde um
-- "Validado" velho pode estar custando dinheiro. Nenhuma das duas views escreve
-- nada.
--
-- ── Os níveis vêm da TABELA ──────────────────────────────────────────────
--
-- `p.avaliacao in (select nivel from vw_crivo_niveis_vigentes)` em vez de
-- `in ('Validado','Escalado')`. O dia em que um nível novo entrar no crivo, o
-- aviso o cobre sozinho. Terceira armadilha.
--
-- ── vw_alertas vai POR EXTENSO ───────────────────────────────────────────
--
-- A definição inteira está reescrita aqui, com um ramo a mais. Não é desperdício:
-- em 04/10/2026 nove migrações foram aplicadas direto no banco e dois
-- `create or replace view` derrubaram o `security_invoker` de `vw_alertas` e
-- `vw_rev_tendencia` — as duas voltaram a rodar com os direitos do dono,
-- legíveis por `anon`, com faturamento por REV dentro. E a catraca que existe
-- para isso não viu nada, porque não havia arquivo para ela ler. Os testes
-- `tendencia-acusa-e-explica` e `rastreio-que-regride-acusa` leem este arquivo.

begin;

-- ---------------------------------------------------------------------------
-- 1. O card que ela validou e que virou contra
-- ---------------------------------------------------------------------------
create or replace view public.vw_criativo_virou_contra
  with (security_invoker = on) as
select p.id                              as producao_id,
       p.nome,
       p.avaliacao,
       p.avaliacao_origem,
       oe.empresa_id,
       count(*)                          as ads_morrendo,
       round(sum(am.gasto_agora), 2)     as gasto_7d,
       min(am.roas_agora)                as pior_roas,
       max(am.roas_antes)                as melhor_roas_antes,
       min(am.queda_pct)                 as pior_queda
  from public.vw_ad_morrendo am
  join public.producoes p on p.id = am.producao_id
  left join public.ofertas_editores oe on oe.id = p.projeto_id
 -- Só o que ELA decidiu: um card 'automatico' que virou contra a régua corrige
 -- sozinha na passada seguinte, e avisar ali seria ruído.
 where p.avaliacao_origem = 'humano'
   -- E só os níveis que APROVAM, lidos da tabela do crivo.
   and p.avaliacao in (select n.nivel from public.vw_crivo_niveis_vigentes n)
 group by p.id, p.nome, p.avaliacao, p.avaliacao_origem, oe.empresa_id;

comment on view public.vw_criativo_virou_contra is
  'Cards que ELA aprovou (avaliacao_origem = humano, em nível de aprovação) e '
  'cujos anúncios estão morrendo nos últimos 7 dias por vw_ad_morrendo. Não '
  'escreve nada: a régua não sobrescreve julgamento humano, então a tela avisa. '
  'Os níveis de aprovação são lidos de vw_crivo_niveis_vigentes, nunca de uma '
  'lista no código. Vale para a base antiga: avisar não é atualizar.';

-- ---------------------------------------------------------------------------
-- 2. O vigia da própria automação
-- ---------------------------------------------------------------------------
-- Sem isto, o dia em que o cron parar a tela continua mostrando valores velhos
-- com cara de atuais — e já aconteceu: 52 execuções de `cs-sync-daily` falharam
-- em silêncio entre 30/06 e 20/08/2026. Toda automação precisa de alguém
-- perguntando se ela rodou.
create or replace function public.fn_alerta_avaliacao_parada()
  returns table(codigo text, severidade text, titulo text, detalhe text)
  language sql
  stable
as $fn$
  with estado as (
    select (select max(decidido_em) from public.avaliacao_sugerida) as ultimo,
           (select count(*) from public.producoes p
             where p.fase = 'postado' and p.tipo = 'criativo'
               and not exists (select 1 from public.avaliacao_sugerida s
                                where s.producao_id = p.id)) as sem_veredito
  )
  select 'avaliacao_parada'::text,
         case when e.ultimo is null or e.ultimo < now() - interval '12 hours'
              then 'critico'::text else 'atencao'::text end,
         case when e.ultimo is null
              then 'A régua de avaliação nunca rodou'
              else 'A régua de avaliação parou há '
                   || round(extract(epoch from (now() - e.ultimo)) / 3600)::text || 'h' end,
         case when e.sem_veredito > 0
              then e.sem_veredito::text
                   || ' criativo(s) postado(s) sem veredito. A tela mostra avaliação '
                   || 'automática com cara de atual enquanto o cron não roda.'
              else 'Nenhum card sem veredito, mas o cron horário não passa desde '
                   || to_char(e.ultimo at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
                   || '. Verificar atribuicao-horaria.' end
    from estado e
   where e.ultimo is null
      or e.ultimo < now() - interval '3 hours'
      or e.sem_veredito > 0;
$fn$;

comment on function public.fn_alerta_avaliacao_parada() is
  'Acusa quando a régua de avaliação parou de rodar ou deixou criativo postado '
  'sem veredito. Existe porque automação sem vigia mostra valor velho com cara '
  'de atual, e isso não dá erro em lugar nenhum.';

revoke all on function public.fn_alerta_avaliacao_parada() from anon;
grant execute on function public.fn_alerta_avaliacao_parada() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. vw_alertas, por extenso, com o ramo novo no fim
-- ---------------------------------------------------------------------------
create or replace view public.vw_alertas
  with (security_invoker = on) as
 SELECT 'fonte_parada'::text AS codigo,
        CASE
            WHEN h.horas_atras > (h.limiar_horas * 4::numeric) THEN 'critico'::text
            ELSE 'atencao'::text
        END AS severidade,
    h.rotulo || ' sem atualizar'::text AS titulo,
    COALESCE(h.detalhe, 'Última entrada há '::text ||
        CASE
            WHEN h.horas_atras < 48::numeric THEN round(h.horas_atras)::text || 'h'::text
            ELSE round(h.horas_atras / 24::numeric)::text || ' dias'::text
        END) AS detalhe
   FROM vw_ingest_health h
  WHERE h.defasado
UNION ALL
 SELECT 'conta_sem_produto'::text AS codigo,
    'critico'::text AS severidade,
    count(*)::text || ' conta(s) de anúncio gastando sem produto definido'::text AS titulo,
    (fn_brl(sum(x.gasto)) || ' nos últimos 7 dias não entram no cálculo: '::text) || string_agg(x.nome, ', '::text) AS detalhe
   FROM ( SELECT a.nome,
            sum(m.investimento) AS gasto
           FROM metricas_meta m
             JOIN ad_accounts a ON a.id = m.ad_account_id
          WHERE m.nivel = 'campanha'::nivel_meta AND m.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7) AND a.produto IS NULL
          GROUP BY a.nome
         HAVING sum(m.investimento) > 0::numeric) x
 HAVING count(*) > 0
UNION ALL
 SELECT 'receita_sem_rastreio'::text AS codigo,
        CASE
            WHEN y.pct > 40::numeric THEN 'critico'::text
            ELSE 'atencao'::text
        END AS severidade,
    round(y.pct)::text || '% da receita de origem desconhecida'::text AS titulo,
    fn_brl(y.valor) || ' nos últimos 7 dias não vieram de anúncio rastreado nem de origem já identificada'::text AS detalhe
   FROM ( SELECT 100.0 * sum(vendas.valor_sem_juros) FILTER (WHERE vendas.ad_id_meta IS NULL AND vendas.trafego_pago IS NOT TRUE) / NULLIF(sum(vendas.valor_sem_juros), 0::numeric) AS pct,
            sum(vendas.valor_sem_juros) FILTER (WHERE vendas.ad_id_meta IS NULL AND vendas.trafego_pago IS NOT TRUE) AS valor
           FROM vendas
          WHERE vendas.status = 'aprovada'::status_venda AND vendas.is_upsell IS NOT TRUE AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) y
  WHERE y.pct > 25::numeric
UNION ALL
 SELECT 'meta_divergente'::text AS codigo,
    'critico'::text AS severidade,
    'Meta reporta mais conversões do que houve vendas'::text AS titulo,
    ((('Meta: '::text || z.meta::text) || ' conversões · Payt: '::text) || z.total::text) || ' vendas no total nos últimos 7 dias. Sinal de contagem duplicada.'::text AS detalhe
   FROM ( SELECT ( SELECT COALESCE(sum(metricas_meta.compras_meta), 0::bigint) AS "coalesce"
                   FROM metricas_meta
                  WHERE metricas_meta.nivel = 'campanha'::nivel_meta AND metricas_meta.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) AS meta,
            ( SELECT count(*) AS count
                   FROM vendas
                  WHERE vendas.status = 'aprovada'::status_venda AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)) AS total) z
  WHERE z.total > 0 AND (z.meta::numeric / z.total::numeric) > 1.5
UNION ALL
 SELECT fn_alerta_venda_sem_categoria.codigo,
    fn_alerta_venda_sem_categoria.severidade,
    fn_alerta_venda_sem_categoria.titulo,
    fn_alerta_venda_sem_categoria.detalhe
   FROM fn_alerta_venda_sem_categoria() fn_alerta_venda_sem_categoria(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT fn_alerta_webhook_pendente.codigo,
    fn_alerta_webhook_pendente.severidade,
    fn_alerta_webhook_pendente.titulo,
    fn_alerta_webhook_pendente.detalhe
   FROM fn_alerta_webhook_pendente() fn_alerta_webhook_pendente(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT 'venda_sem_liquido'::text AS codigo,
    'atencao'::text AS severidade,
    count(*)::text || ' venda(s) sem o líquido do produtor'::text AS titulo,
    fn_brl(sum(vendas.valor_sem_juros)) || ' nos últimos 7 dias: a Payt mandou a comissão zerada, então o valor a receber fica de fora das somas'::text AS detalhe
   FROM vendas
  WHERE vendas.status = 'aprovada'::status_venda AND vendas.valor_liquido_produtor IS NULL AND (vendas.data_venda AT TIME ZONE 'America/Sao_Paulo'::text)::date >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7)
 HAVING count(*) > 0
UNION ALL
 SELECT 'venda_nao_normalizada'::text AS codigo,
    'critico'::text AS severidade,
    count(*)::text || ' venda(s) recebidas da Payt que não viraram registro'::text AS titulo,
    fn_brl(sum(p.valor)) || ' nos últimos 7 dias estão na camada bruta mas não em vendas'::text AS detalhe
   FROM vendas_payt p
  WHERE p.status = 'paid'::text AND p.data >= ((now() AT TIME ZONE 'America/Sao_Paulo'::text)::date - 7) AND NOT (EXISTS ( SELECT 1
           FROM vendas v
          WHERE v.pedido_id = p.payt_id))
 HAVING count(*) > 0
UNION ALL
 SELECT fn_alerta_conta_sem_venda.codigo,
    fn_alerta_conta_sem_venda.severidade,
    fn_alerta_conta_sem_venda.titulo,
    fn_alerta_conta_sem_venda.detalhe
   FROM fn_alerta_conta_sem_venda() fn_alerta_conta_sem_venda(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT fn_alerta_cron_falhando.codigo,
    fn_alerta_cron_falhando.severidade,
    fn_alerta_cron_falhando.titulo,
    fn_alerta_cron_falhando.detalhe
   FROM fn_alerta_cron_falhando() fn_alerta_cron_falhando(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT r.codigo,
    r.severidade,
    r.titulo,
    r.detalhe
   FROM fn_alerta_rastreio_regredindo() r(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT s.codigo,
    s.severidade,
    s.titulo,
    s.detalhe
   FROM fn_alerta_payt_silencio() s(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT t.codigo,
    t.severidade,
    t.titulo,
    t.detalhe
   FROM fn_alerta_trafego_sem_anuncio() t(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT c.codigo,
    c.severidade,
    c.titulo,
    c.detalhe
   FROM fn_alerta_checkout_sem_rastreio() c(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT x.codigo,
    x.severidade,
    x.titulo,
    x.detalhe
   FROM fn_alerta_venda_empresa_errada() x(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT x.codigo,
    x.severidade,
    x.titulo,
    x.detalhe
   FROM fn_alerta_conta_anuncio_invisivel() x(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT x.codigo,
    x.severidade,
    x.titulo,
    x.detalhe
   FROM fn_alerta_cadastro_a_arrumar() x(codigo, severidade, titulo, detalhe)
UNION ALL
 SELECT a.codigo,
    a.severidade,
    a.titulo,
    a.detalhe
   FROM fn_alerta_avaliacao_parada() a(codigo, severidade, titulo, detalhe);

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_inv   boolean;
begin
  -- 1. `security_invoker` sobreviveu ao replace. É o defeito exato de 04/10:
  --    `create or replace view` REDEFINE as reloptions, e omitir a opção a
  --    APAGA — a view volta a rodar com os direitos do dono e fica legível por
  --    `anon`, com faturamento dentro.
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vw_alertas'
       and c.reloptions @> array['security_invoker=on']
  ) into v_inv;
  if not v_inv then
    v_erros := v_erros || 'vw_alertas perdeu o security_invoker no replace. ';
  end if;

  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'vw_criativo_virou_contra'
       and c.reloptions @> array['security_invoker=on']
  ) into v_inv;
  if not v_inv then
    v_erros := v_erros || 'vw_criativo_virou_contra nasceu sem security_invoker. ';
  end if;

  -- 2. Os 17 alertas antigos continuam lá, e o novo entrou. Contar os ramos é
  --    o que acusa um UNION perdido na transcrição.
  select count(*) into v_n
    from regexp_matches(pg_get_viewdef('public.vw_alertas'::regclass, true), 'UNION ALL', 'g');
  if v_n <> 17 then
    v_erros := v_erros || format('vw_alertas tem %s UNION ALL, esperava 17 (16 ramos antigos + o novo). ', v_n);
  end if;

  if pg_get_viewdef('public.vw_alertas'::regclass, true) not like '%fn_alerta_avaliacao_parada%' then
    v_erros := v_erros || 'o ramo da avaliacao nao entrou em vw_alertas. ';
  end if;

  -- 3. A view inteira responde. Um ramo quebrado derruba a lista toda, e esta
  --    lista é o que a Visão Geral mostra.
  begin
    select count(*) into v_n from public.vw_alertas;
  exception when others then
    v_erros := v_erros || format('vw_alertas nao executa: %s. ', sqlerrm);
  end;

  -- 4. O alerta novo roda e, AGORA, deve estar silencioso: a régua acabou de
  --    rodar em 20261009c e nenhum criativo postado ficou sem veredito.
  select count(*) into v_n from public.fn_alerta_avaliacao_parada();
  if v_n <> 0 then
    v_erros := v_erros || format('fn_alerta_avaliacao_parada acusou %s alerta(s) logo depois de a regua rodar. ', v_n);
  end if;

  -- 5. `vw_criativo_virou_contra` não cita nível de avaliação escrito à mão.
  if pg_get_viewdef('public.vw_criativo_virou_contra'::regclass, true) ~ '''(Validado|Escalado|Não validado|Sem dados)'''
  then
    v_erros := v_erros || 'vw_criativo_virou_contra tem nivel de avaliacao escrito no codigo. ';
  end if;

  -- 6. E ela só olha julgamento humano.
  if pg_get_viewdef('public.vw_criativo_virou_contra'::regclass, true) not like '%humano%' then
    v_erros := v_erros || 'vw_criativo_virou_contra nao filtra por avaliacao_origem = humano. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.vw_criativo_virou_contra;
  raise notice 'PROVA OK: vw_alertas reescrita por extenso com 17 ramos e security_invoker intacto, o vigia da regua esta silencioso, e % card(s) que ela validou estao virando contra agora.', v_n;
end $prova$;

notify pgrst, 'reload schema';
