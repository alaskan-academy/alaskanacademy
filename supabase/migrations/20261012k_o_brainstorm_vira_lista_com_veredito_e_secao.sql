-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O brainstorm vira lista, com veredito e seção                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- As 24 ideias que ela anotou e levou ao "Plano de crescimento Out/26 a
-- Jul/27". No plano elas viraram a seção 9, "Veredito de cada ideia da sua
-- lista", com quatro colunas: Ideia · Veredito · Quando · Seção.
--
-- Vereditos, como o plano os deixou: 16 "Fazer já", 4 "Testar", 2 "Feito",
-- 2 "Não agora". A seção 5 (pós-venda e área de membros) concentra sete
-- ideias — é onde o plano concentra a aposta.
--
-- ── O número NÃO é prioridade, e quase virou ───────────────────────────
--
-- Cada ideia carrega um número, e eu ia gravá-lo como `prioridade`. Perguntei
-- antes, e ela respondeu: "é a seção que é mencionado". O cabeçalho da tabela
-- original confirma, literalmente: "Seção".
--
-- Se tivesse chutado, "Evento presencial = 8" ficaria parecendo despriorizado
-- quando significa apenas que o assunto está na seção 8, Canais. E a tela
-- ordenaria por um campo que não ordena nada. Por isso `plano_secoes` existe:
-- sem o título ao lado, o número é adivinhação, não referência.
--
-- ── Por que não é o módulo de Análises ──────────────────────────────────
--
-- Ela foi explícita: "Ações de análises é diferente, são coisas diferentes".
-- E são: lá a ação nasce de um alerta e morre quando resolvida. Aqui a ideia
-- sobrevive ao veredito — "Não agora" não é "descartada", é "reavaliar quando
-- a condição mudar", e as duas de hoje trazem a condição escrita ("só se o
-- piloto de aula esgotar", "rever com 2 mil assinantes").
--
-- ── A coluna de resultado ───────────────────────────────────────────────
--
-- "Nenhuma tela de cadastro sem a coluna de resultado ao lado." Uma lista de
-- ideias é o cadastro mais fácil de envelhecer que existe — este projeto já
-- tem 134 links de UTM e 36 order bumps como prova.
--
-- O resultado aqui é `kpi`: quando a ideia virou meta medível, ela aponta
-- para o indicador, e a tela mostra como essa meta vai. Três já apontam,
-- porque estão literalmente na tabela de KPIs do mesmo plano:
--
--   "R$ 100 mil de lucro líquido"  → lucro_liquido_mes
--   "Sem dependência de tráfego"   → receita_fora_trafego_pct
--   "Escala com maior lucro"       → roas_medio
--
-- As outras 21 ficam sem ligação de propósito. Adivinhar que "Mais pós-venda"
-- é `recompra_90d_pct` seria inventar uma relação que ela não escreveu — e a
-- ligação errada é pior que a ausente, porque alguém acreditaria nela.

begin;

-- ── As seções do plano ───────────────────────────────────────────────────
create table if not exists public.plano_secoes (
  numero  integer primary key,
  titulo  text not null
);

comment on table public.plano_secoes is
  'Secoes do "Plano de crescimento Alaskan Academy — Out/26 a Jul/27", de '
  '10/10/2026. Existe para o numero em brainstorm.secao virar referencia '
  'legivel em vez de enigma.';

alter table public.plano_secoes enable row level security;
drop policy if exists plano_secoes_admin on public.plano_secoes;
create policy plano_secoes_admin on public.plano_secoes
  for all to authenticated using (true) with check (true);

insert into public.plano_secoes (numero, titulo) values
  (1,  'Diagnóstico: onde a empresa está hoje'),
  (2,  'A conta dos R$ 100 mil de lucro líquido'),
  (3,  'Ganhos rápidos (até 25/10)'),
  (4,  'Natal e Black Friday'),
  (5,  'Pós-venda, dopamina e área de membros'),
  (6,  'Receita sem tráfego: de ~R$ 23 mil para R$ 100 mil/mês'),
  (7,  'Produtos'),
  (8,  'Canais'),
  (9,  'Veredito de cada ideia da sua lista'),
  (10, 'Roadmap'),
  (11, 'KPIs e metas por fase')
on conflict (numero) do update set titulo = excluded.titulo;

-- ── O brainstorm ─────────────────────────────────────────────────────────
create table if not exists public.brainstorm (
  id            uuid primary key default gen_random_uuid(),
  ideia         text not null,
  veredito      text not null check (veredito in ('Fazer já','Testar','Não agora','Feito')),
  quando        text,
  secao         integer references public.plano_secoes(numero),
  kpi           text references public.metas_kpi(chave),
  ordem         integer not null default 100,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.brainstorm is
  'As ideias anotadas em brainstorm, com o veredito que cada uma recebeu no '
  'plano de 10/10/2026. Separado do modulo de Analises de proposito: la a '
  'acao nasce de um alerta e morre quando resolvida; aqui a ideia sobrevive '
  'ao veredito e pode ser retomada.';

comment on column public.brainstorm.secao is
  'Em que secao do plano a ideia e tratada. NAO e prioridade nem esforco: o '
  'cabecalho da tabela original diz "Secao". Gravar isso como prioridade '
  'faria "Evento presencial = 8" parecer despriorizado quando e so Canais.';

comment on column public.brainstorm.kpi is
  'Quando a ideia virou meta medivel, aponta para o indicador. E a coluna de '
  'resultado que a segunda armadilha do CLAUDE.md exige: sem ela isto seria '
  'mais uma lista de cadastro que envelhece sem ninguem voltar para avaliar.';

alter table public.brainstorm enable row level security;
drop policy if exists brainstorm_admin on public.brainstorm;
create policy brainstorm_admin on public.brainstorm
  for all to authenticated using (true) with check (true);

create unique index if not exists brainstorm_ideia_unica on public.brainstorm (lower(btrim(ideia)));

insert into public.brainstorm (ideia, veredito, quando, secao, kpi, ordem) values
  ('Proposta de produto físico', 'Testar', 'Cupom em nov; kit com marca em jan–mar/27', 7, null, 10),
  ('Refazer Saponaria e Workshop', 'Fazer já', 'Saponaria nov–jan; Buquê para o Dia das Mães', 7, null, 20),
  ('Mais pós-venda', 'Fazer já', 'Régua no ar até 15/11', 5, null, 30),
  ('Analisar a empresa', 'Feito', 'Seção 1 deste plano', 1, null, 40),
  ('Black Friday', 'Fazer já', 'Lista VIP 03/11, BF 27/11, foco na base', 4, null, 50),
  ('Natal: velas de árvore, maquete, potinho, bola, globo, drink com chantilly', 'Fazer já', 'Gravar até 24/10, lançar 27/10', 4, null, 60),
  ('Rede social', 'Fazer já', 'Rotina de 5 reels/semana a partir de nov', 8, null, 70),
  ('TikTok e TikTok Ads', 'Testar', 'Orgânico em nov; Ads em jan/27', 8, null, 80),
  ('Programar inspirações', 'Fazer já', '2 por semana agendadas, a partir de out', 5, null, 90),
  ('App próprio', 'Não agora', 'Usar o app instalável que já existe; rever com 2 mil assinantes', 8, null, 100),
  ('Escala com maior lucro', 'Fazer já', 'ROAS 1,6x → 2,0x; cortar abaixo de 1,35x', 2, 'roas_medio', 110),
  ('Análise do sheets', 'Feito', 'Ver nota acima da tabela', null, null, 120),
  ('Parceria com produtores grandes', 'Testar', 'Fornecedores em nov; coprodução em 2027', 7, null, 130),
  ('R$ 100 mil de lucro líquido', 'Fazer já', 'Meta para jul/27', 2, 'lucro_liquido_mes', 140),
  ('Sem dependência de tráfego', 'Fazer já', '24% da receita fora do Meta em jul/27', 6, 'receita_fora_trafego_pct', 150),
  ('Mini lançamentos no mês', 'Fazer já', 'Um por mês a partir de 27/10', 6, null, 160),
  ('Evento presencial', 'Não agora', 'Só se o piloto de aula esgotar', 8, null, 170),
  ('Aula presencial', 'Testar', 'Piloto em Joinville, mar–abr/27', 8, null, 180),
  ('Funil de aula gratuita na área de membros', 'Fazer já', 'No ar em nov, junto com a lista da BF', 5, null, 190),
  ('Ferramentas para captar leads', 'Fazer já', 'Calculadora e Meta de renda como isca em nov', 6, null, 200),
  ('Aulas de vendas ao final do curso', 'Fazer já', 'E também logo após a primeira peça', 5, null, 210),
  ('Vídeos ou VSLs na vitrine', 'Fazer já', '23 vídeos curtos até dez', 5, null, 220),
  ('Filtro e pesquisa na comunidade', 'Fazer já', 'Tags e enquete em nov', 5, null, 230),
  ('Dopamina alta, arrependimento baixo', 'Fazer já', 'Vitória rápida e bumps na aula, a partir de out', 5, null, 240)
on conflict do nothing;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
begin
  -- 1. As 24 ideias entraram.
  select count(*) into v_n from public.brainstorm;
  if v_n <> 24 then
    v_erros := v_erros || format('%s ideias no brainstorm, esperava 24. ', v_n);
  end if;

  -- 2. Os vereditos batem com o plano. Se a contagem mudar sem alguem mexer
  --    de proposito, a carga veio errada.
  select count(*) into v_n from public.brainstorm where veredito = 'Fazer já';
  if v_n <> 16 then v_erros := v_erros || format('%s "Fazer ja", esperava 16. ', v_n); end if;
  select count(*) into v_n from public.brainstorm where veredito = 'Testar';
  if v_n <> 4 then v_erros := v_erros || format('%s "Testar", esperava 4. ', v_n); end if;

  -- 3. Toda secao citada existe. Era o enigma que esta migracao veio desfazer:
  --    numero sem titulo nao e referencia, e adivinhacao.
  select count(*) into v_n from public.brainstorm b
   where b.secao is not null
     and not exists (select 1 from public.plano_secoes s where s.numero = b.secao);
  if v_n > 0 then
    v_erros := v_erros || format('%s ideia(s) apontam para secao inexistente. ', v_n);
  end if;

  -- 4. Toda ideia ligada a uma meta aponta para indicador que existe. E a
  --    coluna de resultado: sem ela o brainstorm seria cadastro sem retorno.
  select count(*) into v_n from public.brainstorm b
   where b.kpi is not null
     and not exists (select 1 from public.metas_kpi k where k.chave = b.kpi);
  if v_n > 0 then
    v_erros := v_erros || format('%s ideia(s) ligadas a kpi inexistente. ', v_n);
  end if;
  select count(*) into v_n from public.brainstorm where kpi is not null;
  if v_n < 3 then
    v_erros := v_erros || format('so %s ideia(s) ligadas a meta, esperava ao menos 3. ', v_n);
  end if;

  -- 5. As tabelas novas nao ficaram abertas.
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='brainstorm' and rowsecurity) then
    v_erros := v_erros || 'brainstorm esta sem RLS. '; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='plano_secoes' and rowsecurity) then
    v_erros := v_erros || 'plano_secoes esta sem RLS. '; end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % ideias, % ligadas a uma meta, e toda secao citada tem titulo.',
    (select count(*) from public.brainstorm),
    (select count(*) from public.brainstorm where kpi is not null);
end $prova$;

notify pgrst, 'reload schema';
