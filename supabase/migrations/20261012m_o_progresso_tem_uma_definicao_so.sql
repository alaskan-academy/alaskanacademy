-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O progresso tem uma definição só, e a linha de base passa a ser medida  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A migração anterior ligou os avisos e o primeiro deles saiu errado:
--
--   "Recompra em 90 dias: -130% do caminho com 2% do prazo"
--
-- Cento e trinta por cento para trás em dois dias. O número parecia estranho
-- e estava: a conta é (7,11 − 11) / (14 − 11), e o 11 é a linha de base que
-- o PLANO escreveu — que eu mesma já tinha provado errada. Os 11% do
-- documento são a recompra de todo o histórico; na janela de 90 dias são
-- 7,11%. O aviso não estava acusando queda, estava acusando a diferença
-- entre duas definições.
--
-- Medindo os cinco indicadores automáticos contra o que o plano afirmou:
--
--   Receita fora do tráfego   plano 11      medido 11,56   ✓
--   LTV médio                 plano 94      medido 93,04   ✓
--   Recompra em 90 dias       plano 11      medido  7,11   ✗ janela errada
--   Assinaturas ativas        plano 190     medido    90   ✗ status eterno
--   Base com WhatsApp         plano 25      medido 99,08   ✗ e por duas vezes
--
-- ── Duas colunas que NÃO são a mesma coisa ────────────────────────────────
--
-- `valor_base` fica como está: é o que o documento afirmou, e apagá-lo
-- perderia a informação mais útil que esta tela tem — a distância entre o
-- que se acreditava e o que era. A coluna nova, `valor_base_medido`, é outra
-- pergunta: quanto REALMENTE era no dia 10/10.
--
-- Isto não é a armadilha 1. Dois campos que se contradizem são doença
-- quando significam a mesma coisa; aqui um é a crença e o outro é o fato, e
-- a diferença entre eles é o conteúdo. O progresso passa a contar do fato.
--
-- ── O WhatsApp é 54,3 e não 99,08, e isso importa ─────────────────────────
--
-- Tentador gravar 99,08 como base medida, já que é o que a função devolve
-- hoje. Seria falso: em 10/10 a cobertura era 54,3%, e os 99,08% de agora
-- são consequência da importação de CPF e telefone que rodou em 12/10, dois
-- dias DEPOIS da linha de base. Gravar 99,08 faria a meta nascer com 0% de
-- caminho andado e esconderia justamente o que andou.
--
-- Com a base certa aparece o que o plano não sabia: a meta de dez/26 para
-- WhatsApp era 45% e a base real já era 54,3%. Essa meta estava batida
-- antes de ser escrita. A tela vai dizer isso em vez de desenhar uma barra.
--
-- ── Por que uma função de progresso, e não a conta na tela ────────────────
--
-- A conta de "quanto do caminho andou contra quanto do prazo passou" é
-- precisa em dois lugares: no aviso (SQL) e na tela (TypeScript). Escrita
-- duas vezes, diverge na primeira vez que alguém ajustar a folga de 15
-- pontos num lado só — e aí o painel mostra "no caminho" com um alerta
-- vermelho embaixo dizendo o contrário.
--
-- `fn_metas_progresso` passa a ser a única definição. A tela lê linhas
-- prontas e não faz aritmética; `fn_metas_alertas` lê a mesma função.
--
-- ── O caso que quebrava a conta ───────────────────────────────────────────
--
-- Quando o alvo está ABAIXO da base — o caso do WhatsApp — o denominador
-- (alvo − base) fica negativo e a fração inverte: o indicador em 99,08 com
-- alvo 45 saía como −481% de caminho andado. Por isso `caminho` é 1 sempre
-- que o alvo já está atingido, testado pela direção (piso ou teto), antes
-- de qualquer divisão.

begin;

alter table public.metas
  add column if not exists valor_base_medido numeric;

comment on column public.metas.valor_base_medido is
  'Quanto o indicador REALMENTE valia em base_em, medido no banco. Diferente '
  'de valor_base, que e o que o plano afirmou. Os dois coexistem porque a '
  'distancia entre eles e informacao, nao ruido. O progresso conta deste.';

-- Os cinco automaticos, medidos. Quatro valem o que fn_metas_medir devolve
-- hoje porque nada mudou entre 10/10 e agora; o WhatsApp vale 54,3 porque a
-- importacao de 12/10 veio depois da linha de base.
update public.metas set valor_base_medido = 11.56 where kpi = 'receita_fora_trafego_pct';
update public.metas set valor_base_medido = 93.04 where kpi = 'ltv_medio';
update public.metas set valor_base_medido =  7.11 where kpi = 'recompra_90d_pct';
update public.metas set valor_base_medido = 90    where kpi = 'assinaturas_ativas';
update public.metas set valor_base_medido = 54.30 where kpi = 'base_whatsapp_pct';

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- A definição única de progresso
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_metas_progresso(p_empresa uuid default null)
 returns table (
   kpi          text,
   nome         text,
   unidade      text,
   direcao      text,
   automatico   boolean,
   nota         text,
   ordem        integer,
   prazo        date,
   valor_alvo   numeric,
   valor_base   numeric,
   base_real    numeric,
   base_em      date,
   medido       numeric,
   caminho      numeric,
   tempo        numeric,
   atingido     boolean,
   vencida      boolean,
   e_proximo    boolean
 )
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with medicao as (
    select x.kpi, x.valor from public.fn_metas_medir(p_empresa) x
  ),
  bruto as (
    select
      m.kpi,
      k.nome,
      k.unidade::text,
      k.direcao::text,
      k.automatico,
      k.observacao as nota,
      k.ordem,
      m.prazo,
      m.valor_alvo,
      m.valor_base,
      -- A base que vale e a medida; na falta dela, a do plano.
      coalesce(m.valor_base_medido, m.valor_base) as base_real,
      m.base_em,
      med.valor as medido,
      -- Atingido testa a DIRECAO: piso quer >=, teto quer <=.
      case
        when med.valor is null then null
        when k.direcao = 'piso' then med.valor >= m.valor_alvo
        else                         med.valor <= m.valor_alvo
      end as atingido
    from public.metas m
    join public.metas_kpi k on k.chave = m.kpi
    left join medicao med on med.kpi = m.kpi
    where k.e_meta
  )
  select
    b.kpi, b.nome, b.unidade, b.direcao, b.automatico, b.nota, b.ordem,
    b.prazo, b.valor_alvo, b.valor_base, b.base_real, b.base_em, b.medido,
    -- Caminho andado, de 0 a 1. Um quando ja atingido — inclusive no caso em
    -- que o alvo esta ABAIXO da base real, que e onde a divisao invertia.
    case
      when b.medido is null or b.base_real is null then null
      when b.atingido                              then 1::numeric
      when b.valor_alvo = b.base_real              then 1::numeric
      else greatest(0::numeric,
                    (b.medido - b.base_real) / (b.valor_alvo - b.base_real))
    end as caminho,
    -- Prazo decorrido, de 0 a 1.
    case
      when b.prazo <= b.base_em then 1::numeric
      else least(1::numeric, greatest(0::numeric,
             (current_date - b.base_em)::numeric / (b.prazo - b.base_em)::numeric))
    end as tempo,
    coalesce(b.atingido, false) as atingido,
    (b.prazo < current_date and not coalesce(b.atingido, false)) as vencida,
    -- O proximo prazo de cada indicador e o unico que se cobra agora: cobrar
    -- jul/27 em outubro nao e atraso, e calendario. Quando TODOS ja venceram,
    -- o ultimo e que fica sendo o atual — senao o indicador sumiria da conta
    -- justamente depois de vencer, que e quando ele mais importa.
    coalesce(
      b.prazo = (select min(b2.prazo) from bruto b2
                  where b2.kpi = b.kpi and b2.prazo >= current_date),
      b.prazo = (select max(b3.prazo) from bruto b3 where b3.kpi = b.kpi)
    ) as e_proximo
  from bruto b
  order by b.ordem, b.prazo;
$function$;

comment on function public.fn_metas_progresso(uuid) is
  'Uma linha por meta com tudo que a tela e o aviso precisam, inclusive o '
  'progresso ja calculado. E a UNICA definicao de "quanto do caminho andou": '
  'a tela nao repete a conta e fn_metas_alertas le daqui.';

revoke all on function public.fn_metas_progresso(uuid) from public, anon;
grant execute on function public.fn_metas_progresso(uuid) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- O aviso passa a ler a definição única
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fn_metas_alertas(p_empresa uuid default null)
 returns table (codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select 'acao_vencida'::text,
         'critico'::text,
         count(*)::text || ' ação(ões) do plano venceram',
         string_agg(titulo || ' (' || to_char(prazo, 'DD/MM') || ')', ' · '
                    order by prazo)
    from public.plano_acoes
   where feito_em is null and prazo is not null and prazo < current_date
  having count(*) > 0

  union all

  select 'acao_vencendo'::text,
         'atencao'::text,
         count(*)::text || ' ação(ões) vencem nos próximos 7 dias',
         string_agg(titulo || ' (' || to_char(prazo, 'DD/MM') || ')', ' · '
                    order by prazo)
    from public.plano_acoes
   where feito_em is null and prazo is not null
     and prazo >= current_date and prazo <= current_date + 7
  having count(*) > 0

  union all

  select 'roas_duas_semanas'::text,
         'critico'::text,
         'ROAS de 14 dias em ' ||
           replace(to_char(sum(f.faturamento_bruto)
                           / nullif(sum(f.investimento_meta), 0), 'FM9.00'),
                   '.', ',') || 'x, abaixo de 1,50x',
         'Regra do plano: a verba volta ao nível de agosto até a oferta nova '
         'estar no ar. Receita ' || public.fn_brl(sum(f.faturamento_bruto)) ||
         ' e investimento ' || public.fn_brl(sum(f.investimento_meta)) ||
         ' entre ' || to_char(current_date - 14, 'DD/MM') || ' e ' ||
         to_char(current_date - 1, 'DD/MM') || '.'
    from public.vw_faturamento_liquido f
   where f.data >= current_date - 14
     and f.data <  current_date
     and (p_empresa is null or f.empresa_id = p_empresa)
  having sum(f.investimento_meta) > 0
     and sum(f.faturamento_bruto) / sum(f.investimento_meta) < 1.50

  union all

  -- Meta andando mais devagar que o relógio, lida da definição única.
  -- A folga de 15 pontos existe porque quase nada cresce em linha reta:
  -- régua de pós-venda e mini lançamento rendem em degrau, não por dia.
  select 'meta_atrasada'::text,
         'atencao'::text,
         count(*)::text || ' meta(s) andando mais devagar que o prazo',
         string_agg(nome || ': ' || round(caminho * 100) || '% do caminho com '
                    || round(tempo * 100) || '% do prazo', ' · '
                    order by (tempo - caminho) desc)
    from public.fn_metas_progresso(p_empresa)
   where automatico and e_proximo and not atingido
     and caminho is not null and tempo is not null
     and caminho < tempo - 0.15
  having count(*) > 0;
$function$;

revoke all on function public.fn_metas_alertas(uuid) from public, anon;
grant execute on function public.fn_metas_alertas(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  r       record;
begin
  -- 1. Trinta linhas: dez metas por tres prazos. O indicador de apoio fica
  --    de fora, que e o que e_meta faz.
  select count(*) into v_n from public.fn_metas_progresso(null);
  if v_n <> 30 then
    v_erros := v_erros || format('%s linhas de progresso, esperava 30. ', v_n);
  end if;

  -- 2. Caminho NUNCA sai do intervalo [0,1]. Era o defeito: -481% para o
  --    WhatsApp, cujo alvo de dezembro esta abaixo da base real.
  select count(*) into v_n from public.fn_metas_progresso(null)
   where caminho is not null and (caminho < 0 or caminho > 1);
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) com caminho fora de [0,1]. ', v_n);
  end if;
  select count(*) into v_n from public.fn_metas_progresso(null)
   where tempo is not null and (tempo < 0 or tempo > 1);
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) com tempo fora de [0,1]. ', v_n);
  end if;

  -- 3. O caso concreto que motivou tudo: WhatsApp em dez/26 ja esta atingido,
  --    porque a base real (54,3) ja passava do alvo (45).
  select * into r from public.fn_metas_progresso(null)
   where kpi = 'base_whatsapp_pct' and prazo = '2026-12-31';
  if not found then
    v_erros := v_erros || 'nao achei a meta de WhatsApp para dez/26. ';
  elsif not r.atingido then
    v_erros := v_erros || format('WhatsApp dez/26 deveria estar atingido (medido %s, alvo %s). ',
                                 r.medido, r.valor_alvo);
  elsif r.caminho <> 1 then
    v_erros := v_erros || format('WhatsApp dez/26 atingido mas caminho = %s. ', r.caminho);
  end if;

  -- 4. E o aviso que estava errado parou de disparar. A recompra nao andou
  --    para tras: ela estava sendo medida contra a definicao errada.
  select count(*) into v_n from public.fn_metas_alertas(null)
   where codigo = 'meta_atrasada' and detalhe like '%-1%';
  if v_n > 0 then
    v_erros := v_erros || 'ainda existe aviso de meta com caminho negativo. ';
  end if;

  -- 5. Toda meta automatica ganhou base medida. Sem isso o conserto so vale
  --    para as cinco de hoje e a sexta nasce com o mesmo defeito.
  select count(*) into v_n from public.metas m
   join public.metas_kpi k on k.chave = m.kpi
   where k.automatico and k.e_meta and m.valor_base_medido is null;
  if v_n > 0 then
    v_erros := v_erros || format('%s meta(s) automaticas sem base medida. ', v_n);
  end if;

  -- 6. Cada indicador tem exatamente um proximo prazo.
  select count(*) into v_n from (
    select kpi, count(*) filter (where e_proximo) as n
      from public.fn_metas_progresso(null) group by kpi
  ) q where n <> 1;
  if v_n > 0 then
    v_erros := v_erros || format('%s indicador(es) sem exatamente um proximo prazo. ', v_n);
  end if;

  -- 7. Nao ficou aberta.
  if has_function_privilege('anon', 'public.fn_metas_progresso(uuid)', 'execute') then
    v_erros := v_erros || 'anon consegue executar fn_metas_progresso. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % linhas, % ja atingidas, % avisos.',
    (select count(*) from public.fn_metas_progresso(null)),
    (select count(*) from public.fn_metas_progresso(null) where atingido),
    (select count(*) from public.fn_metas_alertas(null));
end $prova$;

notify pgrst, 'reload schema';
