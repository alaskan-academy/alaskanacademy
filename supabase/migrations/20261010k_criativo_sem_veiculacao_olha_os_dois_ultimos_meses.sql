-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Criativo sem veiculação olha os dois últimos meses                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Decidido por ela em 10/10/2026: *"se forem antigos (mais de dois meses
-- atrás) desconsidere; quero considerar apenas os ADs após o uso do dash"*.
--
-- São dois critérios, e um resolve o outro. O painel começou a ser usado em
-- **29/07/2026** — a primeira alteração registrada em `criativo_historico`, que
-- é a primeira vez que alguém mexeu em alguma coisa PELA TELA. Dois meses
-- atrás, hoje, é 09/08. A janela móvel já cai depois do início do uso, e vai
-- continuar caindo conforme o tempo passa: um corte só, e que não envelhece.
--
-- ── A data que sai daqui estava envelhecendo em silêncio ────────────────
--
-- A view trazia `data_inicio >= '2026-05-01'` escrito à mão. E esse 01/05 não é
-- o início do uso do painel: é a **primeira métrica que o Meta mandou**, ou
-- seja, a data do import. Dois significados diferentes no mesmo número — e o
-- número ficaria parado enquanto a operação anda. Terceira armadilha, na forma
-- de uma data.
--
-- `current_date - interval '2 months'` diz dois meses, e continua dizendo dois
-- meses no ano que vem.
--
-- ── O que isso tira, e por que tudo bem ─────────────────────────────────
--
-- Em projeto ativo saem 2 de 6:
--
--   AD 006 H05 V01        Velas Lembrancinhas    81 dias
--   AD 029 H03 V06 RMKT   Saponária             109 dias
--
-- Os dois são reais — o anúncio gêmeo do segundo não existe em conta nenhuma.
-- Mas depois de três meses ninguém volta para arrumar, e um item que nunca sai
-- da fila é um item que faz a fila parar de ser lida. É a mesma razão pela qual
-- `parado_recente` existe em vez de pintar todo parado de âmbar (`20260924a`),
-- e a mesma pela qual o alerta deixou de contar projeto encerrado
-- (`20261010d`).
--
-- A carência de 7 dias continua: criativo postado ontem ainda não tinha de ter
-- anúncio. A janela agora é **"postado entre 7 dias e 2 meses atrás"**.

begin;

create or replace view public.vw_criativo_sem_veiculacao
  with (security_invoker = on) as
 SELECT id AS producao_id,
    projeto_id,
    nome,
    data_inicio,
    CURRENT_DATE - data_inicio AS dias_desde_a_postagem
   FROM producoes p
  WHERE fase = 'postado'::text
    -- `fn_fixar_vinculo_ads` exige tipo='criativo', então VSL e aula não podem
    -- ter vínculo por construção (ver `20261010d`).
    AND tipo = 'criativo'::text
    -- Janela MÓVEL de dois meses. Substituiu um '2026-05-01' escrito à mão,
    -- que era a data do import do Meta e não a do uso do painel (29/07/2026).
    AND data_inicio >= (CURRENT_DATE - interval '2 months')
    -- Carência: postado ontem ainda não tinha de ter anúncio.
    AND data_inicio <= (CURRENT_DATE - 7)
    AND NOT (EXISTS ( SELECT 1
           FROM producao_ads pa
          WHERE pa.producao_id = p.id));

comment on view public.vw_criativo_sem_veiculacao is
  'Criativos postados entre 7 dias e 2 meses atrás que nunca ganharam vínculo '
  'com anúncio. Só `tipo = criativo`: VSL e aula não podem ter vínculo por '
  'construção. A janela é MÓVEL e substituiu uma data fixa (2026-05-01) que era '
  'o início do import do Meta, não do uso do painel (29/07/2026) — decidido em '
  '10/10/2026: mais de dois meses ninguém volta para arrumar, e item que nunca '
  'sai da fila faz a fila parar de ser lida. NÃO filtra projeto encerrado: quem '
  'julga o que é acionável é fn_alerta_cadastro_a_arrumar.';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_def   text;
  v_n     integer;
  v_max   integer;
  v_tit   text;
begin
  v_def := pg_get_viewdef('public.vw_criativo_sem_veiculacao'::regclass, true);

  -- 1. Nenhuma data escrita à mão. Era exatamente isto que envelhecia.
  if v_def ~ '''20[0-9]{2}-[0-9]{2}-[0-9]{2}''' then
    v_erros := v_erros || 'voltou a ter data fixa na view. ';
  end if;

  -- 2. E a janela é móvel.
  if v_def !~* 'interval' then
    v_erros := v_erros || 'a janela de dois meses nao e movel. ';
  end if;

  -- 3. O filtro de tipo sobreviveu ao replace. Ele entrou em `20261010d` e um
  --    `create or replace` desatento o perderia sem avisar.
  if v_def !~* 'tipo\s*=\s*''criativo''' then
    v_erros := v_erros || 'o filtro de tipo=criativo se perdeu. ';
  end if;

  -- 4. Ninguém com mais de dois meses sobrou. 62 e não 60 porque
  --    `interval '2 months'` é calendário, não 60 dias corridos.
  select coalesce(max(dias_desde_a_postagem), 0) into v_max
    from public.vw_criativo_sem_veiculacao;
  if v_max > 62 then
    v_erros := v_erros || format('o mais antigo tem %s dias, e a janela e de dois meses. ', v_max);
  end if;

  -- 5. E a carência de 7 dias continua: criativo de ontem não é cobrado.
  select coalesce(min(dias_desde_a_postagem), 99) into v_n
    from public.vw_criativo_sem_veiculacao;
  if v_n < 7 then
    v_erros := v_erros || format('apareceu criativo com %s dias; a carencia e de 7. ', v_n);
  end if;

  -- 6. O alerta continua de pé e não zerou por acidente.
  select titulo into v_tit from public.fn_alerta_cadastro_a_arrumar();
  if v_tit is null then
    v_erros := v_erros || 'o alerta parou de devolver linha. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n
    from public.vw_criativo_sem_veiculacao sv
    join public.producoes p on p.id = sv.producao_id
    join public.ofertas_editores oe on oe.id = p.projeto_id
   where oe.ativo;
  raise notice 'PROVA OK: janela movel de dois meses, sem data escrita a mao. % criativo(s) sem veiculacao em projeto ativo, o mais antigo com % dias.', v_n, v_max;
end $prova$;

notify pgrst, 'reload schema';
