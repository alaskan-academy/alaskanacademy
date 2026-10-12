-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O plano ganha prazo, e o prazo ganha aviso                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- O pedido dela, na primeira frase da conversa, tinha três partes: "metas com
-- PRAZOS, AVISOS e coleta de kpis automáticas". A primeira entrega resolveu a
-- terceira e metade da primeira (a tabela de KPIs com data-alvo) e deixou as
-- outras duas de fora. O retorno foi direto: "não tem muitos detalhes, está
-- confuso e acho que tem muito mais coisas no doc que enviei".
--
-- Tinha mesmo. O plano de 10/10/2026 traz TRINTA ações com data, em três
-- blocos, e nenhuma delas estava no painel:
--
--   · 15 ganhos rápidos com vencimento em 25/10, três já feitos
--   ·  7 passos do calendário de Natal e Black Friday, de 13/10 a 16/12
--   ·  8 mini lançamentos, um por mês, de nov/26 a jul/27
--
-- ── Os três "Alertas para resolver já" não viraram linha ──────────────────
--
-- A seção 1 fecha com três alertas: a conta "Saponaria" em carência, a
-- retirada de R$ 3.000 classificada como "Hospedagem" e os 68 lançamentos
-- pendentes. Nenhum deles entrou como ação própria, porque os três já ESTÃO
-- nos ganhos rápidos: o primeiro é o ganho rápido 1, e os outros dois são o
-- ganho rápido 8 ("Arrumar o financeiro") inteiro. Duplicar daria duas
-- linhas para a mesma tarefa, cada uma com seu próprio estado de feito —
-- armadilha 1 em forma de fila de tarefas.
--
-- Vale registrar que o plano se CONTRADIZ sobre a Saponaria: a seção 1 diz
-- que a conta está em carência e a seção 3 marca a regularização como feita.
-- Resolvi pelo dado, não pelo texto: a conta gastou R$ 43,4 mil entre 1 e 10
-- de outubro, então está rodando, e o [x] da seção 3 é o estado mais novo.
--
-- ── Por que UM campo de data feita, e não dois ─────────────────────────────
--
-- A tentação era `feito boolean` + `feito_em timestamptz`. São dois campos
-- dizendo a mesma coisa, e a primeira armadilha do CLAUDE.md é exatamente
-- isso: eles SEMPRE divergem. Aqui fica só `feito_em`: nulo é não feito, e a
-- data é a própria marca. Não há estado possível em que os dois se
-- contradigam, porque não há dois.
--
-- Mesma lógica em `inicio`/`prazo`: não são "data" e "data por extenso", são
-- duas pontas de um intervalo. "13/10 a 24/10" ocupa as duas; "até 25/10"
-- ocupa só o fim; "a partir de 30/10" ocupa só o começo e deixa o fim nulo,
-- porque o plano realmente não diz quando aquilo acaba. Inventar um fim ali
-- seria preencher silêncio com chute.
--
-- ── Os avisos, e os dois que eu NÃO consigo dar ────────────────────────────
--
-- A seção 11 fecha com uma regra de decisão literal, de duas pernas:
--
--   "se em dez/26 o lucro estiver abaixo de R$ 10 mil/mês, o aumento de custo
--    fixo espera; se o ROAS ficar abaixo de 1,5x por duas semanas, a verba
--    volta ao nível de agosto"
--
-- A segunda perna é medível HOJE, e é por pouco: o ROAS dos últimos 14 dias
-- está em 1,514x — catorze milésimos acima do gatilho. Esse aviso nasce
-- ligado e já quase disparando.
--
-- A primeira não é, e o motivo está registrado para quem vier depois: a
-- fórmula de lucro mora no TypeScript do OverviewPage, não no banco. Escrevê-la
-- aqui criaria a SEGUNDA definição de lucro do projeto — armadilha 1 de novo,
-- agora na variável que mais importa. Fica para a migração seguinte, que move
-- a fórmula para o SQL de uma vez e faz as duas telas lerem a mesma.
--
-- O portão do Natal ("sem Natal acima de 1,6x não se escala verba na BF")
-- também não vira aviso: a campanha de Natal ainda não existe. Os dois ficam
-- gravados em `plano_regras` com a condição escrita, marcados como manuais,
-- em vez de sumirem da tela. Sumir é o que faz uma regra virar ficção.
--
-- ── A décima primeira linha que não era meta ───────────────────────────────
--
-- `clientes_unicos_90d` entrou no catálogo com a medição mas sem alvo nenhum,
-- porque a tabela do plano tem dez indicadores e diz isso na primeira linha:
-- "Dez indicadores bastam". Na tela ela aparecia como uma meta com travessão
-- nas três colunas de prazo — ruído com cara de pendência. Ela não é meta, é
-- o denominador da recompra. Agora diz isso de si mesma.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. O indicador de apoio para de se passar por meta
-- ───────────────────────────────────────────────────────────────────────────
alter table public.metas_kpi
  add column if not exists e_meta boolean not null default true;

comment on column public.metas_kpi.e_meta is
  'Falso para indicador que existe so para dar contexto e nao tem alvo no '
  'plano. A tabela da secao 11 tem DEZ indicadores e diz "dez indicadores '
  'bastam"; o decimo primeiro aqui e denominador de outro, nao meta.';

update public.metas_kpi set e_meta = false where chave = 'clientes_unicos_90d';

-- Quando o alvo foi medido. Sem isto nao da para dizer se uma meta esta
-- atrasada: "40% do caminho" so quer dizer algo comparado com quanto do
-- TEMPO ja passou, e o tempo conta a partir da data da linha de base.
alter table public.metas
  add column if not exists base_em date not null default date '2026-10-10';

comment on column public.metas.base_em is
  'Data em que valor_base foi medido — 10/10/2026, a data do plano. E o '
  'inicio da regua: o quanto do caminho andou so significa algo ao lado do '
  'quanto do prazo passou.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. As ações com data
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.plano_acoes (
  id            uuid primary key default gen_random_uuid(),
  bloco         text not null check (bloco in ('ganho_rapido','calendario','mini_lancamento')),
  titulo        text not null,
  detalhe       text,
  inicio        date,
  prazo         date,
  -- NULO = nao feito. Um campo so, de proposito: ver o cabecalho.
  feito_em      timestamptz,
  secao         integer references public.plano_secoes(numero),
  ordem         integer not null default 100,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint plano_acoes_tem_data check (inicio is not null or prazo is not null),
  constraint plano_acoes_ordem_das_datas check (inicio is null or prazo is null or inicio <= prazo)
);

comment on table public.plano_acoes is
  'As acoes com data do "Plano de crescimento Out/26 a Jul/27": ganhos '
  'rapidos (secao 3), calendario de Natal e Black Friday (secao 4) e mini '
  'lancamentos mensais (secao 6).';

comment on column public.plano_acoes.feito_em is
  'NULO = nao feito. Nao existe um booleano ao lado de proposito: dois campos '
  'dizendo a mesma coisa sempre divergem (armadilha 1 do CLAUDE.md).';

comment on column public.plano_acoes.prazo is
  'Fim do intervalo. NULO quando o plano diz "a partir de X" e realmente nao '
  'da um fim — inventar um seria preencher silencio com chute.';

alter table public.plano_acoes enable row level security;
drop policy if exists plano_acoes_admin on public.plano_acoes;
create policy plano_acoes_admin on public.plano_acoes
  for all to authenticated using (true) with check (true);

create unique index if not exists plano_acoes_titulo_unico
  on public.plano_acoes (bloco, lower(btrim(titulo)));
create index if not exists plano_acoes_por_prazo
  on public.plano_acoes (prazo) where feito_em is null;

drop trigger if exists trg_plano_acoes_atualizado on public.plano_acoes;
create trigger trg_plano_acoes_atualizado before update on public.plano_acoes
  for each row execute function public.fn_marca_atualizado_em();

-- ── Ganhos rápidos (seção 3), todos vencendo em 25/10 ──────────────────────
-- Os tres com feito_em preenchido sao os que o documento marca com [x].
insert into public.plano_acoes (bloco, titulo, detalhe, prazo, feito_em, secao, ordem) values
  ('ganho_rapido', 'Regularizar a conta de anúncio "Saponaria"',
   'Período de carência no Meta. Se ela cai, cai a VSL que mais fatura.',
   date '2026-10-25', timestamptz '2026-10-10 00:00-03', 3, 10),

  ('ganho_rapido', 'Turbinar a recuperação que já existe',
   'A automação de WhatsApp e Voxuy trouxe R$ 4,8 mil em setembro, ~9% dos R$ 53 mil em Pix pendente. Subir para 15–20% (+R$ 3–6 mil/mês): mais um toque em 24 h, e-mail com o QR code de novo e mensagem com o nome do produto.',
   date '2026-10-25', null, 3, 20),

  ('ganho_rapido', 'Cartão recusado vira Pix',
   'Mensagem automática com link de Pix do mesmo pedido. Foram 290 recusas em setembro, R$ 31 mil.',
   date '2026-10-25', null, 3, 30),

  ('ganho_rapido', 'Cortar o que está abaixo de 1,35x',
   'Saponaria TSL (1,17x) e Escala VSL (1,00x). Mover a verba, em degraus de 20–25%, para Guias professoras (1,98x) e Escala Lembrancinha (2,87x).',
   date '2026-10-25', timestamptz '2026-10-10 00:00-03', 3, 40),

  ('ganho_rapido', 'Telefone obrigatório no checkout e no primeiro acesso',
   'Hoje só 25% da base tem WhatsApp, e todo o plano de pós-venda depende disso.',
   date '2026-10-25', timestamptz '2026-10-10 00:00-03', 3, 50),

  ('ganho_rapido', 'Bump entregue onde é usado',
   'O livro digital aparece dentro da aula a que ele se refere (ex.: "Embalagens que Encantam" na aula de embalagem), mais um e-mail no dia 2: "você tem 3 bônus esperando".',
   date '2026-10-25', null, 3, 60),

  ('ganho_rapido', 'Handify Completo de volta no ar',
   'Push + e-mail para quem tem 2 ou mais cursos, e banner fixo na área. Já existe a campanha plano-completo-2026-09, reaproveitar.',
   date '2026-10-25', null, 3, 70),

  ('ganho_rapido', 'Arrumar o financeiro',
   'Recategorizar a retirada de R$ 3.000 que caiu em "Hospedagem" e zerar os 68 pendentes, para o DRE de outubro sair confiável.',
   date '2026-10-25', null, 3, 80),

  ('ganho_rapido', 'UTM em todos os links próprios',
   'Em setembro, R$ 24,6 mil chegaram sem UTM. Padronizar o utm_medium (recuperacao, suporte, interno, bio, email) e levar o src dos e-mails de recuperação (PRIMEIRACOMPRA, ULTIMACHANCE) para o dash; sem isso não dá para medir o que este plano promete.',
   date '2026-10-25', null, 3, 90),

  ('ganho_rapido', 'Não religar o Crossell em massa',
   'Os 3.074 contatos parados são compradoras antigas; disparar tudo de uma vez arrisca bloqueio do número, e a oferta convertia 1 em 189. Limpar a fila e trocar a oferta (Handify Completo ou Workshop Primeira Venda) dentro da régua da seção 5.',
   date '2026-10-25', null, 3, 100),

  ('ganho_rapido', 'Recuperação também no fim de semana',
   '2º toque em 2–4 h (Pix copia e cola + prova social) em vez de 1 dia útil depois. Em agosto, sábado e domingo somaram 33% das vendas.',
   date '2026-10-25', null, 3, 110),

  ('ganho_rapido', 'Botão "me lembra no dia do pagamento"',
   'Quem responde que recebe no 5º dia útil ganha um lembrete agendado, em vez de virar lead perdido.',
   date '2026-10-25', null, 3, 120),

  ('ganho_rapido', 'Confiança antes do Pix',
   'CNPJ, link da página de compra segura e nome do recebedor no checkout e na 1ª mensagem de recuperação. O medo de golpe aparece em dezenas de conversas.',
   date '2026-10-25', null, 3, 130),

  ('ganho_rapido', 'Checkout com total claro',
   'Bumps desmarcados por padrão e o total a pagar visível antes do botão, para acabar com o "esperava R$ 67 e paguei R$ 208".',
   date '2026-10-25', null, 3, 140),

  ('ganho_rapido', 'Lina (IA) fora do horário',
   'Cobrir 7h–9h, noite e domingo para acesso, app e dúvidas de compra; e tag de motivo em todo pedido de reembolso.',
   date '2026-10-25', null, 3, 150)
on conflict do nothing;

-- ── Calendário de Natal e Black Friday (seção 4) ───────────────────────────
-- Sete passos, como o plano os numera. O passo 5 carrega três datas no
-- detalhe em vez de virar três linhas: quebrar mudaria a contagem dela.
insert into public.plano_acoes (bloco, titulo, detalhe, inicio, prazo, secao, ordem) values
  ('calendario', 'Gravar as 6 aulas de Natal, página TSL e 10 criativos',
   'Vela árvore, vila/maquete natalina, potinho decorado, bola de Natal, globo e vela drink com chantilly. Cada aula fecha com custo, preço sugerido e como fotografar para vender.',
   date '2026-10-13', date '2026-10-24', 4, 10),

  ('calendario', 'Mini lançamento do Natal para a base',
   'Preço de lançamento, 3 dias. Valida a oferta antes de pagar tráfego. Entrada R$ 37–47; bumps: Kit Natal Artesanal, embalagens de Natal e Calendário de encomendas de dezembro.',
   date '2026-10-27', date '2026-10-29', 4, 20),

  ('calendario', 'Natal no tráfego frio',
   'Subindo verba em degraus de 20–25%. O plano não dá data de fim para esta etapa.',
   date '2026-10-30', null, 4, 30),

  ('calendario', 'Captação da lista VIP da Black Friday',
   'Grupo/lista de WhatsApp e push.',
   date '2026-11-03', date '2026-11-19', 4, 40),

  ('calendario', 'Black Friday',
   '20/11 abertura antecipada para a lista VIP · 27/11 Black Friday · 30/11 último dia (Cyber Monday). Oferta principal: Handify Completo anual pelo menor preço do ano (ex.: R$ 197 contra R$ 297–369), com o curso de Natal e as ferramentas. Meta: 250–300 vendas do Completo (R$ 50–60 mil) só na base. Tráfego: só remarketing e públicos de compradoras; frio apenas acima de 1,8x.',
   date '2026-11-20', date '2026-11-30', 4, 50),

  ('calendario', '"Ainda dá tempo de produzir para o Natal"',
   'Última chamada.',
   date '2026-12-01', date '2026-12-15', 4, 60),

  ('calendario', 'Cortar tráfego frio e virar para janeiro',
   'Meta de renda 2027, planejamento do ano. O plano não dá data de fim para esta etapa.',
   date '2026-12-16', null, 4, 70)
on conflict do nothing;

-- ── Mini lançamentos, um por mês (seção 6) ─────────────────────────────────
insert into public.plano_acoes (bloco, titulo, detalhe, inicio, prazo, secao, ordem) values
  ('mini_lancamento', 'Nov: Velas de Natal',
   'É o mesmo lançamento do passo 2 do calendário (27 a 29/10) — está nos dois lugares porque o plano o lista nos dois, e não são dois lançamentos.',
   date '2026-11-01', date '2026-11-30', 6, 10),
  ('mini_lancamento', 'Dez: última chamada de Natal + kit de embalagens',
   null, date '2026-12-01', date '2026-12-31', 6, 20),
  ('mini_lancamento', 'Jan: Meta de renda 2027',
   'Planejamento e precificação. Usa a ferramenta que já existe.',
   date '2027-01-01', date '2027-01-31', 6, 30),
  ('mini_lancamento', 'Fev: lembrancinhas para batizado, chá e aniversário',
   'Encomenda o ano todo.', date '2027-02-01', date '2027-02-28', 6, 40),
  ('mini_lancamento', 'Mar: kit autocuidado do Dia da Mulher',
   null, date '2027-03-01', date '2027-03-31', 6, 50),
  ('mini_lancamento', 'Abr–Mai: Dia das Mães',
   'A melhor data do nicho. Buquê refeito + kit presente.',
   date '2027-04-01', date '2027-05-31', 6, 60),
  ('mini_lancamento', 'Jun: Dia dos Namorados',
   null, date '2027-06-01', date '2027-06-30', 6, 70),
  ('mini_lancamento', 'Jul: Dia dos Pais',
   'Sabonete masculino, barbatimão, escalda-pés.',
   date '2027-07-01', date '2027-07-31', 6, 80)
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. As regras de decisão do plano, inclusive as que ainda não automatizam
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.plano_regras (
  chave        text primary key,
  titulo       text not null,
  condicao     text not null,
  consequencia text not null,
  automatica   boolean not null default false,
  porque_nao   text,
  secao        integer references public.plano_secoes(numero),
  ordem        integer not null default 100,
  constraint plano_regras_manual_explica
    check (automatica or porque_nao is not null)
);

comment on table public.plano_regras is
  'As regras de decisao escritas no plano. A que o painel ainda nao mede fica '
  'aqui com porque_nao preenchido, em vez de sumir: regra que some da tela '
  'vira ficcao, que e a segunda armadilha do CLAUDE.md.';

comment on column public.plano_regras.porque_nao is
  'Obrigatorio quando automatica = false, pela restricao. Forca quem deixou '
  'manual a dizer o que falta, em vez de deixar a lacuna sem dono.';

alter table public.plano_regras enable row level security;
drop policy if exists plano_regras_admin on public.plano_regras;
create policy plano_regras_admin on public.plano_regras
  for all to authenticated using (true) with check (true);

insert into public.plano_regras (chave, titulo, condicao, consequencia, automatica, porque_nao, secao, ordem) values
  ('roas_duas_semanas',
   'ROAS abaixo de 1,5x por duas semanas',
   'ROAS dos últimos 14 dias < 1,50x',
   'A verba volta ao nível de agosto até a oferta nova estar no ar.',
   true, null, 11, 10),

  ('lucro_dezembro',
   'Lucro de dezembro abaixo de R$ 10 mil',
   'Lucro líquido de dez/26 < R$ 10 mil/mês',
   'O aumento de custo fixo (pessoa de CRM e de conteúdo) espera.',
   false,
   'A fórmula de lucro mora no TypeScript do OverviewPage, não no banco. '
   'Escrevê-la aqui criaria a segunda definição de lucro do projeto. Sai '
   'automática quando a fórmula virar SQL e as duas telas lerem a mesma.',
   11, 20),

  ('portao_natal',
   'Portão do Natal para a Black Friday',
   'Natal rodando acima de 1,6x de ROAS',
   'Sem isso, não se escala verba na Black Friday.',
   false,
   'A campanha de Natal ainda não existe — as aulas são gravadas entre 13 e '
   '24/10. Vira automática quando a conta de anúncio dela aparecer.',
   10, 30)
on conflict (chave) do update set
  titulo = excluded.titulo, condicao = excluded.condicao,
  consequencia = excluded.consequencia, automatica = excluded.automatica,
  porque_nao = excluded.porque_nao;

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Os avisos
-- ───────────────────────────────────────────────────────────────────────────
-- Mesma assinatura das outras funcoes de alerta do painel
-- (codigo, severidade, titulo, detalhe), e o mesmo vocabulario de
-- severidade — 'critico' | 'atencao' — que IngestStatusBanner e
-- SaudeSistema ja sabem pintar.
create or replace function public.fn_metas_alertas(p_empresa uuid default null)
 returns table (codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- 1. Ação do plano que passou do prazo e não foi marcada como feita.
  select 'acao_vencida'::text,
         'critico'::text,
         count(*)::text || ' ação(ões) do plano venceram',
         string_agg(titulo || ' (' || to_char(prazo, 'DD/MM') || ')', ' · '
                    order by prazo)
    from public.plano_acoes
   where feito_em is null and prazo is not null and prazo < current_date
  having count(*) > 0

  union all

  -- 2. Ação vencendo nos próximos 7 dias.
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

  -- 3. A regra de decisão do plano, perna do ROAS. Literal: "se o ROAS ficar
  --    abaixo de 1,5x por duas semanas, a verba volta ao nível de agosto".
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

  -- 4. Meta automática andando mais devagar que o relógio.
  --
  --    A comparação que importa não é "quanto falta para o alvo" e sim
  --    "quanto do caminho andou contra quanto do prazo passou". Sem isso,
  --    uma meta de jul/27 parece fracasso em outubro só porque faltam nove
  --    meses — que foi exatamente o que deixou a primeira tela confusa.
  --
  --    A folga de 15 pontos existe porque quase nada cresce em linha reta:
  --    régua de pós-venda e mini lançamento rendem em degrau, não por dia.
  select 'meta_atrasada'::text,
         'atencao'::text,
         count(*)::text || ' meta(s) andando mais devagar que o prazo',
         string_agg(nome || ': ' || round(caminho * 100) || '% do caminho com '
                    || round(tempo * 100) || '% do prazo', ' · '
                    order by (tempo - caminho) desc)
    from (
      select k.nome,
             (med.valor - m.valor_base) / nullif(m.valor_alvo - m.valor_base, 0) as caminho,
             (current_date - m.base_em)::numeric
               / nullif((m.prazo - m.base_em)::numeric, 0)                       as tempo
        from public.metas m
        join public.metas_kpi k on k.chave = m.kpi
        join lateral public.fn_metas_medir(p_empresa) med on med.kpi = m.kpi
       where k.automatico
         and k.e_meta
         and m.valor_base is not null
         and med.valor is not null
         and m.prazo > current_date
         and m.base_em < current_date
         -- Só o próximo prazo de cada indicador: cobrar jul/27 em outubro
         -- não é atraso, é calendário.
         and m.prazo = (select min(m2.prazo) from public.metas m2
                         where m2.kpi = m.kpi and m2.prazo > current_date)
    ) q
   where caminho is not null and tempo is not null
     and caminho < tempo - 0.15
  having count(*) > 0;
$function$;

comment on function public.fn_metas_alertas(uuid) is
  'Os avisos do plano de crescimento: acao vencida, acao vencendo, a regra do '
  'ROAS de duas semanas e meta andando mais devagar que o prazo. As duas '
  'regras que o painel ainda NAO mede estao em plano_regras com o motivo.';

revoke all on function public.fn_metas_alertas(uuid) from public, anon;
grant execute on function public.fn_metas_alertas(uuid) to authenticated, service_role;

-- Brecha de lado, achada pelo advisor do Supabase enquanto isto era escrito:
-- fn_alerta_cron_falhando e SECURITY DEFINER, nao tem guarda no corpo e o
-- anon podia chama-la. Hoje devolve vazio so porque nenhum cron esta
-- falhando; no dia em que um falhar, ela entrega o nome da tarefa e 140
-- caracteres da mensagem de erro para quem tiver a chave publica.
revoke all on function public.fn_alerta_cron_falhando() from public, anon;
grant execute on function public.fn_alerta_cron_falhando() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_roas  numeric;
begin
  -- 1. As 30 acoes do plano entraram, nos tres blocos.
  select count(*) into v_n from public.plano_acoes;
  if v_n <> 30 then
    v_erros := v_erros || format('%s acoes, esperava 30. ', v_n);
  end if;
  select count(*) into v_n from public.plano_acoes where bloco = 'ganho_rapido';
  if v_n <> 15 then v_erros := v_erros || format('%s ganhos rapidos, esperava 15. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where bloco = 'calendario';
  if v_n <> 7  then v_erros := v_erros || format('%s passos de calendario, esperava 7. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where bloco = 'mini_lancamento';
  if v_n <> 8  then v_erros := v_erros || format('%s mini lancamentos, esperava 8. ', v_n); end if;

  -- 2. Os tres [x] do documento chegaram marcados, e so eles.
  select count(*) into v_n from public.plano_acoes where feito_em is not null;
  if v_n <> 3 then
    v_erros := v_erros || format('%s acoes marcadas como feitas, esperava 3. ', v_n);
  end if;

  -- 3. Nao existe acao sem data nenhuma. A restricao ja garante, mas a prova
  --    pega o caso de alguem afrouxar a restricao depois.
  select count(*) into v_n from public.plano_acoes
   where inicio is null and prazo is null;
  if v_n > 0 then
    v_erros := v_erros || format('%s acao(oes) sem data. ', v_n);
  end if;

  -- 4. Toda secao citada tem titulo.
  select count(*) into v_n from public.plano_acoes a
   where a.secao is not null
     and not exists (select 1 from public.plano_secoes s where s.numero = a.secao);
  if v_n > 0 then
    v_erros := v_erros || format('%s acao(oes) apontam para secao inexistente. ', v_n);
  end if;

  -- 5. Toda regra manual explica o que falta — e a restricao que impede a
  --    regra de virar linha morta.
  select count(*) into v_n from public.plano_regras
   where not automatica and porque_nao is null;
  if v_n > 0 then
    v_erros := v_erros || format('%s regra(s) manuais sem motivo. ', v_n);
  end if;
  select count(*) into v_n from public.plano_regras;
  if v_n <> 3 then v_erros := v_erros || format('%s regras, esperava 3. ', v_n); end if;

  -- 6. A funcao de aviso roda e nao esta aberta ao anon.
  perform * from public.fn_metas_alertas(null);
  if has_function_privilege('anon', 'public.fn_metas_alertas(uuid)', 'execute') then
    v_erros := v_erros || 'anon consegue executar fn_metas_alertas. ';
  end if;
  if has_function_privilege('anon', 'public.fn_alerta_cron_falhando()', 'execute') then
    v_erros := v_erros || 'anon ainda consegue executar fn_alerta_cron_falhando. ';
  end if;

  -- 7. O aviso do ROAS concorda com a conta feita na mao. E a regra de leitura
  --    do CLAUDE.md: conferir contra uma segunda fonte antes de confiar.
  select sum(faturamento_bruto) / nullif(sum(investimento_meta), 0)
    into v_roas
    from public.vw_faturamento_liquido
   where data >= current_date - 14 and data < current_date;

  if v_roas < 1.50 and not exists (
       select 1 from public.fn_metas_alertas(null) where codigo = 'roas_duas_semanas') then
    v_erros := v_erros || format('ROAS de 14d e %s mas o aviso nao disparou. ', round(v_roas,3));
  end if;
  if v_roas >= 1.50 and exists (
       select 1 from public.fn_metas_alertas(null) where codigo = 'roas_duas_semanas') then
    v_erros := v_erros || format('ROAS de 14d e %s mas o aviso disparou. ', round(v_roas,3));
  end if;

  -- 8. O indicador de apoio parou de se passar por meta, e as dez metas de
  --    verdade continuam dez.
  select count(*) into v_n from public.metas_kpi where e_meta;
  if v_n <> 10 then
    v_erros := v_erros || format('%s indicadores marcados como meta, esperava 10. ', v_n);
  end if;
  select count(*) into v_n from public.metas_kpi k
   where k.e_meta and not exists (select 1 from public.metas m where m.kpi = k.chave);
  if v_n > 0 then
    v_erros := v_erros || format('%s meta(s) sem nenhum alvo cadastrado. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % acoes (% feitas), % regras (% automaticas), ROAS de 14d em %x, % avisos agora.',
    (select count(*) from public.plano_acoes),
    (select count(*) from public.plano_acoes where feito_em is not null),
    (select count(*) from public.plano_regras),
    (select count(*) from public.plano_regras where automatica),
    round(v_roas, 3),
    (select count(*) from public.fn_metas_alertas(null));
end $prova$;

notify pgrst, 'reload schema';
