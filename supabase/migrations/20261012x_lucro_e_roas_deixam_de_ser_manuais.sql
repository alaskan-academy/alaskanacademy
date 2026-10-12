-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Lucro e ROAS deixam de ser manuais                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Os dois KPIs que o plano abre — "Lucro líquido por mês" e "ROAS médio" —
-- nasceram marcados como manuais porque não havia onde buscá-los. Agora há:
-- `fn_resultado_mes` (`20261012w`) é a definição única de lucro, e a conta do
-- ROAS sai de `vw_faturamento_liquido`.
--
-- ── O mês que vale é o último FECHADO ────────────────────────────────────
--
-- Hoje é 12/10 e outubro tem doze dias. Medir o mês corrente faria o lucro
-- despencar todo dia 1º e subir até o dia 31, e a meta é mensal — a tela
-- mostraria uma queda que é só o calendário. Então o indicador lê setembro
-- até novembro chegar.
--
-- Vale conferir o tamanho do engano que isso evita: setembro fecha em
-- −R$ 206 e outubro, pela metade, está em −R$ 12.090.
--
-- ── A série que apareceu quando o lucro passou a ser medido ──────────────
--
--     mai/26   resultado   9.825 · sócios 12.000 · lucro  −2.175
--     jun/26              −2.468 ·        12.000 ·       −14.468
--     jul/26               9.889 ·         9.540 ·          +349
--     ago/26              21.412 ·         9.000 ·       +12.412
--     set/26              11.794 ·        12.000 ·          −206
--
-- O plano registra setembro como ≈ −R$ 10 mil. A diferença é a dupla
-- cobrança do imposto que ela mandou tirar do custo fixo — ver `20261012w`.
-- `valor_base` continua guardando os −R$ 10 mil do documento: é comparando
-- os dois que a tela mostra o que o plano não sabia.
--
-- ── Por que o ROAS daqui não é o do /resumo ──────────────────────────────
--
-- O ROAS da tela de Resumo muda com o filtro de segmento, porque o filtro
-- recorta a receita e NÃO recorta o gasto: em setembro, misto 1,554 ·
-- tráfego 1,359 · backend 0,195, com o mesmo denominador. Isso é uma
-- configuração de leitura, e uma meta não tem onde guardar configuração.
--
-- Aqui a definição é uma só e está escrita na nota do indicador: faturamento
-- bruto do mês fechado dividido pelo investimento no Meta. O investimento sai
-- de `metricas_meta` com `nivel = 'campanha'` — somar os três níveis
-- (campanha, adset, anúncio) triplica a verba, e foi o que fez julho parecer
-- R$ 209,8 mil quando são R$ 70,1 mil.
--
-- E nada disto toca `ad_accounts.roas_meta`: aquilo é alvo por conta de
-- anúncio, decisão dela de 12/10 e segue onde está.
--
-- ── Sobram três manuais, e cada uma tem o motivo escrito ─────────────────
--
--   pix_pendente_recuperado_pct — falta fechar a definição de "recuperado"
--   alunas_ativas_30d_pct       — vem do banco da Área de Membros
--   bumps_abertos_pct           — idem, e precisa casar com venda_itens
--
-- A regra de decisão "se em dez/26 o lucro estiver abaixo de R$ 10 mil" sai
-- de `porque_nao` e passa a automática: agora há de onde medir.

begin;

update public.metas_kpi
   set automatico = true,
       observacao = 'Depois das retiradas de socio, por COMPETENCIA, do ULTIMO MES FECHADO '
                    '— outubro so entra em novembro, senao um mes pela metade apareceria '
                    'como queda. Sai de fn_resultado_mes, que e a unica definicao de lucro '
                    'do projeto. As tres decisoes sao dela, em 12/10/2026: competencia; '
                    'socios dentro ("e para os custos de vida dos socios"); e o imposto '
                    'FORA do custo fixo, porque o plano o contava duas vezes.'
 where chave = 'lucro_liquido_mes';

update public.metas_kpi
   set automatico = true,
       observacao = 'Faturamento bruto dividido pelo investimento no Meta, do ultimo mes '
                    'fechado. NAO e ad_accounts.roas_meta, que e alvo por conta de anuncio '
                    'e nao tem relacao com a meta de empresa. O investimento sai de '
                    'metricas_meta com nivel = campanha: somar os tres niveis triplica a '
                    'verba. O plano registra 1,61x para setembro usando a receita da '
                    'UTMify (R$ 217,1 mil); o banco mede R$ 210,5 mil e da 1,57x.'
 where chave = 'roas_medio';

update public.plano_regras
   set automatica = true, porque_nao = null
 where chave = 'lucro_dezembro';

commit;

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
  -- O ultimo mes FECHADO. Outubro so entra em novembro: um mes pela metade
  -- apareceria como despencada, e a meta e mensal.
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
  -- A unica definicao de lucro do projeto, lida de fn_resultado_mes.
  select 'lucro_liquido_mes'::text,
         (select round(x.sobrou_depois_das_retiradas, 2)
            from public.fn_resultado_mes(p_empresa) x, fechado f
           where x.mes = f.mes)
  union all
  select 'roas_medio'::text,
         (select round(sum(v.faturamento_bruto) / nullif(sum(v.investimento_meta), 0), 2)
            from public.vw_faturamento_liquido v, fechado f
           where date_trunc('month', v.data)::date = f.mes
             and (p_empresa is null or v.empresa_id = p_empresa));
$function$;

revoke all on function public.fn_metas_medir(uuid, date) from public, anon;
grant execute on function public.fn_metas_medir(uuid, date) to authenticated, service_role;

begin;
-- A linha de base MEDIDA dos dois. `valor_base` fica intacto guardando o que
-- o plano afirmou: -R$ 10 mil e 1,61x. E a distancia entre os dois que a
-- tela mostra em "o plano dizia X".
update public.metas m set valor_base_medido = (
    select round(x.sobrou_depois_das_retiradas, 2) from public.fn_resultado_mes(null) x
     where x.mes = date '2026-09-01')
 where m.kpi = 'lucro_liquido_mes';

update public.metas m set valor_base_medido = (
    select round(sum(v.faturamento_bruto) / nullif(sum(v.investimento_meta), 0), 2)
      from public.vw_faturamento_liquido v
     where date_trunc('month', v.data)::date = date '2026-09-01')
 where m.kpi = 'roas_medio';
commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := ''; v_lucro numeric; v_roas numeric; v_n bigint; v_base numeric;
begin
  select valor into v_lucro from public.fn_metas_medir(null) where kpi = 'lucro_liquido_mes';
  select valor into v_roas  from public.fn_metas_medir(null) where kpi = 'roas_medio';

  -- 1. Os dois saem medidos, e do mes FECHADO. A faixa do lucro e estreita de
  --    proposito: se a funcao passar a ler outubro, o numero vai para
  --    ~-12 mil e isto reprova.
  if v_lucro is null then v_erros := v_erros || 'lucro_liquido_mes voltou nulo. '; end if;
  if v_roas  is null then v_erros := v_erros || 'roas_medio voltou nulo. '; end if;
  if v_lucro is not null and abs(v_lucro - (-205.55)) > 2 then
    v_erros := v_erros || format('lucro deu %s; setembro e -205,55 e outubro seria ~-12 mil. ', v_lucro);
  end if;
  if v_roas is not null and (v_roas < 1.4 or v_roas > 1.8) then
    v_erros := v_erros || format('roas deu %s; setembro e ~1,57. ', v_roas);
  end if;

  -- 2. Sobram exatamente as tres manuais conhecidas, e sao essas tres.
  select count(*) into v_n from public.metas_kpi where e_meta and not automatico;
  if v_n <> 3 then
    v_erros := v_erros || format('%s metas manuais, esperava 3 (pix, alunas, bumps). ', v_n);
  end if;
  select count(*) into v_n from public.metas_kpi
   where e_meta and not automatico
     and chave not in ('pix_pendente_recuperado_pct','alunas_ativas_30d_pct','bumps_abertos_pct');
  if v_n > 0 then
    v_erros := v_erros || format('%s manual(is) inesperada(s). ', v_n);
  end if;

  -- 3. A base MEDIDA mudou e a base do PLANO nao. Sobrescrever a do plano
  --    apagaria a unica coisa que a tela tem para mostrar a diferenca.
  select distinct valor_base_medido into v_base from public.metas where kpi = 'lucro_liquido_mes';
  if v_base is null or abs(v_base - (-205.55)) > 2 then
    v_erros := v_erros || format('base medida do lucro deu %s. ', v_base);
  end if;
  select distinct valor_base into v_base from public.metas where kpi = 'lucro_liquido_mes';
  if v_base <> -10000 then
    v_erros := v_erros || 'a base do PLANO foi sobrescrita; ela tem de ficar para a tela comparar. ';
  end if;

  -- 4. A regra de dezembro deixou de ser manual, e nenhuma automatica ficou
  --    com motivo de manual orfao — a restricao so cobre o sentido inverso.
  if exists (select 1 from public.plano_regras where chave='lucro_dezembro' and not automatica) then
    v_erros := v_erros || 'a regra do lucro de dezembro continua manual. ';
  end if;
  select count(*) into v_n from public.plano_regras where automatica and porque_nao is not null;
  if v_n > 0 then
    v_erros := v_erros || format('%s regra(s) automaticas com motivo de manual sobrando. ', v_n);
  end if;

  if v_erros <> '' then raise exception 'PROVA FALHOU: %', v_erros; end if;

  raise notice 'PROVA OK: lucro do ultimo mes fechado %, roas %, % metas ainda manuais.',
    v_lucro, v_roas, (select count(*) from public.metas_kpi where e_meta and not automatico);
end $prova$;

notify pgrst, 'reload schema';
