-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A assinatura para de ser eternamente "ativa"                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Medido em 12/10/2026, ao conferir o KPI "assinaturas ativas" do plano de
-- crescimento (meta: ~190 hoje → 500 em dez/26 → 1.000 em jul/27):
--
--   public.assinaturas .................... 212 linhas, TODAS com status 'ativa'
--   estados que a Payt ja mandou .......... active, inactive, pending,
--                                           overdue, canceled_by_customer
--   estado ATUAL de cada uma (ultimo evento) active=79, inactive=27,
--                                           pending=12, overdue=8,
--                                           canceled_by_customer=1
--   assinaturas cujo ultimo evento diz que
--   NAO estao ativas, gravadas como ativas .. 48
--
-- ── A causa ─────────────────────────────────────────────────────────────
--
-- `fn_normalizar_venda_payt` traduzia o status assim:
--
--   v_sub_status := CASE v_sub->>'status'
--     WHEN 'active'   THEN 'ativa'    WHEN 'canceled' THEN 'cancelada'
--     WHEN 'expired'  THEN 'expirada' WHEN 'paused'   THEN 'pausada'
--     ELSE 'ativa' END::status_assinatura;
--
-- Os quatro nomes testados — `canceled`, `expired`, `paused` — a Payt NUNCA
-- manda. Os cinco que ela manda de verdade não estão na lista, então todos
-- caem no `ELSE`. E o `ELSE` é `'ativa'`.
--
-- São duas armadilhas do CLAUDE.md numa linha só. A terceira, "lista fixa no
-- código que envelhece em silêncio": a lista foi escrita contra um vocabulário
-- imaginado e nunca conferida contra o que chega. E a quarta, "retrato único
-- que nunca se atualiza": o gatilho existe e roda, mas sempre escreve o mesmo
-- valor, então é o mesmo que não existir.
--
-- O agravante é o padrão ser o caso OTIMISTA. Um `ELSE` que caísse em
-- 'cancelada' teria gritado na primeira semana, porque a tela mostraria
-- assinatura viva como morta e alguém reclamaria. Caindo em 'ativa', ele
-- produz exatamente o número que se quer ver — e ninguém reclama de boa
-- notícia. O KPI só subiria, e a meta de 1.000 seria batida no papel enquanto
-- a base esvazia.
--
-- ── Por que a tradução vai para TABELA ──────────────────────────────────
--
-- "Derivar de tabela, nunca listar no código. Se a lista precisa existir no
-- código, ela precisa de um teste que falhe quando o banco ganhar um item
-- novo." O `CASE` é a lista no código, e foi assim que ela envelheceu.
--
-- `payt_status_assinatura` passa a ser o vocabulário, e a prova desta migração
-- é o teste que o CLAUDE.md pede: ela percorre `payt_webhook_raw` e falha se
-- a Payt já tiver mandado algum status que a tabela não conhece. No dia em que
-- a Payt inventar um sexto estado, a próxima migração reprova até alguém
-- decidir o que ele significa.
--
-- O desconhecido passa a cair em 'pendente', não em 'ativa': o novo padrão é
-- o que NÃO conta para a meta. Errar para menos aqui é o lado certo de errar.
--
-- ── O passado: carga inicial, porque o gatilho só mantém o presente ─────
--
-- 127 das 212 têm evento de webhook e dá para corrigir pelo último que chegou.
-- As outras 85 são anteriores à integração e não têm evento nenhum. Para elas
-- a segunda fonte é a própria cobrança, cruzada com o CICLO — e foi aqui que
-- eu quase errei feio:
--
--   74 sao MENSAIS (ciclo 30), comecadas entre 21/02 e 19/05/2026. Destas,
--      73 NUNCA geraram uma venda aprovada — nao e "parou de cobrar", e
--      "nunca cobrou" — e nenhuma apareceu nos 1,7 ciclos mensais em que o
--      webhook esta escutando (21/08 a 11/10). Mensal que nunca cobrou em
--      cinco meses nao e assinatura ativa. → 'expirada'.
--
--   11 sao ANUAIS (ciclo 365), comecadas entre 17/06 e 20/08/2026, com
--      proximo ciclo so em 2027. Nao cobrar ha 45 dias e o ESPERADO delas.
--      → ficam 'ativa'.
--
-- ── Dois erros meus no caminho, porque a prova pegou os dois ────────────
--
-- 1. A primeira leitura foi "nenhuma das 85 cobrou nos ultimos 45 dias, logo
--    as 85 morreram". Teria matado 11 anuais vivas. O CICLO era a segunda
--    fonte que faltava olhar.
--
-- 2. A segunda versao deste UPDATE filtrava por
--    `data_proximo_ciclo < current_date - 30 dias`, porque eu tinha lido
--    `max(data_proximo_ciclo) = 2026-07-21` para o grupo. Mas `max()` ignora
--    NULL: das 74, SETENTA E TRES tem esse campo nulo, e o maximo descrevia
--    uma linha so. O UPDATE mexeu em 1 em vez de 74, e a prova reprovou com
--    "sobraram 163 ativas; esperava ~90".
--
-- Por isso o criterio final nao usa data_proximo_ciclo: usa a ausencia de
-- venda, que e o fato, e nao um campo que ninguem preencheu.
--
-- ── O que isto corrige no plano de crescimento ──────────────────────────
--
-- A linha de base do KPI deixa de ser 212 (ou os "~190" que o plano registra)
-- e passa a ser ~79 confirmadas pelo webhook mais as 11 anuais ainda no prazo.
-- A meta de 500 em dez/26 parte de muito mais baixo do que o plano supunha —
-- e é melhor descobrir isso agora do que em dezembro.

-- O enum ganha o estado que faltava. `ADD VALUE` precisa estar commitado
-- antes de ser usado, por isso vem sozinho e antes de tudo.
alter type public.status_assinatura add value if not exists 'pendente';

commit;

begin;

-- Retrato de antes: a prova compara contra ele, nao contra numero escrito a
-- mao que envelhece sozinho.
drop table if exists _antes_assin;
create temp table _antes_assin as
select count(*)                                   as linhas,
       count(*) filter (where status = 'ativa')    as ativas
  from public.assinaturas;

-- ── O vocabulário, agora em tabela ───────────────────────────────────────
create table if not exists public.payt_status_assinatura (
  payt_status text primary key,
  status      status_assinatura not null,
  observacao  text,
  criado_em   timestamptz not null default now()
);

comment on table public.payt_status_assinatura is
  'Traducao dos status de assinatura que a Payt manda para o enum do painel. '
  'Era um CASE dentro de fn_normalizar_venda_payt escrito contra nomes que a '
  'Payt nunca mandou, com ELSE otimista para ativa — 48 assinaturas mortas '
  'figuravam como vivas. A prova de 20261012i falha se a Payt mandar um '
  'status que nao esteja aqui.';

alter table public.payt_status_assinatura enable row level security;

drop policy if exists payt_status_assinatura_admin on public.payt_status_assinatura;
create policy payt_status_assinatura_admin on public.payt_status_assinatura
  for all to authenticated using (true) with check (true);

insert into public.payt_status_assinatura (payt_status, status, observacao) values
  ('active',               'ativa',        'Assinatura em dia.'),
  ('inactive',             'cancelada',    'Encerrada. E para onde vao 27 das 29 que passam por pending.'),
  ('pending',              'pendente',     'Criada e aguardando o primeiro pagamento. Medido em 12/10: 27 viraram inactive e so 2 viraram active.'),
  ('overdue',              'inadimplente', 'Cobranca falhou e esta em atraso. Observada a transicao active -> overdue -> canceled_by_customer.'),
  ('canceled_by_customer', 'cancelada',    'A propria aluna cancelou.')
on conflict (payt_status) do update
  set status = excluded.status, observacao = excluded.observacao;

commit;

-- ── O gatilho passa a consultar a tabela ─────────────────────────────────
--
-- Emenda por substituicao de texto em vez de reemitir a funcao inteira. Ela
-- tem ~300 linhas no caminho critico da ingestao da Payt, e retipa-las para
-- trocar quatro e meia e a forma mais provavel de introduzir um defeito novo
-- num lugar onde ele custaria vendas. A prova confere os DOIS lados: que o
-- CASE velho sumiu e que a consulta nova entrou.
do $emenda$
declare
  v_def  text := pg_get_functiondef('public.fn_normalizar_venda_payt'::regproc);
  v_velho text := $alvo$    v_sub_status := CASE v_sub->>'status'
      WHEN 'active'   THEN 'ativa'    WHEN 'canceled' THEN 'cancelada'
      WHEN 'expired'  THEN 'expirada' WHEN 'paused'   THEN 'pausada'
      ELSE 'ativa' END::status_assinatura;$alvo$;
  v_novo text := $novo$    -- O vocabulario mora em payt_status_assinatura, nao aqui: ver 20261012i.
    -- Status que a tabela nao conhece vira 'pendente', nunca 'ativa' — o
    -- desconhecido nao pode contar como meta batida.
    SELECT m.status INTO v_sub_status
      FROM payt_status_assinatura m
     WHERE m.payt_status = v_sub->>'status';
    v_sub_status := COALESCE(v_sub_status, 'pendente'::status_assinatura);$novo$;
begin
  if position(v_novo in v_def) > 0 then
    raise notice 'a emenda ja estava aplicada';
  elsif position(v_velho in v_def) = 0 then
    raise exception 'o CASE antigo de status de assinatura nao foi encontrado em '
                    'fn_normalizar_venda_payt, e o novo tambem nao esta la: a '
                    'funcao mudou e esta emenda precisa ser refeita a mao.';
  else
    execute replace(v_def, v_velho, v_novo);
  end if;
end $emenda$;

begin;

-- ── A carga inicial: o passado que o gatilho nao alcanca ─────────────────

-- 1. As 127 com evento: o ultimo que chegou manda.
with ultimo as (
  select distinct on (body->'subscription'->>'code')
         body->'subscription'->>'code'   as cod,
         body->'subscription'->>'status' as st
    from public.payt_webhook_raw
   where jsonb_typeof(body->'subscription') = 'object'
     and nullif(body->'subscription'->>'code', '') is not null
   order by body->'subscription'->>'code', recebido_em desc
)
update public.assinaturas a
   set status = m.status, atualizado_em = now()
  from ultimo u
  join public.payt_status_assinatura m on m.payt_status = u.st
 where a.subscription_id_payt = u.cod
   and a.status is distinct from m.status;

-- 2. As mensais anteriores ao webhook que nunca cobraram nada.
--
--    `a.ciclo_dias = 30` e o que protege as 11 anuais: anual nao cobrar ha
--    meses e o comportamento esperado dela, e marca-la como expirada seria o
--    erro que a segunda fonte evitou.
--
--    Nao se usa `data_proximo_ciclo` de proposito: 73 das 74 o tem NULL, e
--    foi exatamente por isso que a versao anterior deste UPDATE mexeu em uma
--    linha so. O criterio e a AUSENCIA DE VENDA, que e fato registrado, mais
--    a ausencia de qualquer evento na janela em que o webhook escuta.
update public.assinaturas a
   set status = 'expirada', atualizado_em = now()
 where a.ciclo_dias = 30
   and a.status = 'ativa'
   and a.data_inicio < (current_date - interval '90 days')
   and not exists (
     select 1 from public.payt_webhook_raw r
      where jsonb_typeof(r.body->'subscription') = 'object'
        and r.body->'subscription'->>'code' = a.subscription_id_payt)
   and not exists (
     select 1 from public.vendas v
      where v.assinatura_id = a.id and v.status = 'aprovada');

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_def   text := pg_get_functiondef('public.fn_normalizar_venda_payt'::regproc);
begin
  -- 1. O CASE otimista morreu, e a consulta a tabela entrou. Os dois lados,
  --    porque sumir o velho sem entrar o novo deixaria a funcao sem traducao.
  if v_def ~ 'ELSE ''ativa'' END::status_assinatura' then
    v_erros := v_erros || 'o ELSE otimista para ativa continua na funcao. ';
  end if;
  if v_def !~ 'FROM payt_status_assinatura' then
    v_erros := v_erros || 'a funcao nao esta consultando payt_status_assinatura. ';
  end if;
  if v_def !~ 'COALESCE\(v_sub_status, ''pendente''' then
    v_erros := v_erros || 'o desconhecido nao esta caindo em pendente. ';
  end if;

  -- 2. O TESTE QUE O CLAUDE.MD PEDE: a tabela conhece tudo o que a Payt ja
  --    mandou. No dia em que ela inventar um sexto estado, isto reprova.
  select count(distinct body->'subscription'->>'status') into v_n
    from public.payt_webhook_raw
   where jsonb_typeof(body->'subscription') = 'object'
     and nullif(body->'subscription'->>'status', '') is not null
     and body->'subscription'->>'status' not in
         (select payt_status from public.payt_status_assinatura);
  if v_n > 0 then
    v_erros := v_erros || format(
      '%s status de assinatura chegaram da Payt e nao estao em '
      'payt_status_assinatura. Decida o que significam antes de seguir. ', v_n);
  end if;

  -- 3. A conta parou de ser 100%% ativa, nos DOIS sentidos. O teto pega a
  --    correcao que nao pegou — foi ele que reprovou a versao anterior desta
  --    migracao com "sobraram 163 ativas". O piso pega o oposto, que e eu
  --    matar assinatura viva por criterio largo demais.
  select count(*) filter (where status = 'ativa') into v_n from public.assinaturas;
  if v_n > 120 then
    v_erros := v_erros || format('sobraram %s ativas; esperava ~90. ', v_n);
  end if;
  if v_n < 50 then
    v_erros := v_erros || format('sobraram so %s ativas; matei demais. ', v_n);
  end if;

  -- 4. E nao matei as anuais. Eram 11 anuais sem evento e com proximo ciclo
  --    em 2027; elas nao podem ter entrado no UPDATE de expirada. Foi o erro
  --    que a segunda fonte evitou, entao fica cravado como caso.
  select count(*) into v_n
    from public.assinaturas a
   where a.ciclo_dias = 365
     and a.status = 'expirada'
     and a.data_proximo_ciclo > current_date;
  if v_n > 0 then
    v_erros := v_erros || format(
      '%s assinatura(s) ANUAL com proximo ciclo no futuro foram marcadas como '
      'expiradas. ', v_n);
  end if;

  select count(*) into v_n from public.assinaturas
   where ciclo_dias = 365 and status = 'ativa'
     and not exists (select 1 from public.payt_webhook_raw r
                      where jsonb_typeof(r.body->'subscription') = 'object'
                        and r.body->'subscription'->>'code' = assinaturas.subscription_id_payt);
  if v_n <> 11 then
    v_erros := v_erros || format(
      'as anuais sem evento deveriam seguir 11 ativas e sao %s. ', v_n);
  end if;

  -- 5. Nenhuma assinatura foi criada nem apagada: isto corrige status.
  select count(*) into v_n from public.assinaturas;
  if v_n <> (select linhas from _antes_assin) then
    v_erros := v_erros || format('assinaturas tem %s linhas, o retrato dizia %s. ',
                                 v_n, (select linhas from _antes_assin));
  end if;

  -- 6. A tabela nova nao ficou aberta.
  if not exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename = 'payt_status_assinatura'
                    and rowsecurity) then
    v_erros := v_erros || 'payt_status_assinatura esta sem RLS. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % de % assinaturas continuam ativas (eram 212 de 212), '
               'o vocabulario saiu do CASE para a tabela, o desconhecido cai em '
               'pendente, e as anuais no prazo seguem vivas.',
               (select count(*) filter (where status = 'ativa') from public.assinaturas),
               (select linhas from _antes_assin);
end $prova$;

drop table if exists _antes_assin;

notify pgrst, 'reload schema';
