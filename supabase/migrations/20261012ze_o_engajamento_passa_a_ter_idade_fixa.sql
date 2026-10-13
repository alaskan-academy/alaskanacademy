-- O engajamento passa a ter idade fixa, e "aberto" passa a ser "concluido"
-- ============================================================================
--
-- Com o acesso de leitura ao Supabase da Area de Membros, os dois indicadores
-- que estavam "MANUAL / sem medicao" puderam enfim ser medidos. E medir
-- mostrou que um deles estava quebrado por desenho e o outro mede uma coisa
-- que nao consegue ver.
--
-- -- 1. "Alunas ativas em 30 dias" era um fluxo sobre um estoque -----------
--
-- A conta era: quem abriu aula nos ultimos 30 dias / todo perfil que ja
-- existiu. Hoje da 40,2% (2.212 de 5.501). O problema nao e o numero, e a
-- forma: numerador de JANELA, denominador CUMULATIVO.
--
-- A base se decompoe em duas populacoes com comportamentos opostos:
--
--     entrou nos ultimos 30 dias    82,3%  abre aula     peso 28,4%
--     ja tinha conta                23,5%  abre aula     peso 71,6%
--
-- E a identidade fecha na casa decimal:
--     23,5 + (82,3 - 23,5) * 0,284 = 40,2
--
-- Ou seja, o indicador e a media ponderada de duas taxas por um peso que cai
-- sozinho, porque a janela e fixa em 30 dias e a base e cumulativa. Congelando
-- AS DUAS taxas nos valores de hoje -- zero mudanca de comportamento, por
-- construcao -- e rodando a identidade sobre a base real de cada data:
--
--     31/07  82,1%        28/08  57,2%        25/09  46,1%
--     14/08  74,7%        11/09  49,8%        hoje   40,2%
--
-- Quarenta pontos de queda sem nada ter piorado. Projetando com a mesma
-- entrada: 37,4% em um mes, 32,9% em tres, 27,4% em doze. O destino e
-- convergir em 23,5% faca a Handify o que fizer.
--
-- Pior que a deriva: o INCENTIVO e invertido. Novata rende 82,3% e madura
-- 23,5%, entao o jeito mais rapido de subir o indicador e comprar trafego, e
-- o jeito mais rapido de derruba-lo e um mes bom de retencao sem anuncio. Ele
-- premia verba de midia e pune exatamente o que a Regua de recompra existe
-- para provar.
--
-- Foi assim que o defeito apareceu, e vale registrar: a migracao 20261012zd
-- anotou "42% medido hoje de manha" e a medicao da noite deu 40,2%. Os dois
-- numeros estao certos — nao sao duas leituras do mesmo valor, sao dois
-- pontos de um desabamento de 0,5 ponto a cada 16 horas. A desconfianca de um
-- numero que nao batia foi o que puxou o fio. Aquele arquivo fica como esta:
-- migracao aplicada registra o que de fato rodou.
--
-- E ainda havia a amplitude: trocando so o denominador por candidatos todos
-- defensaveis, o mesmo dia da de 23,5% a 48,0%. Um indicador que varia 24
-- pontos conforme a escolha de quem o escreve nao serve de serie historica.
--
-- Decisao dela, 12/10/2026, escolhendo entre tres caminhos: "trocar pelos dois
-- estaveis".
--
-- -- O que entra no lugar: idade fixa --------------------------------------
--
-- Duas perguntas diferentes, cada uma comparavel consigo mesma no tempo,
-- porque em ambas a IDADE da populacao nao muda de um mes para o outro:
--
--   ativacao_30d_pct    de quem fez conta nos ULTIMOS 30 dias, quantas
--                       abriram alguma aula. Hoje 82,3% (1.285/1.561).
--                       Ficou medida entre 78,4% e 82,3% o periodo inteiro.
--                       E APOIO, nao meta: responde "a porta de entrada
--                       funciona", esta perto do teto e nao e o que a Regua
--                       de recompra se propoe a mover.
--
--   retencao_30_60d_pct de quem fez conta entre 30 e 60 dias atras, quantas
--                       voltaram a abrir aula nos ultimos 30 dias. Hoje
--                       29,8% (504/1.690). E a META: nao sobe com verba de
--                       midia nem cai com o calendario, entao so se move se o
--                       comportamento se mover.
--
-- Por que a coorte 30-60d e nao a "madura" (23,5%): o pool "madura" tambem e
-- cumulativo e envelhece, entao derivaria para baixo sozinho pelo mesmo
-- motivo, so que mais devagar. A faixa de idade fixa e a unica das tres que
-- segura a variavel.
--
-- -- Os alvos da retencao sao DECISAO, nao medicao -------------------------
--
-- E preciso dizer isto com todas as letras, porque hoje mesmo dois alvos
-- tiveram de ser refeitos por terem nascido de medicao errada.
--
-- Aqui nao ha com o que ancorar: `lesson_progress` tem UNIQUE(user_id,
-- lesson_id) e sobrescreve `updated_at` a cada toque. Quem abriu em agosto e
-- voltou na mesma aula em outubro teve o carimbo de agosto APAGADO. Nao
-- existe passado para reconstruir, e por isso nao existe "melhor mes que a
-- casa ja fez" para mirar.
--
-- Entao 35 / 40 / 45 e a ambicao do plano dela transplantada: o plano pedia
-- +10 pontos ao longo do horizonte (45 -> 55), e estes mantem o mesmo passo
-- de +5 em +5 a partir do 29,8% medido. Quando a serie tiver tres meses, vale
-- rever contra o que a casa provou conseguir.
--
-- -- 2. "Bumps abertos": o instrumento nao enxerga o que o nome promete ----
--
-- Medido: 7,95% dos pares (compradora, curso) concedidos por bump tem alguma
-- linha de progresso. Mas para 94,5% do volume a palavra "aberto" NAO EXISTE
-- no banco:
--
--     course_type = 'material'   13 cursos, 16 aulas, 0 com video
--                                684 linhas de progresso
--                                0 com player andado, posicao maxima 0
--
-- Livro digital nao tem video, entao o player nunca grava nada. A unica coisa
-- que cria linha ali e a cliente clicar em "marcar como concluida". Quem
-- baixou o PDF e leu inteiro e, para este indicador, indistinguivel de quem
-- nunca entrou.
--
-- A prova de que o numero nao mede o BUMP: dentro do mesmo livro, quem veio
-- por bump abre quase igual a quem comprou direto (Difusores 8,0% x 6,3%,
-- Arte Floral 7,0% x 6,1%, Saboaria 6,2% x 3,5%). Se o bump fosse a variavel,
-- essa coluna separaria. No unico curso DE VERDADE vendido como bump, o sinal
-- aparece limpo e enorme: 21,6% x 68,1%. O que separa e o formato, nao o bump.
--
-- Decisao dela: "considere se alguma aula foi concluida". E mais honesto que
-- "tem linha de progresso", e pelo motivo certo: das 684 linhas de material,
-- 55 sao o checkbox DESMARCADO. Ter linha inclui quem clicou e desclicou;
-- concluir, nao.
--
--     tem linha de progresso ..... 601 / 7.561 = 7,95%
--     concluiu alguma aula ....... 549 / 7.561 = 7,26%   <- a regra nova
--     idem, so quem tem conta .... 549 / 6.366 = 8,62%
--
-- Os 1.195 pares sem conta FICAM no denominador: pagou e nunca entrou e
-- exatamente o que o indicador quer flagrar. Conferido que nao e falha de
-- casamento — 1.194 dos 1.195 tem convite emitido, a pessoa so nunca ativou.
--
-- Os alvos 25/35/40 continuam como ela os escreveu, e o arquivo registra o
-- problema em vez de escondê-lo: 25% esta acima do teto observado de TODOS os
-- 13 livros (o melhor e Embalagens com 15,6%, e so porque tem duas aulas em
-- vez de uma). Com a instrumentacao de hoje, subir este numero e convencer
-- mais gente a clicar num checkbox de PDF. Baixar o alvo por conta propria
-- seria rebaixar a ambicao dela; o que cabe aqui e deixar escrito que o alvo
-- so fica alcancavel quando a Area de Membros registrar abertura de verdade.
--
-- -- 3. Os tres sao carimbados, nao calculados -----------------------------
--
-- Os tres continuam `automatico = false`, e isso agora significa algo: eles
-- moram em `metas_medicao`, carimbados diariamente pela Edge Function
-- `membros-metricas` com `origem = 'area_membros'`. Nao sao manuais no
-- sentido de digitados — sao externos.
--
-- O carimbo diario nao e capricho: como `lesson_progress` sobrescreve
-- `updated_at`, a serie nao pode ser reconstruida para tras. Cada dia sem
-- carimbar e um dia que nao volta. Armadilha 4 do CLAUDE.md na forma mais
-- literal: carga inicial preenche o passado, gatilho mantem o presente — e
-- aqui nem passado ha.

begin;

-- -- 1. A chave velha sai, com as metas dela -------------------------------
delete from metas where kpi = 'alunas_ativas_30d_pct';
delete from metas_kpi where chave = 'alunas_ativas_30d_pct';

-- -- 2. As duas de idade fixa entram ---------------------------------------
insert into metas_kpi (chave, nome, unidade, direcao, automatico, e_meta, objetivo, ordem, observacao)
values
  ('retencao_30_60d_pct', 'Retenção da coorte de 30 a 60 dias', 'percentual', 'piso',
   false, true, 'fonte_regua_recompra',
   (select coalesce(max(ordem), 0) + 1 from metas_kpi),
   'De quem fez conta na Area de Membros entre 30 e 60 dias atras, quantas voltaram a abrir alguma aula nos ultimos 30 dias. A IDADE da populacao e fixa, entao mes que vem compara igual com igual: o numero so se move se o comportamento se mover. Substituiu alunas_ativas_30d_pct em 12/10/2026, que era um fluxo de 30 dias sobre um estoque cumulativo e caia 40 pontos sozinho enquanto a base crescia. Medido em 12/10/2026: 29,8% (504 de 1.690). Vem carimbado de fora, por membros-metricas.'),
  ('ativacao_30d_pct', 'Ativação de quem acabou de entrar', 'percentual', 'piso',
   false, false, 'fonte_regua_recompra',
   (select coalesce(max(ordem), 0) + 2 from metas_kpi),
   'De quem fez conta na Area de Membros nos ultimos 30 dias, quantas abriram alguma aula. E a outra metade de alunas_ativas_30d_pct, separada em 12/10/2026 porque as duas andavam em direcoes opostas e a media delas nao significava nada. E APOIO e nao meta: ficou entre 78,4% e 82,3% o periodo todo, esta perto do teto e nao e o que a Regua de recompra se propoe a mover. Serve para ler a retencao: se a ativacao cair, a retencao cai depois. Medido em 12/10/2026: 82,3% (1.285 de 1.561).')
on conflict (chave) do nothing;

-- -- 3. Os alvos da retencao -----------------------------------------------
insert into metas (kpi, prazo, valor_alvo, base_em, valor_base_medido, observacao)
values
  ('retencao_30_60d_pct', date '2026-12-31', 35, date '2026-10-12', 29.8,
   'Alvo e DECISAO, nao medicao: lesson_progress sobrescreve updated_at, entao nao ha passado para reconstruir e nao existe "melhor mes que a casa ja fez" para mirar. 35/40/45 transplanta a ambicao do plano (que pedia 45->55, passo de +5) para a base medida de 29,8%. Rever quando a serie carimbada tiver tres meses.'),
  ('retencao_30_60d_pct', date '2027-03-31', 40, date '2026-10-12', 29.8,
   'Ver o alvo de dez/26: a ambicao e do plano, a base e medida, e o passo de +5 e o mesmo que o plano usava.'),
  ('retencao_30_60d_pct', date '2027-07-31', 45, date '2026-10-12', 29.8,
   'Ver o alvo de dez/26: a ambicao e do plano, a base e medida, e o passo de +5 e o mesmo que o plano usava.')
on conflict do nothing;

-- -- 4. "Aberto" passa a ser "concluido" -----------------------------------
update metas_kpi set observacao =
  'De cada par (compradora, curso) que um order bump concedeu numa venda PAGA, em quantos ela CONCLUIU alguma aula daquele curso. Decisao dela em 12/10/2026 — concluir e mais honesto que "tem linha de progresso", porque das 684 linhas de material 55 sao o checkbox desmarcado. Medido em 12/10/2026: 7,26% (549 de 7.561 pares, 2.178 compradoras). Os 1.195 pares sem conta ficam no denominador de proposito: pagou e nunca entrou e o que o indicador quer flagrar, e 1.194 deles tem convite emitido. LIMITE QUE O NUMERO NAO MOSTRA: 94,5% do volume sao livros digitais, que nao tem video — o player nunca grava nada e a unica coisa que cria linha e o clique em "marcar como concluida". Quem baixou o PDF e leu inteiro e indistinguivel de quem nunca entrou. Por isso o alvo de 25% esta acima do teto observado dos 13 livros (o melhor e 15,6%, e so porque tem duas aulas): ele so fica alcancavel quando a Area de Membros registrar abertura de verdade. Vem carimbado de fora, por membros-metricas.'
 where chave = 'bumps_abertos_pct';

-- -- As provas ---------------------------------------------------------------
do $prova$
declare
  v_n int;
begin
  -- A chave velha saiu inteira, sem deixar meta orfa.
  if exists (select 1 from metas_kpi where chave = 'alunas_ativas_30d_pct')
     or exists (select 1 from metas where kpi = 'alunas_ativas_30d_pct') then
    raise exception 'alunas_ativas_30d_pct ainda existe em algum lugar';
  end if;

  -- As duas novas existem, com os papeis certos.
  select count(*) into v_n from metas_kpi
   where chave in ('retencao_30_60d_pct', 'ativacao_30d_pct');
  if v_n <> 2 then raise exception 'esperava os 2 indicadores novos, achei %', v_n; end if;

  if (select e_meta from metas_kpi where chave = 'retencao_30_60d_pct') is not true then
    raise exception 'a retencao tem de ser META: e ela que a Regua de recompra move';
  end if;
  if (select e_meta from metas_kpi where chave = 'ativacao_30d_pct') is not false then
    raise exception 'a ativacao tem de ser APOIO: esta perto do teto e nao e o que se move';
  end if;

  -- Os tres vem de fora, entao nenhum pode ser automatico: fn_metas_medir nao
  -- alcanca o outro projeto, e marca-los automatico os devolveria a "sem medicao".
  select count(*) into v_n from metas_kpi
   where chave in ('retencao_30_60d_pct', 'ativacao_30d_pct', 'bumps_abertos_pct')
     and automatico;
  if v_n > 0 then
    raise exception '% indicadores da Area de Membros estao marcados automatico; fn_metas_medir nao alcanca aquele banco', v_n;
  end if;

  -- Os tres alvos da retencao entraram e estao ACIMA do medido: meta que
  -- nasce batida foi o defeito de hoje de manha, duas vezes.
  select count(*) into v_n from metas where kpi = 'retencao_30_60d_pct';
  if v_n <> 3 then raise exception 'esperava 3 prazos para a retencao, achei %', v_n; end if;

  if exists (select 1 from metas where kpi = 'retencao_30_60d_pct' and valor_alvo <= 29.8) then
    raise exception 'algum alvo da retencao ja nasce batido contra os 29,8% medidos';
  end if;

  -- A arvore tem de continuar fechando: todo indicador aponta para objetivo
  -- que existe, senao ele some da tela sem ninguem notar.
  select count(*) into v_n from metas_kpi k
   where k.objetivo is not null
     and not exists (select 1 from plano_objetivos o where o.chave = k.objetivo);
  if v_n > 0 then raise exception '% indicadores apontam para objetivo inexistente', v_n; end if;

  raise notice 'retencao 29,8%% (meta), ativacao 82,3%% (apoio), bumps 7,26%% — os tres esperando o carimbo';
end
$prova$;

commit;
