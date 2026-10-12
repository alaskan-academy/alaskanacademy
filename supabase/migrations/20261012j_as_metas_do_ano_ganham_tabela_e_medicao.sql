-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ As metas do ano ganham tabela, e a medição vem junto                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- O "Plano de crescimento Alaskan Academy — Out/26 a Jul/27" fecha com uma
-- tabela de dez indicadores e quatro colunas (Hoje, Dez/26, Mar/27, Jul/27).
-- Até agora ela existia só no documento: ninguém media, e a comparação era
-- feita de cabeça na Weekly.
--
-- Esta migração traz a tabela para dentro do painel e, junto com ela, a
-- medição — porque meta sem medição é cadastro sem resultado, que é a segunda
-- armadilha do CLAUDE.md e já custou caro aqui (134 links de UTM sem tela de
-- venda, 38 testes com 3 vencedores, 36 order bumps dos quais 10 nunca
-- venderam).
--
-- ── O que NÃO é ────────────────────────────────────────────────────────
--
-- Não tem nada a ver com `ad_accounts.roas_meta` / `cpa_meta`, que seguem
-- intocadas. Aquilo é alvo de conta de anúncio, usado por `fn_metas_sugeridas`
-- e pela régua de corte de criativo. Isto é meta de ANO DE EMPRESA. Ela foi
-- explícita: "são coisas totalmente diferentes, não mexa nisso".
--
-- Também não é o módulo de Análises: lá a ação nasce de um alerta e morre
-- quando resolvida. Meta tem prazo e sobrevive a ele.
--
-- ── `empresa_id` nulo é a casa inteira ──────────────────────────────────
--
-- Resposta dela a "metas por empresa sempre, ou da casa inteira?": "pode ser
-- para todas ou separadamente". Então a coluna existe e aceita nulo, com o
-- mesmo significado que `configuracoes` já usa — nulo é a geral.
--
-- As metas que este arquivo semeia nascem com `empresa_id` NULO, e não por
-- preguiça: metade dos indicadores não TEM como ser recortada por empresa.
-- `assinaturas` não tem `empresa_id`, `clientes` também não. Marcar essas
-- metas como "Alaskan Academy" seria afirmar um recorte que a medição não
-- consegue honrar. Quando `vendas.empresa_id` bastar para um indicador, a
-- meta dele pode ser duplicada por empresa sem mexer em nada aqui.
--
-- ── O catálogo de indicadores é TABELA ──────────────────────────────────
--
-- "Derivar de tabela, nunca listar no código." `metas_kpi` é o vocabulário:
-- quem existe, em que unidade, se a meta é piso ou teto, e se a medição é
-- automática. A prova confere que todo indicador marcado como automático é
-- de fato devolvido por `fn_metas_medir` — então marcar um como automático
-- sem ensinar a função a medi-lo reprova a migração, em vez de produzir uma
-- linha eternamente vazia na tela.
--
-- ── Cinco indicadores nascem MANUAIS, e o motivo importa ───────────────
--
-- `lucro_liquido_mes` e `roas_medio` são os dois números que mandam no plano,
-- e são justamente os que não dá para medir aqui ainda. `fn_overview` devolve
-- faturamento, taxa, juros, coprodução e perdas — mas NÃO devolve lucro nem
-- ROAS. A fórmula do lucro (bruto − taxa − reembolso − Simples − imposto do
-- Meta − investimento) mora no TypeScript da OverviewPage, e o investimento
-- do Meta nem entra na função.
--
-- Reimplementar essa conta em SQL para alimentar a meta criaria dois lucros,
-- que divergiriam no primeiro ajuste de alíquota — primeira armadilha, na
-- forma mais cara possível. O certo é mover a fórmula para o banco e a tela
-- passar a ler de lá; isso é obra própria, não carona nesta.
--
-- `alunas_ativas_30d_pct` e `bumps_abertos_pct` vêm do banco da área de
-- membros Handify, que não é este. `pix_pendente_recuperado_pct` é mensurável
-- aqui, mas depende de fechar a definição de "recuperado" (o `cart_recovered`
-- só passou a ser gravado em 12/10, com 257 marcados).
--
-- Marcado como manual, o indicador aparece na tela com o alvo e sem o
-- medido, dizendo por quê. É melhor que sumir, e muito melhor que um número
-- inventado.
--
-- ── Linha de base conferida, e três números do plano estavam errados ───
--
-- Medido em 12/10/2026 contra o banco, antes de semear:
--
--   Base com WhatsApp ...... plano dizia 25%   · real 99,1%  (meta de jul/27
--                            era 70%: batida nove meses antes, pela
--                            importação da Payt de hoje)
--   Assinaturas ativas ..... plano dizia ~190  · real 90     (a tabela dizia
--                            212 e TODAS ativas; ver 20261012i)
--   Recompra em 90 dias .... plano dizia 11%   · real 7,13%  (os 11% eram de
--                            TODO o histórico, não da janela de 90 dias)
--   LTV medio .............. plano dizia R$ 94 · real R$ 95,00
--   Receita fora do trafego  plano dizia ~11%  · real 12,5% em set/26
--
-- O `valor_base` semeado aqui é o do PLANO, de propósito: é contra ele que as
-- decisões foram tomadas. O real aparece ao lado, medido, e a diferença entre
-- os dois é informação — não erro a ser escondido.

begin;

drop table if exists _antes_metas;
create temp table _antes_metas as
select (select count(*) from pg_tables where schemaname='public' and tablename='metas') as ja_existia;

-- ── O vocabulário ────────────────────────────────────────────────────────
create table if not exists public.metas_kpi (
  chave       text primary key,
  nome        text not null,
  unidade     text not null check (unidade in ('moeda','percentual','numero','multiplicador')),
  direcao     text not null check (direcao in ('piso','teto')),
  automatico  boolean not null default false,
  observacao  text,
  ordem       integer not null default 100,
  criado_em   timestamptz not null default now()
);

comment on table public.metas_kpi is
  'Catalogo de indicadores de meta. Lista em tabela e nao no codigo, pela '
  'terceira armadilha do CLAUDE.md. `automatico` diz se fn_metas_medir sabe '
  'calcular: a prova de 20261012j reprova se alguem marcar automatico sem '
  'ensinar a funcao, o que daria uma linha eternamente vazia na tela.';

alter table public.metas_kpi enable row level security;
drop policy if exists metas_kpi_admin on public.metas_kpi;
create policy metas_kpi_admin on public.metas_kpi
  for all to authenticated using (true) with check (true);

-- ── As metas ─────────────────────────────────────────────────────────────
create table if not exists public.metas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid references public.empresas(id),
  kpi           text not null references public.metas_kpi(chave),
  prazo         date not null,
  valor_alvo    numeric not null,
  valor_base    numeric,
  base_em       date,
  observacao    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on column public.metas.empresa_id is
  'Nulo = a casa inteira (as duas empresas somadas), mesmo significado que em '
  'configuracoes. Preenchido recorta uma operacao.';
comment on column public.metas.valor_base is
  'O "hoje" registrado quando a meta foi escrita. Guardado para a tela poder '
  'mostrar o caminho percorrido, e porque a diferenca entre ele e o medido de '
  'verdade e informacao: tres indicadores do plano de out/26 estavam errados.';

-- UNIQUE com NULL nao serve: duas linhas com empresa_id nulo, mesmo kpi e
-- mesmo prazo passariam as duas, porque NULL nunca e igual a NULL.
create unique index if not exists metas_sem_duplicata
  on public.metas (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), kpi, prazo);

alter table public.metas enable row level security;
drop policy if exists metas_admin on public.metas;
create policy metas_admin on public.metas
  for all to authenticated using (true) with check (true);

-- ── O catálogo, semeado ──────────────────────────────────────────────────
insert into public.metas_kpi (chave, nome, unidade, direcao, automatico, ordem, observacao) values
  ('lucro_liquido_mes', 'Lucro líquido por mês', 'moeda', 'piso', false, 10,
   'MANUAL: a formula do lucro mora no TypeScript da OverviewPage e fn_overview nao devolve lucro nem investimento do Meta. Recalcular em SQL criaria dois lucros. Automatizar exige antes mover a formula para o banco.'),
  ('roas_medio', 'ROAS médio (Meta)', 'multiplicador', 'piso', false, 20,
   'MANUAL pelo mesmo motivo do lucro: depende do investimento do Meta, que fn_overview nao devolve. Nao confundir com ad_accounts.roas_meta, que e alvo por conta de anuncio.'),
  ('receita_fora_trafego_pct', 'Receita fora do tráfego', 'percentual', 'piso', true, 30,
   'Fatia da receita aprovada dos ultimos 30 dias que NAO veio de anuncio (eh_trafego falso).'),
  ('ltv_medio', 'LTV médio por cliente', 'moeda', 'piso', true, 40,
   'Receita aprovada dividida por PESSOA, agrupando por CPF. Antes de 12/10 a mesma aluna com dois e-mails contava duas vezes.'),
  ('recompra_90d_pct', 'Recompra em 90 dias', 'percentual', 'piso', true, 50,
   'Fatia das pessoas que compraram nos ultimos 90 dias e fizeram 2+ compras NESSA janela. O plano de out/26 registrou 11%, que era de todo o historico: na janela de 90 dias sao 7,13%.'),
  ('assinaturas_ativas', 'Assinaturas ativas', 'numero', 'piso', true, 60,
   'Nao recorta por empresa: assinaturas nao tem empresa_id. Ate 12/10 a tabela dizia 212 e todas ativas; ver 20261012i.'),
  ('pix_pendente_recuperado_pct', 'Pix pendente recuperado', 'percentual', 'piso', false, 70,
   'MANUAL por ora: mensuravel aqui, mas depende de fechar a definicao de "recuperado". cart_recovered so passou a ser gravado em 12/10.'),
  ('alunas_ativas_30d_pct', 'Alunas ativas nos últimos 30 dias', 'percentual', 'piso', false, 80,
   'MANUAL: vem do banco da area de membros Handify, que nao e este.'),
  ('base_whatsapp_pct', 'Base com WhatsApp', 'percentual', 'piso', true, 90,
   'Fatia dos clientes com telefone preenchido. Saiu de 25% para 99,1% em 12/10 com a exportacao da Payt.'),
  ('bumps_abertos_pct', 'Bumps abertos pela compradora', 'percentual', 'piso', false, 100,
   'MANUAL: consumo de produto, vem da area de membros Handify.'),
  ('clientes_unicos_90d', 'Clientes únicos em 90 dias', 'numero', 'piso', true, 110,
   'Pessoas distintas, por CPF, com compra aprovada nos ultimos 90 dias. Nao esta na tabela do plano; entra porque ela pediu a contagem por CPF e agora ela existe.')
on conflict (chave) do update set
  nome = excluded.nome, unidade = excluded.unidade, direcao = excluded.direcao,
  automatico = excluded.automatico, observacao = excluded.observacao, ordem = excluded.ordem;

-- ── As metas do plano, semeadas ──────────────────────────────────────────
-- Prazos: Dez/26, Mar/27 e Jul/27, no ultimo dia de cada mes. `valor_base` e
-- a coluna "Hoje" do plano, com a data em que o plano foi escrito.
insert into public.metas (empresa_id, kpi, prazo, valor_alvo, valor_base, base_em, observacao) values
  (null, 'lucro_liquido_mes',           '2026-12-31',   24000,  -10000, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'lucro_liquido_mes',           '2027-03-31',   63000,  -10000, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'lucro_liquido_mes',           '2027-07-31',   98000,  -10000, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'roas_medio',                  '2026-12-31',    1.75,    1.61, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'roas_medio',                  '2027-03-31',    1.90,    1.61, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'roas_medio',                  '2027-07-31',    1.95,    1.61, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'receita_fora_trafego_pct',    '2026-12-31',      12,      11, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'receita_fora_trafego_pct',    '2027-03-31',      18,      11, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'receita_fora_trafego_pct',    '2027-07-31',      24,      11, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'ltv_medio',                   '2026-12-31',     105,      94, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'ltv_medio',                   '2027-03-31',     125,      94, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'ltv_medio',                   '2027-07-31',     150,      94, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'recompra_90d_pct',            '2026-12-31',      14,      11, '2026-10-10', 'A base de 11% do plano era de todo o historico, nao da janela de 90 dias'),
  (null, 'recompra_90d_pct',            '2027-03-31',      18,      11, '2026-10-10', 'A base de 11% do plano era de todo o historico, nao da janela de 90 dias'),
  (null, 'recompra_90d_pct',            '2027-07-31',      22,      11, '2026-10-10', 'A base de 11% do plano era de todo o historico, nao da janela de 90 dias'),
  (null, 'assinaturas_ativas',          '2026-12-31',     500,     190, '2026-10-10', 'A base de ~190 do plano estava alta: eram 90 reais, ver 20261012i'),
  (null, 'assinaturas_ativas',          '2027-03-31',     750,     190, '2026-10-10', 'A base de ~190 do plano estava alta: eram 90 reais, ver 20261012i'),
  (null, 'assinaturas_ativas',          '2027-07-31',    1000,     190, '2026-10-10', 'A base de ~190 do plano estava alta: eram 90 reais, ver 20261012i'),
  (null, 'pix_pendente_recuperado_pct', '2026-12-31',      15,    null, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'pix_pendente_recuperado_pct', '2027-03-31',      20,    null, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'pix_pendente_recuperado_pct', '2027-07-31',      20,    null, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'alunas_ativas_30d_pct',       '2026-12-31',      45,      42, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'alunas_ativas_30d_pct',       '2027-03-31',      50,      42, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'alunas_ativas_30d_pct',       '2027-07-31',      55,      42, '2026-10-10', 'Plano de crescimento Out/26–Jul/27'),
  (null, 'base_whatsapp_pct',           '2026-12-31',      45,      25, '2026-10-10', 'Batida em 12/10 com a exportacao da Payt: 99,1%'),
  (null, 'base_whatsapp_pct',           '2027-03-31',      60,      25, '2026-10-10', 'Batida em 12/10 com a exportacao da Payt: 99,1%'),
  (null, 'base_whatsapp_pct',           '2027-07-31',      70,      25, '2026-10-10', 'Batida em 12/10 com a exportacao da Payt: 99,1%'),
  (null, 'bumps_abertos_pct',           '2026-12-31',      25,       7, '2026-10-10', 'Plano registra 6–8%; base gravada como 7'),
  (null, 'bumps_abertos_pct',           '2027-03-31',      35,       7, '2026-10-10', 'Plano registra 6–8%; base gravada como 7'),
  (null, 'bumps_abertos_pct',           '2027-07-31',      40,       7, '2026-10-10', 'Plano registra 6–8%; base gravada como 7')
on conflict do nothing;

commit;

-- ── A medição ────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque LTV, recompra e clientes únicos agrupam por CPF, e
-- `clientes.cpf` tem o SELECT revogado de `authenticated` (20261012d). A
-- função devolve números; o documento não sai dela.
create or replace function public.fn_metas_medir(
  p_empresa uuid  default null,
  p_ref     date  default current_date)
 returns table (kpi text, valor numeric)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with vendas_ok as (
    select v.cliente_id, v.data_venda,
           coalesce(v.valor_sem_juros, v.valor_total) - coalesce(v.valor_coproducao, 0) as valor,
           coalesce(v.ad_id_meta is not null or coalesce(v.trafego_pago, false), false) as eh_trafego
      from vendas v
     where v.status = 'aprovada'
       and v.pedido_id not like 'TEST%' and v.pedido_id not like 'LC-%'
       and v.data_venda < (p_ref + 1)
       and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  pessoa_total as (
    select coalesce(nullif(btrim(c.cpf), ''), 'id:' || c.id::text) p, sum(w.valor) total
      from vendas_ok w join clientes c on c.id = w.cliente_id
     group by 1
  ),
  pessoa_90 as (
    select coalesce(nullif(btrim(c.cpf), ''), 'id:' || c.id::text) p, count(*) n
      from vendas_ok w join clientes c on c.id = w.cliente_id
     where w.data_venda >= (p_ref - 90)
     group by 1
  )
  select 'assinaturas_ativas',
         (select count(*) from assinaturas where status = 'ativa')::numeric
  union all
  select 'base_whatsapp_pct',
         (select round(100.0 * count(nullif(trim(telefone), '')) / nullif(count(*), 0), 2)
            from clientes)
  union all
  select 'ltv_medio',          (select round(avg(total), 2) from pessoa_total)
  union all
  select 'clientes_unicos_90d', (select count(*)::numeric from pessoa_90)
  union all
  select 'recompra_90d_pct',
         (select round(100.0 * count(*) filter (where n > 1) / nullif(count(*), 0), 2)
            from pessoa_90)
  union all
  select 'receita_fora_trafego_pct',
         (select round(100.0 * sum(valor) filter (where not eh_trafego) / nullif(sum(valor), 0), 2)
            from vendas_ok where data_venda >= (p_ref - 30));
$function$;

comment on function public.fn_metas_medir(uuid, date) is
  'Mede os indicadores de meta marcados como automaticos em metas_kpi. '
  'SECURITY DEFINER porque LTV, recompra e clientes unicos agrupam por CPF, e '
  'a coluna tem o SELECT revogado de authenticated (20261012d) — devolve '
  'numeros, nunca o documento. assinaturas_ativas e base_whatsapp_pct ignoram '
  'p_empresa: as tabelas de origem nao tem empresa_id.';

revoke all on function public.fn_metas_medir(uuid, date) from public, anon;
grant execute on function public.fn_metas_medir(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_v     numeric;
begin
  -- 1. O CATALOGO E A MEDICAO NAO PODEM DIVERGIR. Este e o caso que impede a
  --    segunda armadilha: indicador marcado como automatico sem ninguem
  --    ensinar a funcao a medi-lo daria uma linha eternamente vazia na tela.
  select count(*) into v_n
    from public.metas_kpi k
   where k.automatico
     and not exists (select 1 from public.fn_metas_medir() m where m.kpi = k.chave);
  if v_n > 0 then
    v_erros := v_erros || format(
      '%s indicador(es) marcado(s) como automatico que fn_metas_medir nao mede. ', v_n);
  end if;

  -- ... e o contrario: a funcao medindo algo que o catalogo nao conhece seria
  --     numero orfao, que ninguem sabe ler.
  select count(*) into v_n
    from public.fn_metas_medir() m
   where not exists (select 1 from public.metas_kpi k where k.chave = m.kpi and k.automatico);
  if v_n > 0 then
    v_erros := v_erros || format(
      '%s medicao(oes) de fn_metas_medir sem indicador automatico em metas_kpi. ', v_n);
  end if;

  -- 2. Toda meta aponta para um indicador que existe.
  select count(*) into v_n
    from public.metas t
   where not exists (select 1 from public.metas_kpi k where k.chave = t.kpi);
  if v_n > 0 then
    v_erros := v_erros || format('%s meta(s) apontam para kpi inexistente. ', v_n);
  end if;

  -- 3. As 30 metas do plano entraram: 10 indicadores x 3 prazos.
  select count(*) into v_n from public.metas;
  if v_n < 30 then
    v_erros := v_erros || format('so %s metas semeadas, esperava 30. ', v_n);
  end if;
  select count(distinct prazo) into v_n from public.metas;
  if v_n <> 3 then
    v_erros := v_erros || format('%s prazos distintos, esperava 3. ', v_n);
  end if;

  -- 4. A medicao bate com o que foi conferido a mao em 12/10. Nao e numero
  --    magico: e a conferencia contra a segunda fonte que o CLAUDE.md pede.
  select valor into v_v from public.fn_metas_medir() where kpi = 'assinaturas_ativas';
  if v_v is null or v_v < 50 or v_v > 150 then
    v_erros := v_erros || format('assinaturas_ativas mediu %s, esperava ~90. ', v_v);
  end if;
  select valor into v_v from public.fn_metas_medir() where kpi = 'base_whatsapp_pct';
  if v_v is null or v_v < 90 then
    v_erros := v_erros || format('base_whatsapp_pct mediu %s, esperava ~99. ', v_v);
  end if;
  select valor into v_v from public.fn_metas_medir() where kpi = 'ltv_medio';
  if v_v is null or v_v < 50 or v_v > 200 then
    v_erros := v_erros || format('ltv_medio mediu %s, esperava ~95. ', v_v);
  end if;

  -- 5. A tranca: a funcao le cpf, entao anon nao pode executa-la, e a coluna
  --    nao pode ter sido reaberta no caminho.
  if has_function_privilege('anon', 'public.fn_metas_medir(uuid,date)', 'EXECUTE') then
    v_erros := v_erros || 'anon consegue executar fn_metas_medir. ';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_metas_medir(uuid,date)', 'EXECUTE') then
    v_erros := v_erros || 'authenticated NAO executa fn_metas_medir: a tela quebraria. ';
  end if;
  if has_column_privilege('authenticated', 'public.clientes', 'cpf', 'SELECT') then
    v_erros := v_erros || 'authenticated voltou a ler a coluna cpf. ';
  end if;

  -- 6. As tabelas novas nao ficaram abertas.
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='metas' and rowsecurity) then
    v_erros := v_erros || 'metas esta sem RLS. ';
  end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='metas_kpi' and rowsecurity) then
    v_erros := v_erros || 'metas_kpi esta sem RLS. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % metas em % indicadores, % deles medidos automaticamente.',
    (select count(*) from public.metas),
    (select count(*) from public.metas_kpi),
    (select count(*) from public.metas_kpi where automatico);
end $prova$;

drop table if exists _antes_metas;

notify pgrst, 'reload schema';
