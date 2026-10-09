-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A régua passa a valer a cada hora                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠ ESTA MIGRAÇÃO ESPERA O DEPLOY DO CÓDIGO. Ela é a única das seis que não é
--   inocente: a partir dela a régua começa a ESCREVER em `producoes.avaliacao`
--   de hora em hora. Aplicá-la antes de o front que lê `avaliacao_origem` estar
--   em produção faria valores aparecerem sem o selo que explica de onde vieram —
--   e a tela antiga mostraria avaliação de máquina com cara de digitada, que é
--   exatamente o problema que este trabalho existe para resolver.
--
--   Ordem: deploy do código → confirmar a tela → esta migração.
--
-- ── Por que o cron, e não um gatilho nos números ─────────────────────────
--
-- A quarta armadilha diz que todo espelho precisa de gatilho, não de carga
-- inicial. Este tem — só não é um gatilho de linha, e o motivo é que **a
-- avaliação não pode ser mais fresca que as entradas dela**:
--
--   `meta-sync-horario`   '0 * * * *'   traz investimento e impressões
--   `atribuicao-horaria`  '10 * * * *'  resolve o vínculo anúncio↔card
--
-- Sem vínculo não há ROAS, e sem investimento não há veredito. Reavaliar às
-- `:10`, logo DEPOIS de `fn_fixar_vinculo_ads`, garante que a avaliação nunca
-- está mais velha que o dado que a produz. Pôr a função ANTES do vínculo faria
-- o card de um anúncio novo esperar uma hora a mais por nada.
--
-- E um gatilho `for each row` em `metricas_meta` seria pior em dois sentidos: o
-- sync entra em lote de milhares de linhas, e um erro na avaliação passaria a
-- derrubar a transação que grava o dado de MÍDIA — o caminho do dinheiro.
--
-- ── O gatilho que existe, e por que ele é barato ─────────────────────────
--
-- `trg_avaliar_card_novo` roda quando um card entra em `fase='postado'`, e só
-- grava "sem verba" sem olhar `metricas_meta` uma única vez. Pode fazer isso
-- porque a resposta é determinística: `fn_fixar_vinculo_ads` é a ÚNICA coisa que
-- escreve em `producao_ads` e roda depois, logo um card recém-postado não tem
-- vínculo por construção. A passada horária corrige quando dinheiro aparecer.
--
-- Isto está escrito no corpo do gatilho de propósito: sem o aviso, alguém
-- "melhora" a função chamando `vw_criativo_avaliacao_sugerida` e põe segundos de
-- `fn_criativos_metricas` dentro do UPDATE dela.
--
-- ── O que o gatilho NÃO faz: ressuscitar card antigo ─────────────────────
--
-- Ele só age quando `avaliacao_origem` está NULA. Card que já levou selo em
-- `20261009b` — os 3.860 que já estavam postados ou arquivados — fica de fora
-- mesmo se alguém mudar a fase dele para `postado` outra vez. "Só os novos" é
-- sobre cards que entram na avaliação a partir de agora, não sobre cards que
-- voltam a passar pela porta.

begin;

create or replace function public.trg_avaliar_card_novo()
  returns trigger
  language plpgsql
  security invoker
  set search_path to 'public'
as $fn$
declare
  v_crivo record;
begin
  -- Fora do escopo: a régua não opina sobre quem já tem procedência.
  if new.avaliacao_origem is not null then
    return new;
  end if;
  if new.tipo <> 'criativo' then
    return new;
  end if;

  select c.id, c.nivel_sem_verba into v_crivo from public.vw_crivo_vigente c;
  if v_crivo.id is null then
    -- Sem régua configurada não se inventa veredito. `fn_alerta_avaliacao_parada`
    -- acusa o card sem sugestão, e é o caminho certo: ficar em branco e
    -- reclamar é melhor que preencher por engano.
    return new;
  end if;

  /* NÃO consultar `vw_criativo_avaliacao_sugerida` aqui.

     Ela chama `fn_criativos_metricas`, que varre a vida inteira de todos os
     anúncios — segundos. Isto roda dentro do UPDATE de quem arrastou um card
     para "postado", e a resposta neste instante é conhecida sem consultar nada:
     o card não tem vínculo em `producao_ads` (só `fn_fixar_vinculo_ads` escreve
     lá, e ela roda às :10), logo não tem verba, logo é "sem verba". A passada
     horária reavalia quando o dinheiro aparecer. */
  new.avaliacao        := v_crivo.nivel_sem_verba;
  new.avaliacao_origem := 'automatico';

  insert into public.avaliacao_sugerida
    (producao_id, sugestao, motivo, crivo_versao_id, no_escopo)
  values (new.id, v_crivo.nivel_sem_verba,
          'card recém-postado: ainda sem verba para julgar', v_crivo.id, true)
  on conflict (producao_id) do update
    set sugestao        = excluded.sugestao,
        motivo          = excluded.motivo,
        crivo_versao_id = excluded.crivo_versao_id,
        no_escopo       = excluded.no_escopo,
        decidido_em     = now();

  insert into public.avaliacao_automatica_log (producao_id, de, para, motivo, versao_id)
  values (new.id, old.avaliacao, v_crivo.nivel_sem_verba,
          'card recém-postado: ainda sem verba para julgar', v_crivo.id);

  return new;
end $fn$;

comment on function public.trg_avaliar_card_novo() is
  'Dá veredito inicial ao card que acaba de ser postado, sem ler metricas_meta: '
  'ele não tem vínculo por construção (fn_fixar_vinculo_ads roda depois), então '
  'a resposta é "sem verba". NÃO chamar a view da régua aqui — ela custa '
  'segundos e isto roda dentro do UPDATE da tela.';

drop trigger if exists trg_producoes_avaliar_card_novo on public.producoes;
create trigger trg_producoes_avaliar_card_novo
  before update of fase on public.producoes
  for each row
  when (new.fase = 'postado' and old.fase is distinct from 'postado')
  execute function public.trg_avaliar_card_novo();

commit;

-- ---------------------------------------------------------------------------
-- O agendamento
-- ---------------------------------------------------------------------------
-- `cron.schedule` com nome existente SUBSTITUI o agendamento, então isto é
-- idempotente. As três funções que já estavam continuam, na mesma ordem, e a
-- avaliação entra por ÚLTIMO — depois do vínculo, que é a entrada de que ela
-- depende.
select cron.schedule('atribuicao-horaria', '10 * * * *', $cmd$
    SELECT fn_resolver_conta_das_vendas();
    SELECT fn_herdar_origem_do_upsell();
    SELECT fn_fixar_vinculo_ads();
    SELECT fn_avaliar_criativos();
  $cmd$);

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_cmd   text;
  v_n     integer;
  v_corpo text;
begin
  -- 1. O agendamento existe, e a avaliação vem DEPOIS do vínculo.
  select command into v_cmd from cron.job where jobname = 'atribuicao-horaria';
  if v_cmd is null then
    v_erros := v_erros || 'o job atribuicao-horaria não existe. ';
  else
    if v_cmd not like '%fn_avaliar_criativos%' then
      v_erros := v_erros || 'o job não chama fn_avaliar_criativos. ';
    elsif position('fn_fixar_vinculo_ads' in v_cmd) > position('fn_avaliar_criativos' in v_cmd) then
      v_erros := v_erros || 'a avaliacao roda ANTES do vinculo: o card de um anuncio novo esperaria uma hora a mais. ';
    end if;
    -- As três que já estavam continuam.
    for v_corpo in select unnest(array['fn_resolver_conta_das_vendas',
                                       'fn_herdar_origem_do_upsell',
                                       'fn_fixar_vinculo_ads'])
    loop
      if v_cmd not like '%' || v_corpo || '%' then
        v_erros := v_erros || format('o job perdeu %s. ', v_corpo);
      end if;
    end loop;
  end if;

  -- 2. O gatilho existe, e na transição certa.
  select count(*) into v_n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where c.relname = 'producoes'
     and t.tgname = 'trg_producoes_avaliar_card_novo'
     and not t.tgisinternal;
  if v_n <> 1 then
    v_erros := v_erros || 'o gatilho do card novo nao esta em producoes. ';
  end if;

  -- 3. O corpo do gatilho NÃO chama a view pesada nem fn_criativos_metricas.
  --    Se chamar, cada card arrastado para "postado" passa a custar segundos.
  select pg_get_functiondef(p.oid) into v_corpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_avaliar_card_novo';
  v_corpo := regexp_replace(v_corpo, '--[^\n]*', ' ', 'g');
  v_corpo := regexp_replace(v_corpo, '/\*.*?\*/', ' ', 'gs');
  if v_corpo like '%vw_criativo_avaliacao_sugerida%' then
    v_erros := v_erros || 'o gatilho passou a consultar a view pesada da regua. ';
  end if;
  if v_corpo like '%fn_criativos_metricas%' then
    v_erros := v_erros || 'o gatilho passou a consultar fn_criativos_metricas. ';
  end if;

  -- 4. E ele respeita o escopo: só age em origem nula.
  if v_corpo not like '%avaliacao_origem is not null%' then
    v_erros := v_erros || 'o gatilho nao verifica se o card ja tem procedencia. ';
  end if;

  -- 5. Nenhum card 'humano' ou 'fora_do_escopo' mudou de valor.
  select count(*) into v_n from public.producoes p
    join public.avaliacao_automatica_log l on l.producao_id = p.id
   where p.avaliacao_origem in ('humano', 'fora_do_escopo');
  if v_n <> 0 then
    v_erros := v_erros || format('%s card(s) fora do escopo tem linha no log da maquina. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: a regua entrou no cron das :10 depois do vinculo, o gatilho do card novo esta em producoes e nao consulta a view pesada, e nenhum card fora do escopo foi tocado.';
end $prova$;

notify pgrst, 'reload schema';
