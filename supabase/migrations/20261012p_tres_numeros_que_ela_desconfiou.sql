-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Três números de que ela desconfiou, e o que a conferência achou         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- "Quando um número parecer estranho, ele provavelmente está." Ela olhou a
-- tela de Metas e desconfiou de três. Um estava errado, um estava certo, e o
-- terceiro escondia outra coisa.
--
-- ── 1. "Está considerando os sem UTM também? Deixaria eles de fora" ───────
--
-- Estava. `receita_fora_trafego_pct` media `not eh_trafego`, e `eh_trafego` é
-- `ad_id_meta is not null or trafego_pago`. Tudo que não estava MARCADO como
-- tráfego contava como receita própria — inclusive a venda sem UTM nenhum,
-- que é de origem desconhecida e não de canal próprio.
--
-- O documento faz essa separação de propósito, em duas linhas da mesma
-- tabela: "Total identificado 23,0 (11%)" e, embaixo, "Sem UTM (origem
-- desconhecida) 24,6". E diz por quê: "parte dele ainda é canal próprio sem
-- marcação" — parte, não tudo.
--
-- Medido nos últimos 30 dias, sobre R$ 201.210 de receita aprovada:
--
--     tráfego pago                 R$ 177.953
--     fora do tráfego, COM UTM     R$  18.430   →  9,16%
--     sem UTM nenhum               R$   4.827   →  2,40%
--
-- O indicador cai de 11,56% para 9,16%, e isso muda a leitura: o alvo de
-- dez/26 é 12%, que parecia a um passo e está a quase três pontos.
--
-- O sem-UTM não some da tela — vira indicador de apoio próprio. Ele é a
-- medida do ganho rápido "UTM em todos os links próprios", e some sozinho
-- quando aquela ação for feita.
--
-- ── 2. "LTV não é valor, é? achava que era quantas vezes a pessoa compra" ─
--
-- É valor, e a conferência fechou em três números independentes do próprio
-- plano, o que é raro:
--
--     média    R$ 93,04   o plano diz R$ 94
--     mediana  R$ 67,00   o plano diz R$ 68
--     pessoas      10.462  o plano diz "10,4 mil clientes"
--
-- Três de três. O cálculo está certo e mede o que o plano chama de LTV.
--
-- Mas a pergunta dela aponta para algo que FALTAVA: "quantas vezes a pessoa
-- compra" é a FREQUÊNCIA, e ela não estava em lugar nenhum. As duas se
-- multiplicam — ticket × frequência = LTV —, e isso importa porque o alvo de
-- R$ 150 em jul/27 pode vir de ticket maior ou de mais recompra, que são
-- trabalhos completamente diferentes. Hoje a frequência é 1,169.
--
-- ── 3. "são anuais estas, certo, temos que cuidar com isso" ───────────────
--
-- São: 83 das 90 ativas têm ciclo de 365 dias. E cuidar era mesmo preciso,
-- porque a conferência achou outra coisa — oito das noventa estão com o
-- próximo ciclo VENCIDO, seis delas há mais de 30 dias:
--
--     2 renovaram (há venda aprovada na data do ciclo) e só a data ficou
--       velha — a assinatura está viva
--     6 não têm venda nenhuma depois do ciclo, e 5 dessas nunca tiveram
--       venda aprovada
--
-- NÃO mexo no status. Já mexi uma vez hoje (`20261012i`) e quase matei 11
-- anuais por ler `max(data_proximo_ciclo)` sem notar que `max()` ignora
-- nulo. Status de assinatura é dinheiro de terceiro, e seis linhas ambíguas
-- não justificam um UPDATE em massa. Vira aviso: o painel conta, e ela
-- decide uma a uma.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- Os dois indicadores novos
-- ───────────────────────────────────────────────────────────────────────────
insert into public.metas_kpi (chave, nome, unidade, direcao, automatico, observacao, ordem, e_meta) values
  ('compras_por_pessoa', 'Compras por pessoa', 'numero', 'piso', true,
   'Quantas compras cada pessoa fez, agrupando por CPF. Nao e o LTV: LTV e '
   'VALOR (R$ 93,04) e isto e FREQUENCIA (1,169). Os dois se multiplicam, e '
   'separa-los diz se o LTV subiu por ticket ou por recompra — trabalhos '
   'diferentes. Indicador de apoio: o plano nao da alvo para ele.',
   45, false),

  ('receita_sem_utm_pct', 'Receita sem UTM', 'percentual', 'teto', true,
   'Fatia da receita de 30 dias que nao veio de anuncio E nao tem utm_source '
   'nenhum — origem desconhecida. O plano lista isto numa linha separada do '
   '"total identificado", e e a medida do ganho rapido "UTM em todos os '
   'links proprios". Indicador de apoio, e quanto menor melhor.',
   35, false)
on conflict (chave) do update set
  nome = excluded.nome, observacao = excluded.observacao,
  unidade = excluded.unidade, direcao = excluded.direcao,
  automatico = excluded.automatico, ordem = excluded.ordem, e_meta = excluded.e_meta;

-- A nota do indicador que mudou de definição tem de contar a mudança, senão
-- quem comparar com um print antigo vai achar que a receita caiu.
update public.metas_kpi
   set observacao = 'Fatia da receita aprovada dos ultimos 30 dias que veio de canal '
                    'proprio IDENTIFICADO: nao e trafego pago E tem utm_source. '
                    'Ate 12/10 contava tambem a venda sem UTM nenhum e dava 11,56%; '
                    'o plano separa as duas coisas, e so o identificado conta.'
 where chave = 'receita_fora_trafego_pct';

update public.metas_kpi
   set observacao = 'Receita aprovada dividida por PESSOA, agrupando por CPF. E VALOR, '
                    'nao numero de compras — conferido contra o plano em tres numeros: '
                    'media R$ 93,04 (plano R$ 94), mediana R$ 67,00 (plano R$ 68) e '
                    '10.462 pessoas (plano "10,4 mil"). A frequencia esta em '
                    'compras_por_pessoa.'
 where chave = 'ltv_medio';

-- A linha de base muda junto com a definição. 9,16 e não 11,56.
update public.metas set valor_base_medido = 9.16 where kpi = 'receita_fora_trafego_pct';

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- A medição
-- ───────────────────────────────────────────────────────────────────────────
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
           -- Tem origem marcada? A venda sem utm_source nao e canal proprio:
           -- e origem desconhecida, e o plano as separa em duas linhas.
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
  -- So o canal proprio IDENTIFICADO. Sem o `tem_utm`, a venda de origem
  -- desconhecida entrava aqui e inflava o indicador em 2,4 pontos.
  select 'receita_fora_trafego_pct'::text,
         (select round(100.0 * sum(valor) filter (where not eh_trafego and tem_utm)
                       / nullif(sum(valor), 0), 2)
            from vendas_ok where data_venda >= (p_ref - 30))
  union all
  select 'receita_sem_utm_pct'::text,
         (select round(100.0 * sum(valor) filter (where not eh_trafego and not tem_utm)
                       / nullif(sum(valor), 0), 2)
            from vendas_ok where data_venda >= (p_ref - 30));
$function$;

revoke all on function public.fn_metas_medir(uuid, date) from public, anon;
grant execute on function public.fn_metas_medir(uuid, date) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- O aviso das assinaturas com ciclo vencido
-- ───────────────────────────────────────────────────────────────────────────
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
  having count(*) > 0

  union all

  -- Assinatura marcada como ativa cujo proximo ciclo ja passou. O painel
  -- CONTA e nao conserta: status de assinatura e dinheiro de terceiro, e a
  -- ultima vez que um UPDATE em massa mexeu nisso quase matou 11 anuais.
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

revoke all on function public.fn_metas_alertas(uuid) from public, anon;
grant execute on function public.fn_metas_alertas(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros  text := '';
  v_n      bigint;
  v_fora   numeric;
  v_sem    numeric;
  v_ltv    numeric;
  v_freq   numeric;
begin
  select valor into v_fora from public.fn_metas_medir(null) where kpi = 'receita_fora_trafego_pct';
  select valor into v_sem  from public.fn_metas_medir(null) where kpi = 'receita_sem_utm_pct';
  select valor into v_ltv  from public.fn_metas_medir(null) where kpi = 'ltv_medio';
  select valor into v_freq from public.fn_metas_medir(null) where kpi = 'compras_por_pessoa';

  -- 1. O conserto aconteceu: o indicador caiu para perto de 9,16 e o sem-UTM
  --    apareceu com os ~2,4 pontos que estavam escondidos dentro dele.
  if v_fora is null or v_fora > 10 then
    v_erros := v_erros || format('receita_fora_trafego deu %s; esperava ~9,16 depois de tirar o sem-UTM. ', v_fora);
  end if;
  if v_sem is null or v_sem < 1 or v_sem > 5 then
    v_erros := v_erros || format('receita_sem_utm deu %s; esperava ~2,4. ', v_sem);
  end if;

  -- 2. E as duas somadas tem de dar o numero ANTIGO. Se nao der, eu nao
  --    separei o mesmo bolo em dois: perdi ou inventei receita.
  if abs((v_fora + v_sem) - 11.56) > 0.1 then
    v_erros := v_erros || format('fora (%s) + sem UTM (%s) = %s, esperava os 11,56 de antes. ',
                                 v_fora, v_sem, v_fora + v_sem);
  end if;

  -- 3. O LTV nao se mexeu: a pergunta dela era de definicao, nao de defeito.
  if abs(v_ltv - 93.04) > 0.5 then
    v_erros := v_erros || format('ltv_medio deu %s, esperava 93,04 (inalterado). ', v_ltv);
  end if;

  -- 4. A frequencia existe e e um numero de compras, nao de reais. Se alguem
  --    trocar a conta por soma de valor, isto passa de 10 na hora.
  if v_freq is null or v_freq < 1 or v_freq > 10 then
    v_erros := v_erros || format('compras_por_pessoa deu %s; frequencia tem de ser ~1,17. ', v_freq);
  end if;

  -- 5. Os dois indicadores novos sao de APOIO: nao podem virar meta sem alvo,
  --    que era o defeito que `e_meta` veio consertar.
  select count(*) into v_n from public.metas_kpi
   where chave in ('compras_por_pessoa','receita_sem_utm_pct') and e_meta;
  if v_n > 0 then
    v_erros := v_erros || format('%s indicador(es) de apoio marcados como meta. ', v_n);
  end if;
  select count(*) into v_n from public.metas_kpi where e_meta;
  if v_n <> 10 then
    v_erros := v_erros || format('%s metas, esperava continuar em 10. ', v_n);
  end if;

  -- 6. O aviso das assinaturas dispara e bate com a contagem na mao.
  select count(*) into v_n from public.assinaturas
   where status = 'ativa' and data_proximo_ciclo is not null and data_proximo_ciclo < current_date;
  if v_n > 0 and not exists (
       select 1 from public.fn_metas_alertas(null) where codigo = 'assinatura_ciclo_vencido') then
    v_erros := v_erros || format('%s assinaturas com ciclo vencido mas o aviso nao disparou. ', v_n);
  end if;
  if v_n = 0 and exists (
       select 1 from public.fn_metas_alertas(null) where codigo = 'assinatura_ciclo_vencido') then
    v_erros := v_erros || 'nenhuma assinatura vencida mas o aviso disparou. ';
  end if;

  -- 7. Nenhum status de assinatura foi tocado. A prova existe porque a
  --    tentacao era grande e o estrago da ultima vez foi perto.
  select count(*) into v_n from public.assinaturas where status = 'ativa';
  if v_n <> 90 then
    v_erros := v_erros || format('%s assinaturas ativas, esperava as mesmas 90: esta migracao NAO mexe em status. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: fora do trafego %%, sem UTM %% (somam %%), LTV R$ %, frequencia %, % avisos.',
    v_fora, v_sem, v_fora + v_sem, v_ltv, v_freq,
    (select count(*) from public.fn_metas_alertas(null));
end $prova$;

notify pgrst, 'reload schema';
