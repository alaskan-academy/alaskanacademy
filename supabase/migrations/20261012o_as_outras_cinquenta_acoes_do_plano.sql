-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ As outras cinquenta ações do plano                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `20261012l` carregou 30 ações e eu disse que eram "as ações com data do
-- plano". Estava certo e era pouco: ela leu o painel e respondeu que "tem
-- várias coisas para fazer que não foram listadas no dash".
--
-- Tem. Eu filtrei por DATA ESCRITA, e as seções 3, 4 e 6 são as únicas que
-- escrevem data em cada linha. As seções 1, 5, 7 e 8 dizem o que fazer em
-- prosa, e eu tratei prosa como descrição em vez de tarefa. Relendo seção
-- por seção, são mais cinquenta:
--
--   seção 1 · recuperação   8   o que o Voxuy mostra, e as 3 mudanças de
--                               maior retorno do diagnóstico de 09/09
--   seção 5 · pós-venda    18   a régua D0–D30 inteira e mais nove frentes
--   seção 6 · captação      4   ferramentas como isca, roteiro do lançamento
--   seção 7 · produtos     11   os três degraus do físico, Saponaria, Buquê
--   seção 8 · canais        9   conteúdo, TikTok, app, presencial
--
-- ── Duas mudanças de forma, e o porquê de cada uma ────────────────────────
--
-- 1. A RESTRIÇÃO DE DATA CAI. `plano_acoes_tem_data` exigia início ou prazo,
--    e foi escrita quando só havia ações datadas. Metade das novas não tem
--    data no documento — "Degrau 3: avaliar estoque próprio" acontece
--    "depois de ~500 kits/mês", que é condição e não calendário.
--
--    A saída errada seria um campo `quando text` ao lado das datas: dois
--    campos dizendo quando, divergindo na primeira edição. A saída certa é
--    deixar a data nula e dizer na tela que o plano não deu uma. Saber quais
--    compromissos não têm prazo É informação — são justamente os que somem.
--
-- 2. NASCE `parte_de`. O diagnóstico de recuperação lista três mudanças e o
--    plano diz, literalmente, que elas "entram nos ganhos rápidos". Soltas,
--    elas e o ganho rápido "Turbinar a recuperação" marcariam a mesma
--    conclusão em dois lugares — armadilha 1 em forma de checklist, com o
--    estado impossível de o pai estar feito e os filhos não.
--
--    Com `parte_de` a relação fica explícita e a tela aninha. O pai NÃO é
--    marcado automaticamente pelos filhos: isso seria espelho precisando de
--    gatilho (armadilha 4). A tela mostra "2 de 3 partes" ao lado do pai, e
--    a contradição fica visível em vez de resolvida por mágica.
--
-- ── O que continua fora, e de propósito ───────────────────────────────────
--
-- Os doze achados de "O que os dados mostram" e os sete temas de "O que as
-- clientes dizem" NÃO viram ação. São diagnóstico: "a vitrine não vende" é a
-- razão da ação "vídeo de vendas nos 23 cursos", não uma segunda tarefa.
-- Transformar observação em tarefa dobraria a lista e faria a pessoa marcar
-- como feito um fato sobre o mundo.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 0. O bloco sai do CHECK e vira tabela
-- ───────────────────────────────────────────────────────────────────────────
-- `plano_acoes.bloco` nasceu com `check (bloco in ('ganho_rapido',
-- 'calendario','mini_lancamento'))`, e a primeira linha de `recuperacao`
-- bateu nele. O conserto preguiçoso seria acrescentar cinco nomes ao CHECK.
--
-- Mas um CHECK com lista escrita dentro É lista fixa no código, que é a
-- terceira armadilha do CLAUDE.md — a mesma que escondeu R$ 10.065 no DRE.
-- E eu tinha repetido o erro do outro lado: `PrazosPage.tsx` carregava um
-- array `BLOCOS` com o título e o subtítulo de cada um. Dois lugares com a
-- mesma lista, nenhum dos dois sabendo do outro.
--
-- Vira tabela. A tela passa a ler daqui, e bloco novo aparece sozinho.
create table if not exists public.plano_blocos (
  chave     text primary key,
  titulo    text not null,
  subtitulo text,
  ordem     integer not null default 100
);

comment on table public.plano_blocos is
  'Os grupos em que o plano organiza suas acoes. Existe como TABELA e nao '
  'como check nem como array no .tsx: lista fixa no codigo envelhece em '
  'silencio (armadilha 3 do CLAUDE.md), e esta ja tinha envelhecido duas '
  'vezes — no CHECK e no PrazosPage.';

alter table public.plano_blocos enable row level security;
drop policy if exists plano_blocos_admin on public.plano_blocos;
create policy plano_blocos_admin on public.plano_blocos
  for all to authenticated using (true) with check (true);

insert into public.plano_blocos (chave, titulo, subtitulo, ordem) values
  ('ganho_rapido', 'Ganhos rápidos',
   'Ações de poucos dias que destravam caixa antes da Black Friday. Juntas, o plano estima R$ 10–15 mil/mês de lucro sem gastar mais em anúncio.', 10),
  ('calendario', 'Natal e Black Friday',
   'Vender o Natal cedo para a artesã produzir até 15/12, e usar a Black Friday na base — o CPM da semana da BF é o mais caro do ano.', 20),
  ('recuperacao', 'Recuperação e Voxuy',
   'A recuperação funciona, mas só em dias úteis e com uma oferta única; o pós-venda está praticamente desligado, com 3.074 contatos parados numa fila.', 30),
  ('posvenda', 'Pós-venda e área de membros',
   'O ativo mais subaproveitado: 5,4 mil alunas, 42% ativas no mês, app instalado por 30%. O objetivo é levar o LTV de R$ 94 para R$ 150 até jul/27.', 40),
  ('mini_lancamento', 'Mini lançamentos',
   'Um por mês, amarrado à data que a artesã vende. Aviso 7 dias antes, abertura com preço de lançamento por 72 h, último dia, e depois o produto vira bump ou entra no Completo.', 50),
  ('captacao', 'Captação própria',
   'Ferramentas gratuitas e aula gratuita captando cadastro com WhatsApp, por uma fração do custo de uma venda.', 60),
  ('produto', 'Produtos',
   'Refazer o Saponaria (56% da receita) antes de qualquer produto novo grande, e entrar no físico sem estoque próprio, via parceiro.', 70),
  ('canal', 'Canais',
   'O orgânico aqui não é para vender direto: é para encher a lista que depois compra por e-mail e WhatsApp, a custo quase zero.', 80)
on conflict (chave) do update set
  titulo = excluded.titulo, subtitulo = excluded.subtitulo, ordem = excluded.ordem;

alter table public.plano_acoes drop constraint if exists plano_acoes_bloco_check;
alter table public.plano_acoes drop constraint if exists plano_acoes_bloco_fkey;
alter table public.plano_acoes
  add constraint plano_acoes_bloco_fkey
  foreign key (bloco) references public.plano_blocos(chave);

comment on column public.plano_acoes.bloco is
  'Em que lista do plano a acao aparece. NAO e o mesmo que `secao` (de onde '
  'no documento ela vem) nem que o objetivo a que ela serve: a secao 6 tem '
  'duas listas, mini lancamentos e captacao, e um ganho rapido da secao 3 '
  'pode servir a alavanca do ROAS.';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. A tabela aceita ação sem data e ação que é parte de outra
-- ───────────────────────────────────────────────────────────────────────────
alter table public.plano_acoes
  drop constraint if exists plano_acoes_tem_data;

comment on column public.plano_acoes.inicio is
  'Comeco do intervalo. NULO quando o plano nao da data — e metade das acoes '
  'das secoes 5, 7 e 8 nao da. Nulo aqui e informacao: diz quais compromissos '
  'do plano nasceram sem prazo, que sao justamente os que somem.';

alter table public.plano_acoes
  add column if not exists parte_de uuid references public.plano_acoes(id) on delete cascade;

comment on column public.plano_acoes.parte_de is
  'Quando esta acao e parte de outra. Existe porque o plano diz que as tres '
  'mudancas da recuperacao "entram nos ganhos rapidos": soltas, elas e o '
  'ganho rapido marcariam a mesma conclusao em dois lugares. O pai NAO e '
  'marcado pelos filhos — isso seria espelho precisando de gatilho.';

create index if not exists plano_acoes_por_pai on public.plano_acoes (parte_de)
  where parte_de is not null;

-- Uma ação não pode ser parte de si mesma. Não protege contra ciclo longo,
-- mas o caso real é o erro de digitação que cola o próprio id.
alter table public.plano_acoes
  drop constraint if exists plano_acoes_nao_e_parte_de_si;
alter table public.plano_acoes
  add constraint plano_acoes_nao_e_parte_de_si check (parte_de is null or parte_de <> id);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Seção 1 — o que o Voxuy mostra
-- ───────────────────────────────────────────────────────────────────────────
insert into public.plano_acoes (bloco, titulo, detalhe, inicio, prazo, secao, ordem) values
  ('recuperacao', 'Sequência depois do link na recuperação',
   'Uma das três mudanças de maior retorno do diagnóstico de 09/09/2026: +2 h "conseguiu abrir?" e +20 h "vale até hoje 23h59". As três juntas valem ~R$ 2,6 mil/mês líquido a mais, sobre uma margem atual de ~R$ 1,2 mil.',
   null, date '2026-10-25', 1, 10),

  ('recuperacao', 'Mensagem do link com produto, preço de/por e prazo',
   'Segunda das três mudanças de maior retorno: a informação vem ANTES do link, não depois.',
   null, date '2026-10-25', 1, 20),

  ('recuperacao', 'Carrinho com bump abandonado: oferecer só o curso por R$ 67',
   'Terceira das três mudanças de maior retorno, em vez de 20% sobre o pacote inteiro.',
   null, date '2026-10-25', 1, 30),

  ('recuperacao', 'Checar o gatilho da recuperação do Lembrancinha',
   'Só 519 entraram desde julho, 7 vezes menos que a Saponaria (3.681), embora o Lembrancinha venda cerca de um terço do volume. O gatilho provavelmente não pega todos os carrinhos.',
   null, null, 1, 40),

  ('recuperacao', 'Onboarding do Lembrancinha ganha sequência de primeira peça e de bônus',
   '629 envios, mas é só a mensagem de acesso: não há sequência nenhuma depois dela.',
   null, null, 1, 50),

  ('recuperacao', 'Configurar os dashboards do Voxuy',
   'Atendimento, vendas e CRM estão com zero widget configurado.',
   null, null, 1, 60),

  ('recuperacao', 'Ligar a automação do funil "Nutrição – Não compradores"',
   'O funil existe no CRM do Voxuy, mas sem nenhuma automação ligada nele.',
   null, null, 1, 70)
on conflict do nothing;

-- As três primeiras são partes do ganho rápido que o plano cita por nome.
update public.plano_acoes f
   set parte_de = p.id
  from public.plano_acoes p
 where p.titulo = 'Turbinar a recuperação que já existe'
   and f.bloco = 'recuperacao'
   and f.titulo in (
     'Sequência depois do link na recuperação',
     'Mensagem do link com produto, preço de/por e prazo',
     'Carrinho com bump abandonado: oferecer só o curso por R$ 67'
   );

insert into public.plano_acoes (bloco, titulo, detalhe, prazo, secao, ordem, parte_de)
select 'recuperacao', 'Tag de motivo em todo pedido de reembolso',
       'O roteiro de retenção já coleta o motivo na conversa; falta registrá-lo numa tag para virar relatório.',
       date '2026-10-25', 1, 80, p.id
  from public.plano_acoes p
 where p.titulo = 'Lina (IA) fora do horário'
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Seção 5 — pós-venda, dopamina e área de membros
-- ───────────────────────────────────────────────────────────────────────────
insert into public.plano_acoes (bloco, titulo, detalhe, inicio, prazo, secao, ordem) values
  ('posvenda', 'Régua de pós-venda no ar',
   'E-mail + WhatsApp + push, do D0 ao D30. O prazo 15/11 vem da tabela de vereditos da seção 9 ("Régua no ar até 15/11"). As oito mensagens estão como partes desta ação.',
   null, date '2026-11-15', 5, 10),

  ('posvenda', 'Vitória rápida no D0 em cada curso',
   'A primeira aula entrega uma peça pronta, não teoria. No Saponaria, 3.286 abrem e só 2.016 veem "Materiais e Fornecedores": a lista de compras trava a aluna antes de ela fazer algo.',
   date '2026-10-01', null, 5, 30),

  ('posvenda', 'Progresso visível: selo, certificado compartilhável e parede de conquistas',
   'Selo por módulo, certificado com compartilhamento no Instagram, "parede de conquistas" na Minha Jornada.',
   null, null, 5, 40),

  ('posvenda', 'Aluna destaque da semana em Inspirações',
   'O campo já existe no banco. Os posts "meu primeiro buquê" da comunidade são o melhor conteúdo que vocês têm.',
   null, null, 5, 50),

  ('posvenda', 'Push com ritmo: no máximo 2 por semana',
   'Lembrete de sequência ("3 dias sem praticar") e aviso de novidade. Hoje 1,8 mil alunas liberaram push.',
   null, null, 5, 60),

  ('posvenda', 'Aula "sua primeira venda" logo após a primeira peça',
   'No Lembrancinha, 701 alunas veem a aula 1 e só ~220 chegam ao módulo de vendas. A aula de vendas no fim do curso pega pouca gente; logo após a primeira peça pega a aluna motivada.',
   null, null, 5, 70),

  ('posvenda', 'Funil de aula gratuita dentro da área de membros',
   'O perfil "visitante" e as quatro ferramentas abertas já existem. Falta uma aula gratuita por nicho, cadastro, régua de 7 dias e oferta. No ar em nov, junto com a lista da BF.',
   date '2026-11-01', date '2026-11-30', 5, 80),

  ('posvenda', 'Vídeo de vendas nos 23 cursos da vitrine',
   '23 cursos e nenhum com vídeo. Um vídeo de 60–90 s por curso, com cortes dos criativos que já venceram, mais o preço de aluna. Meta: R$ 6–8 mil/mês vindos da vitrine, contra R$ 2,2 mil em setembro.',
   null, date '2026-12-31', 5, 90),

  ('posvenda', 'Comunidade com filtro: tags, busca, dúvidas fixadas e enquete',
   'Tags fixas: Insumos e fornecedores, Pavio, Essência e aroma, Defeitos e desmolde, Embalagem, Preço e vendas, Meu primeiro. Mais busca, as 10 dúvidas mais comuns fixadas e uma enquete mensal. As tags viram relatório de "o que elas querem comprar".',
   date '2026-11-01', date '2026-11-30', 5, 100),

  ('posvenda', 'Inspirações: 2 por semana agendados',
   'Hoje são 21 posts no total. O calendário editorial e a skill de conteúdo já existem. Cada post com push e um curso relacionado no rodapé.',
   date '2026-10-01', null, 5, 110)
on conflict do nothing;

-- As oito mensagens da régua, como partes dela.
insert into public.plano_acoes (bloco, titulo, detalhe, prazo, secao, ordem, parte_de)
select 'posvenda', v.titulo, v.objetivo, date '2026-11-15', 5, v.ordem, p.id
  from public.plano_acoes p,
       (values
         ('D0 — Boas-vindas + "sua primeira peça em 40 minutos"', 'Dopamina no primeiro dia', 11),
         ('D1 — "Você tem bônus esperando", com link direto para cada bump', 'Usar o que comprou, menos arrependimento', 12),
         ('D3 — "Poste sua primeira peça na comunidade"', 'Prova social e pertencimento', 13),
         ('D7 — Desafio de 7 dias concluído + selo', 'Hábito', 14),
         ('D10 — Primeira venda: Workshop Primeira Venda (R$ 29,90/mês)', 'Recorrência', 15),
         ('D14 — Handify Completo com desconto de aluna', 'Ticket alto', 16),
         ('D21 — Curso complementar do mesmo nicho (ex.: Saponaria → Embalagem Premium)', 'Recompra', 17),
         ('D30 — Pesquisa curta (3 perguntas)', 'Pauta de produto e conteúdo', 18)
       ) as v(titulo, objetivo, ordem)
 where p.titulo = 'Régua de pós-venda no ar'
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Seção 6 — captação própria
-- ───────────────────────────────────────────────────────────────────────────
insert into public.plano_acoes (bloco, titulo, detalhe, inicio, prazo, secao, ordem) values
  ('captacao', 'Calculadora de lucro e Meta de renda viram anúncios de cadastro',
   'Custo por lead em vez de custo por venda, e conteúdo orgânico ("descubra quanto você lucra por vela").',
   date '2026-11-01', date '2026-11-30', 6, 10),

  ('captacao', '"Deu problema?" vira página pública no site',
   'Responde as dúvidas do fórum e entra na busca do Google e do ChatGPT.',
   null, null, 6, 20),

  ('captacao', 'Todo cadastro pede WhatsApp',
   'Vale para as ferramentas gratuitas e para a aula gratuita: é lead com telefone por uma fração do custo de uma venda.',
   null, null, 6, 30),

  ('captacao', 'Roteiro padrão do mini lançamento',
   'Aviso 7 dias antes (lista de espera no WhatsApp), abertura com preço de lançamento por 72 h, último dia, e depois o produto vira bump ou entra no Completo. O produto entra na área já gravado com a skill de roteiro de aula.',
   null, null, 6, 40)
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Seção 7 — produtos
-- ───────────────────────────────────────────────────────────────────────────
insert into public.plano_acoes (bloco, titulo, detalhe, inicio, prazo, secao, ordem) values
  ('produto', 'Degrau 1 do físico: cupom e comissão com os 46 fornecedores',
   'Os fornecedores já cadastrados na área viram parceiros com cupom Handify e comissão por venda. Risco zero, e mede quantas alunas compram insumo por indicação de vocês.',
   date '2026-11-01', date '2026-12-31', 7, 10),

  ('produto', 'Verificar se a Payt e o contador comportam produto físico no CNPJ atual',
   'O plano manda verificar isto ANTES do degrau 2. Sem data escrita, mas é pré-requisito do kit de jan–mar/27.',
   null, null, 7, 20),

  ('produto', 'Degrau 2 do físico: Kit Primeira Fornada',
   'Bases, essências, corante, molde e embalagem para as 3 primeiras aulas, R$ 149–199, montado e despachado pelo parceiro. Teste em pré-venda de 300 kits para a base; depois como bump no checkout do Saponaria.',
   date '2027-01-01', date '2027-03-31', 7, 30),

  ('produto', 'Degrau 3 do físico: avaliar estoque próprio',
   'Só depois de ~500 kits/mês. Antes disso, frete, nota fiscal e troca custam mais do que a margem extra. É condição, não calendário — por isso sem data.',
   null, null, 7, 40),

  ('produto', 'Saponaria 2.0 — o curso',
   'Aula 1 de vitória rápida, lista de compras por orçamento (R$ 100 / R$ 200), fornecedor indicado em cada receita, aula de primeira venda no módulo 2. O Saponaria é 56% da receita, e o plano manda refazê-lo antes de qualquer produto novo grande.',
   date '2026-11-01', date '2027-01-31', 7, 50),

  ('produto', 'Saponaria 2.0 — a oferta "curso + kit em casa"',
   'Depende do degrau 2 do físico. Com garantia de primeira peça e suporte.',
   null, null, 7, 60),

  ('produto', 'Saponaria 2.0 — nova VSL com ângulo de renda e presente',
   'A VSL atual (1,50x) segue rodando enquanto a nova é testada. A TSL (1,17x) só volta com oferta nova.',
   null, null, 7, 70),

  ('produto', 'Workshop Buquê relançado para o Dia das Mães',
   'Hoje ROAS 1,0x com ticket de ~R$ 50: não paga o CAC. Relançar com ticket R$ 67–97 (buquê + embalagem premium + versões de Natal e Mães). Se não passar de 1,6x no teste, vira bump/upsell e sai do tráfego frio. A janela é a do mini lançamento de abr–mai/27.',
   date '2027-04-01', date '2027-05-31', 7, 80),

  ('produto', 'Fornecedores de insumo viram parceiros de co-marketing',
   'Cupom, kit com marca, e eles anunciam o curso para a base deles de clientes artesãs.',
   date '2026-11-01', date '2026-11-30', 7, 90),

  ('produto', 'Coprodução com grandes produtoras de artesanato',
   'O dash já tem campo de coprodução e houve oferta com a Laura Martins. Vocês entram com tráfego, funil e área de membros; elas com nome e conteúdo.',
   date '2027-01-01', null, 7, 100),

  ('produto', 'Escalar o nicho de especialistas de outros nichos',
   'O modelo da Helena (professoras) já tem a melhor campanha da conta: Guias TSL com 1,77x no teste e 1,98x na escala. Escalar esse nicho diversifica o risco de depender de velas e sabonetes.',
   null, null, 7, 110)
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Seção 8 — canais
-- ───────────────────────────────────────────────────────────────────────────
insert into public.plano_acoes (bloco, titulo, detalhe, inicio, prazo, secao, ordem) values
  ('canal', 'Pessoa dedicada a conteúdo',
   'Está no aumento de custo fixo previsto na seção 2 — e, pela regra de decisão, espera se o lucro de dez/26 ficar abaixo de R$ 10 mil/mês.',
   null, null, 8, 10),

  ('canal', '5 reels por semana',
   'Processo "satisfatório" (sabonete em camadas, desmolde, buquê montado), aluna destaque, antes e depois, bastidores. A skill de conteúdo da Handify já transforma uma gravação em todos os formatos.',
   date '2026-11-01', null, 8, 20),

  ('canal', 'Toda chamada leva a uma ferramenta ou aula gratuita, com cadastro',
   'O conteúdo orgânico aqui não é para vender direto: é para encher a lista que depois compra por e-mail e WhatsApp, a custo quase zero. O link da bio já trouxe R$ 9,5 mil em setembro (4% da receita); a meta é 8% em mar/27.',
   null, null, 8, 30),

  ('canal', 'TikTok orgânico',
   'Os mesmos vídeos do Instagram: vídeo de processo de vela e sabonete é um formato forte lá.',
   date '2026-11-01', date '2026-11-30', 8, 40),

  ('canal', 'TikTok Ads',
   'Só em janeiro, quando o leilão esfria depois do Natal: R$ 100–150/dia, os 3 criativos que mais venderam no Meta, mesma TSL. Julgar com a mesma régua (corte abaixo de 1,35x). A UTMify já lê TikTok.',
   date '2027-01-01', date '2027-01-31', 8, 50),

  ('canal', 'TikTok Shop',
   'Só quando o kit físico existir — degrau 2 da seção 7.',
   null, null, 8, 60),

  ('canal', 'Pedir a instalação do app no primeiro acesso e usar mais o push',
   'A área já é um app instalável: 30,5% das alunas instalaram e 1,8 mil aceitaram push. App nativo fica para quando o Completo passar de 2 mil assinantes.',
   null, null, 8, 70),

  ('canal', 'Aula ao vivo online, uma por mês, para alunas do Completo',
   'Atende mais gente que um evento presencial e não consome o mesmo tempo.',
   null, null, 8, 80),

  ('canal', 'Aula presencial em Joinville',
   '20–30 vagas a R$ 297–497 com material incluso, filmada para virar conteúdo e bônus do Completo. Antes do Dia das Mães. Evento maior só se o piloto esgotar.',
   date '2027-03-01', date '2027-04-30', 8, 90)
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
  -- 1. Oitenta acoes no total: as 30 datadas mais estas 50.
  select count(*) into v_n from public.plano_acoes;
  if v_n <> 80 then
    v_erros := v_erros || format('%s acoes, esperava 80. ', v_n);
  end if;

  -- 2. Cada bloco com a contagem que a releitura encontrou.
  select count(*) into v_n from public.plano_acoes where bloco = 'recuperacao';
  if v_n <> 8  then v_erros := v_erros || format('%s em recuperacao, esperava 8. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where bloco = 'posvenda';
  if v_n <> 18 then v_erros := v_erros || format('%s em posvenda, esperava 18. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where bloco = 'captacao';
  if v_n <> 4  then v_erros := v_erros || format('%s em captacao, esperava 4. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where bloco = 'produto';
  if v_n <> 11 then v_erros := v_erros || format('%s em produto, esperava 11. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where bloco = 'canal';
  if v_n <> 9  then v_erros := v_erros || format('%s em canal, esperava 9. ', v_n); end if;

  -- 3. As 30 originais nao foram tocadas, e as 3 feitas continuam 3.
  select count(*) into v_n from public.plano_acoes
   where bloco in ('ganho_rapido','calendario','mini_lancamento');
  if v_n <> 30 then v_erros := v_erros || format('%s acoes datadas, esperava 30. ', v_n); end if;
  select count(*) into v_n from public.plano_acoes where feito_em is not null;
  if v_n <> 3 then v_erros := v_erros || format('%s feitas, esperava 3. ', v_n); end if;

  -- 4. As partes acharam o pai. Se o UPDATE por titulo errasse o nome, elas
  --    ficariam soltas e voltariam a duplicar a conclusao do ganho rapido —
  --    que e exatamente o que parte_de veio evitar.
  select count(*) into v_n from public.plano_acoes where parte_de is not null;
  if v_n <> 12 then
    v_erros := v_erros || format('%s acoes com pai, esperava 12 (3 da recuperacao + 1 do reembolso + 8 da regua). ', v_n);
  end if;

  select count(*) into v_n from public.plano_acoes f
   join public.plano_acoes p on p.id = f.parte_de
   where p.titulo = 'Turbinar a recuperação que já existe';
  if v_n <> 3 then
    v_erros := v_erros || format('%s partes de "Turbinar a recuperacao", esperava 3. ', v_n);
  end if;

  select count(*) into v_n from public.plano_acoes f
   join public.plano_acoes p on p.id = f.parte_de
   where p.titulo = 'Régua de pós-venda no ar';
  if v_n <> 8 then
    v_erros := v_erros || format('%s dias na regua, esperava 8. ', v_n);
  end if;

  -- 5. Nenhuma parte aponta para outra parte: um nivel so, senao a tela
  --    precisaria de recursao que ninguem pediu.
  select count(*) into v_n from public.plano_acoes f
   join public.plano_acoes p on p.id = f.parte_de
   where p.parte_de is not null;
  if v_n > 0 then
    v_erros := v_erros || format('%s acao(oes) em terceiro nivel. ', v_n);
  end if;

  -- 6. Toda secao citada existe.
  select count(*) into v_n from public.plano_acoes a
   where a.secao is not null
     and not exists (select 1 from public.plano_secoes s where s.numero = a.secao);
  if v_n > 0 then
    v_erros := v_erros || format('%s acao(oes) apontam para secao inexistente. ', v_n);
  end if;

  -- 7. Intervalo invertido continua barrado pela restricao que ficou.
  select count(*) into v_n from public.plano_acoes
   where inicio is not null and prazo is not null and inicio > prazo;
  if v_n > 0 then
    v_erros := v_erros || format('%s acao(oes) comecam depois de acabar. ', v_n);
  end if;

  -- 8. O bloco virou tabela de verdade: todo bloco usado tem titulo, e nao
  --    sobrou nenhum cadastrado sem uso. Esta prova e o que impede a lista
  --    de voltar a envelhecer em silencio.
  select count(*) into v_n from public.plano_acoes a
   where not exists (select 1 from public.plano_blocos b where b.chave = a.bloco);
  if v_n > 0 then
    v_erros := v_erros || format('%s acao(oes) em bloco sem cadastro. ', v_n);
  end if;
  select count(*) into v_n from public.plano_blocos b
   where not exists (select 1 from public.plano_acoes a where a.bloco = b.chave);
  if v_n > 0 then
    v_erros := v_erros || format('%s bloco(s) cadastrados sem nenhuma acao. ', v_n);
  end if;

  -- 9. E o CHECK antigo sumiu. Se alguem recria-lo, a lista volta a existir
  --    em dois lugares.
  if exists (select 1 from pg_constraint
              where conrelid = 'public.plano_acoes'::regclass
                and conname = 'plano_acoes_bloco_check') then
    v_erros := v_erros || 'o check de bloco voltou: a lista esta em dois lugares. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % acoes em % blocos, % sem data no plano, % sao parte de outra.',
    (select count(*) from public.plano_acoes),
    (select count(distinct bloco) from public.plano_acoes),
    (select count(*) from public.plano_acoes where inicio is null and prazo is null),
    (select count(*) from public.plano_acoes where parte_de is not null);
end $prova$;

notify pgrst, 'reload schema';
