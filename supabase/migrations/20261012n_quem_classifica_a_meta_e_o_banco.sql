-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Quem classifica a meta é o banco, não a tela                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `fn_metas_progresso` devolve `caminho` e `tempo`, e a tela ia transformar
-- os dois em "no caminho" ou "atrasada" comparando com a folga de 15 pontos.
-- Só que `fn_metas_alertas` compara com a MESMA folga, do lado do SQL.
--
-- São dois lugares decidindo a mesma coisa, que é a primeira armadilha do
-- CLAUDE.md escrita com outras palavras. O dia em que alguém achar 15 pontos
-- demais e ajustar num lado só, a tela mostra "no caminho" com um aviso
-- vermelho embaixo dizendo que está atrasada — e não há como saber qual dos
-- dois mente.
--
-- `situacao` passa a sair pronta do banco, e o 0,15 existe uma vez.
--
-- ── Cinco situações, não quatro ───────────────────────────────────────────
--
-- A quinta é `ja_estava_batida`, e ela existe por causa de um caso real: a
-- meta de WhatsApp para dez/26 é 45% e a base verdadeira em 10/10 já era
-- 54,3%. Chamar isso de "batida" junto com as outras esconderia que não
-- houve conquista nenhuma — o alvo nasceu abaixo do chão, porque o plano
-- acreditava que a base era 25%.
--
-- É a mesma informação que o painel já dá em "o plano dizia X", agora na
-- forma de estado: dá para olhar a tela e ver quantas metas do ano já
-- estavam ganhas no dia em que foram escritas.

-- `create or replace` nao serve aqui: a funcao ganha uma coluna, e o Postgres
-- recusa mudar o tipo de retorno de uma funcao existente. Derrubar e recriar
-- apaga os grants junto, por isso eles sao reemitidos logo abaixo.
drop function if exists public.fn_metas_progresso(uuid);

create function public.fn_metas_progresso(p_empresa uuid default null)
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
   e_proximo    boolean,
   situacao     text
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
      k.unidade::text as unidade,
      k.direcao::text as direcao,
      k.automatico,
      k.observacao as nota,
      k.ordem,
      m.prazo,
      m.valor_alvo,
      m.valor_base,
      coalesce(m.valor_base_medido, m.valor_base) as base_real,
      m.base_em,
      med.valor as medido,
      case
        when med.valor is null then null
        when k.direcao = 'piso' then med.valor >= m.valor_alvo
        else                         med.valor <= m.valor_alvo
      end as atingido,
      -- O alvo ja estava satisfeito pela base real, antes de qualquer
      -- trabalho. Testado pela direcao, igual ao atingido.
      case
        when coalesce(m.valor_base_medido, m.valor_base) is null then false
        when k.direcao = 'piso'
          then coalesce(m.valor_base_medido, m.valor_base) >= m.valor_alvo
        else   coalesce(m.valor_base_medido, m.valor_base) <= m.valor_alvo
      end as nasceu_batida
    from public.metas m
    join public.metas_kpi k on k.chave = m.kpi
    left join medicao med on med.kpi = m.kpi
    where k.e_meta
  ),
  contas as (
    select
      b.*,
      case
        when b.medido is null or b.base_real is null then null
        when b.atingido                              then 1::numeric
        when b.valor_alvo = b.base_real              then 1::numeric
        else greatest(0::numeric,
                      (b.medido - b.base_real) / (b.valor_alvo - b.base_real))
      end as caminho,
      case
        when b.prazo <= b.base_em then 1::numeric
        else least(1::numeric, greatest(0::numeric,
               (current_date - b.base_em)::numeric / (b.prazo - b.base_em)::numeric))
      end as tempo
    from bruto b
  )
  select
    c.kpi, c.nome, c.unidade, c.direcao, c.automatico, c.nota, c.ordem,
    c.prazo, c.valor_alvo, c.valor_base, c.base_real, c.base_em, c.medido,
    c.caminho, c.tempo,
    coalesce(c.atingido, false) as atingido,
    (c.prazo < current_date and not coalesce(c.atingido, false)) as vencida,
    coalesce(
      c.prazo = (select min(c2.prazo) from contas c2
                  where c2.kpi = c.kpi and c2.prazo >= current_date),
      c.prazo = (select max(c3.prazo) from contas c3 where c3.kpi = c.kpi)
    ) as e_proximo,
    -- A classificacao, numa definicao so. A folga de 0,15 mora AQUI e em
    -- lugar nenhum mais: fn_metas_alertas le esta coluna.
    case
      when c.medido is null                      then 'sem_medicao'
      when c.atingido and c.nasceu_batida        then 'ja_estava_batida'
      when c.atingido                            then 'batida'
      when c.caminho is null or c.tempo is null  then 'sem_medicao'
      when c.caminho >= c.tempo - 0.15           then 'no_caminho'
      else                                            'atrasada'
    end as situacao
  from contas c
  order by c.ordem, c.prazo;
$function$;

comment on function public.fn_metas_progresso(uuid) is
  'Uma linha por meta com progresso e SITUACAO ja calculados. E a unica '
  'definicao de "quanto do caminho andou" e de "esta atrasada": a tela nao '
  'repete a conta e fn_metas_alertas le a mesma coluna.';

revoke all on function public.fn_metas_progresso(uuid) from public, anon;
grant execute on function public.fn_metas_progresso(uuid) to authenticated, service_role;

-- O aviso para de recalcular o limiar e passa a ler a situação.
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

  select 'meta_atrasada'::text,
         'atencao'::text,
         count(*)::text || ' meta(s) andando mais devagar que o prazo',
         string_agg(nome || ': ' || round(caminho * 100) || '% do caminho com '
                    || round(tempo * 100) || '% do prazo', ' · '
                    order by (tempo - caminho) desc)
    from public.fn_metas_progresso(p_empresa)
   where e_proximo and situacao = 'atrasada'
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
  v_sit   text;
begin
  -- 1. Toda linha tem situacao, e so as cinco previstas existem.
  select count(*) into v_n from public.fn_metas_progresso(null) where situacao is null;
  if v_n > 0 then v_erros := v_erros || format('%s linha(s) sem situacao. ', v_n); end if;

  select count(*) into v_n from public.fn_metas_progresso(null)
   where situacao not in ('sem_medicao','ja_estava_batida','batida','no_caminho','atrasada');
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) com situacao fora do conjunto. ', v_n);
  end if;

  -- 2. O caso que criou a quinta situacao: WhatsApp em dez/26 nasceu batida,
  --    porque a base real (54,3) ja passava do alvo (45).
  select situacao into v_sit from public.fn_metas_progresso(null)
   where kpi = 'base_whatsapp_pct' and prazo = '2026-12-31';
  if v_sit is distinct from 'ja_estava_batida' then
    v_erros := v_erros || format('WhatsApp dez/26 deu "%s", esperava "ja_estava_batida". ', v_sit);
  end if;

  -- 3. ...e a de jul/27 NAO nasceu batida: o alvo e 70 e a base era 54,3.
  --    Se as duas dessem o mesmo, a distincao seria decorativa.
  select situacao into v_sit from public.fn_metas_progresso(null)
   where kpi = 'base_whatsapp_pct' and prazo = '2027-07-31';
  if v_sit <> 'batida' then
    v_erros := v_erros || format('WhatsApp jul/27 deu "%s", esperava "batida". ', v_sit);
  end if;

  -- 4. Situacao e coerente com atingido, nos dois sentidos.
  select count(*) into v_n from public.fn_metas_progresso(null)
   where atingido and situacao not in ('batida','ja_estava_batida');
  if v_n > 0 then v_erros := v_erros || format('%s linha(s) atingidas com situacao errada. ', v_n); end if;
  select count(*) into v_n from public.fn_metas_progresso(null)
   where not atingido and situacao in ('batida','ja_estava_batida');
  if v_n > 0 then v_erros := v_erros || format('%s linha(s) nao atingidas marcadas como batidas. ', v_n); end if;

  -- 5. O limiar de 0,15 nao sobrou escrito no aviso: ele le a coluna.
  if pg_get_functiondef('public.fn_metas_alertas(uuid)'::regprocedure) like '%0.15%' then
    v_erros := v_erros || 'fn_metas_alertas ainda tem o limiar escrito dentro. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % sem medicao, % ja estavam batidas, % batidas, % no caminho, % atrasadas.',
    (select count(*) from public.fn_metas_progresso(null) where situacao='sem_medicao'),
    (select count(*) from public.fn_metas_progresso(null) where situacao='ja_estava_batida'),
    (select count(*) from public.fn_metas_progresso(null) where situacao='batida'),
    (select count(*) from public.fn_metas_progresso(null) where situacao='no_caminho'),
    (select count(*) from public.fn_metas_progresso(null) where situacao='atrasada');
end $prova$;

notify pgrst, 'reload schema';
