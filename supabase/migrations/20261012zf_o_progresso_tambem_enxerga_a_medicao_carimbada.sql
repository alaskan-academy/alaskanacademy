-- O progresso tambem enxerga a medicao carimbada
-- ============================================================================
--
-- Ela perguntou: "ainda mostra sem medicao, esta correto?". Nao estava.
--
--     bumps_abertos_pct      medido 7,26   alvo 25   situacao: sem_medicao
--     retencao_30_60d_pct    medido 29,80  alvo 35   situacao: sem_medicao
--
-- O numero aparecia na tela e o selo ao lado dele dizia que nao havia
-- medicao. Os dois no mesmo pedaco de tela, contradizendo-se.
--
-- -- O conserto pela metade que eu fiz ------------------------------------
--
-- A 20261012zc fez `fn_plano_arvore` cair em `fn_metas_medir` quando o
-- progresso nao tinha valor, e a 20261012zd acrescentou `metas_medicao`. Mas
-- as duas mexeram so no campo `medido` da arvore.
--
-- `situacao`, `caminho` e `tempo` nao vem da arvore: vem de
-- `fn_metas_progresso`, que continuou lendo SO `fn_metas_medir`. Como os tres
-- indicadores da Area de Membros sao `automatico = false`, aquela funcao nao
-- os produz, o `medido` chegava nulo la dentro, e a primeira linha do CASE
-- fechava a conta:
--
--     when c.medido is null then 'sem_medicao'
--
-- Ou seja, eu remendei o sintoma na tela e deixei a causa no lugar. O valor
-- vinha de um caminho e o julgamento do valor vinha de outro.
--
-- -- Por que o conserto e aqui, e nao na arvore ----------------------------
--
-- Daria para a arvore montar `situacao` sozinha quando o progresso viesse
-- vazio. Seria a primeira armadilha do CLAUDE.md: duas implementacoes do
-- mesmo julgamento, e o limiar de 0,15 passaria a existir em dois lugares.
-- Ha teste que reprova exatamente isso (`metas-o-progresso-tem-um-dono-so`).
--
-- Progresso tem um dono so. Quem precisa enxergar a medicao carimbada e ele.
--
-- -- Um valor por indicador, decidido pela bandeira ------------------------
--
-- A CTE `medicao` passa a ter duas fontes, e elas nao podem se sobrepor —
-- senao um indicador com dois valores multiplicaria as linhas do join e a
-- meta apareceria duas vezes na tela.
--
-- A mesma regra do gatilho da `metas_medicao`, agora tambem na leitura:
--
--     automatico = true    fn_metas_medir manda
--     automatico = false   a tabela manda, a linha mais recente
--
-- Esta escrita como `distinct on (kpi)` com prioridade em vez de um `where`
-- em cada ramo: se um dia um indicador for calculado E carimbado, a funcao
-- escolhe um e segue, em vez de duplicar a linha em silencio.

create or replace function public.fn_metas_progresso(p_empresa uuid default null)
returns table(kpi text, nome text, unidade text, direcao text, automatico boolean,
              nota text, ordem integer, prazo date, valor_alvo numeric,
              valor_base numeric, base_real numeric, base_em date, medido numeric,
              caminho numeric, tempo numeric, atingido boolean, vencida boolean,
              e_proximo boolean, situacao text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with medicao as (
    /* Duas fontes, um valor. `prio` garante exatamente uma linha por
       indicador mesmo que as duas o cubram: o calculado ganha, e o carimbado
       entra para quem o banco nao calcula. Sem isto, indicador com dois
       valores duplicaria a meta na tela. */
    select distinct on (u.kpi) u.kpi, u.valor
      from (
        select x.kpi, x.valor, 1 as prio, null::date as quando
          from public.fn_metas_medir(p_empresa) x
        union all
        select m.kpi, m.valor, 2 as prio, m.medido_em
          from public.metas_medicao m
         where p_empresa is null
            or m.empresa_id is null
            or m.empresa_id = p_empresa
      ) u
     order by u.kpi, u.prio, u.quando desc nulls last
  ),
  bruto as (
    select
      m.kpi, k.nome, k.unidade::text as unidade, k.direcao::text as direcao,
      k.automatico, k.observacao as nota, k.ordem, m.prazo, m.valor_alvo,
      m.valor_base,
      coalesce(m.valor_base_medido, m.valor_base) as base_real,
      m.base_em, med.valor as medido,
      case
        when med.valor is null then null
        when k.direcao = 'piso' then med.valor >= m.valor_alvo
        else                         med.valor <= m.valor_alvo
      end as atingido,
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
    select b.*,
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

revoke all on function public.fn_metas_progresso(uuid) from public, anon;
grant execute on function public.fn_metas_progresso(uuid) to authenticated, service_role;

-- -- As provas ---------------------------------------------------------------
do $prova$
declare
  v_sem    int;
  v_linhas int;
  v_metas  int;
begin
  ---------------------------------------------------------------------------
  -- O defeito que ela viu: meta COM numero carimbado nao pode sair como
  -- "sem_medicao". Escrito como invariante, nao como lista de duas chaves.
  ---------------------------------------------------------------------------
  select count(*) into v_sem
    from fn_metas_progresso(null) p
   where p.situacao = 'sem_medicao'
     and exists (select 1 from metas_medicao m where m.kpi = p.kpi);
  if v_sem > 0 then
    raise exception '% metas tem medicao carimbada e continuam saindo como sem_medicao', v_sem;
  end if;

  ---------------------------------------------------------------------------
  -- E o contrario tambem: quem NAO tem medicao nenhuma continua dizendo isso.
  -- Sem esta, bastaria eu forcar 'no_caminho' em tudo para a prova acima
  -- passar.
  ---------------------------------------------------------------------------
  if exists (
    select 1 from fn_metas_progresso(null) p
     where p.medido is null and p.situacao <> 'sem_medicao'
  ) then
    raise exception 'meta sem medicao nenhuma saiu com situacao de verdade';
  end if;

  ---------------------------------------------------------------------------
  -- A duplicacao que o `prio` evita: uma linha por (kpi, prazo), nunca duas.
  -- Se as duas fontes cobrissem o mesmo indicador sem o distinct on, a meta
  -- apareceria repetida na arvore e ninguem veria o motivo.
  ---------------------------------------------------------------------------
  select count(*), count(distinct (kpi, prazo)) into v_linhas, v_metas
    from fn_metas_progresso(null);
  if v_linhas <> v_metas then
    raise exception 'fn_metas_progresso devolveu % linhas para % pares (kpi, prazo): ha indicador com dois valores',
                    v_linhas, v_metas;
  end if;

  ---------------------------------------------------------------------------
  -- E a arvore, que e o que a tela le, concorda com o progresso.
  ---------------------------------------------------------------------------
  if exists (
    select 1
      from fn_plano_arvore(null) t, lateral jsonb_array_elements(t.indicadores) i
     where (i->>'e_meta')::boolean
       and (i->>'medido') is not null
       and (i->>'situacao') = 'sem_medicao'
  ) then
    raise exception 'a arvore ainda mostra numero com selo de sem medicao';
  end if;

  raise notice 'nenhuma meta com numero sai mais como sem medicao';
end
$prova$;
