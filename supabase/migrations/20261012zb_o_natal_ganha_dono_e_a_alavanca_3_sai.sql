-- O Natal ganha dono, e a Alavanca 3 sai
-- ============================================================================
--
-- Duas decisoes dela em 12/10/2026, sobre a arvore do plano.
--
-- -- 1. "Remova se nao vamos fazer" — a Alavanca 3 -------------------------
--
-- "Alavanca 3 — Custo fixo com regra" ficou sem nada dentro depois das
-- decisoes de hoje de manha: a retirada de socios nao se pretende reduzir
-- (e custo de vida) e nao ha juridico recorrente para pôr teto. O que o
-- plano contava como R$ 14,3 mil de "juridico" era o Simples com o rotulo
-- errado — o extrato tem R$ 954 no centro Juridico. E a regra de dezembro,
-- unica coisa que restava, ja e automatica.
--
-- O que sobrava era um objetivo sem alavanca e SEM INDICADOR: `metas_kpi`
-- nao tem uma linha sequer apontando para `alavanca_custo_fixo`. Ou seja,
-- ele ja era a segunda armadilha do CLAUDE.md — cadastro sem coluna de
-- resultado —, e ela viu isso olhando a tela.
--
-- A acao que estava pendurada nele NAO sai junto. "Arrumar o financeiro"
-- (recategorizar a retirada de R$ 3.000 que caiu em Hospedagem, zerar os 68
-- pendentes, ate 25/10) nao e corte de custo: e a condicao para o DRE de
-- outubro ser confiavel. Ela passa a servir a meta raiz, que e quem depende
-- de um lucro que se possa ler.
--
-- Deixar o `on delete set null` cuidar disso seria pior: a acao cairia no
-- balde das "sem meta" sem que ninguem decidisse, e e justamente esse balde
-- que a outra metade desta migracao esvazia.
--
-- -- 2. "Crie, e uma das coisas que precisa e gravar o curso" — o Natal ----
--
-- O Natal nao e uma acao solta: e uma corrente de cinco, com datas que se
-- encadeiam, e ela estava espalhada entre dois lugares e lugar nenhum.
--
--     13-24/10   Gravar as 6 aulas, pagina TSL e 10 criativos   mini lancamentos
--     27-29/10   Mini lancamento do Natal para a base           mini lancamentos
--     30/10 ->   Natal no trafego frio                          SEM META
--     01-15/12   "Ainda da tempo de produzir para o Natal"      mini lancamentos
--     16/12 ->   Cortar trafego frio e virar para janeiro       SEM META
--
-- Ela apontou "Natal no trafego frio" na lista de orfas e disse que uma das
-- coisas que a meta precisa e gravar o curso. Precisa mesmo — e a gravacao ja
-- existia como acao, arquivada em mini lancamentos, a 11 dias de comecar. As
-- duas pontas da corrente estavam sem dono e o meio estava num objetivo que
-- mede outra coisa.
--
-- A secao 4 do plano se chama "Natal e Black Friday". O lugar existia; o dono
-- e que nao.
--
-- -- O que NAO se move, e por que ------------------------------------------
--
-- `fonte_mini_lancamentos` mede "um mini lancamento por mes". As entradas do
-- bloco `mini_lancamento` que cobrem novembro e dezembro — "Nov: Velas de
-- Natal" e "Dez: ultima chamada de Natal + kit de embalagens" — FICAM la: sao
-- os meses da regua, vistos pelo outro eixo. O proprio plano lista o
-- lancamento nos dois lugares, e a acao de novembro diz isso por escrito.
-- Entao o objetivo mensal nao perde nenhum mes, e a campanha ganha a corrente.
--
-- Black Friday (20-30/11) continua em `fonte_recorrencia`: a oferta principal
-- dela e o Handify Completo anual, que e recorrencia, nao Natal. Esta na
-- mesma secao do plano e serve outra meta — e a secao e o indice do
-- documento, nao a arvore das metas.
--
-- -- Sobre o alvo da temporada ---------------------------------------------
--
-- Este objetivo nasce SEM numero, e isso e deliberado em vez de descuidado:
-- nao ha Natal anterior na base. A primeira venda aprovada e de janeiro/26,
-- entao nao existe temporada passada para comparar, e qualquer alvo que eu
-- escrevesse aqui seria chute com cara de medicao — que foi exatamente o
-- defeito dos alvos de recuperacao que esta mesma tarde teve de refazer duas
-- vezes.
--
-- O que julga a campanha ja esta medido e visivel: o faturamento de novembro
-- e dezembro contra outubro, na tela Resultado. Quando ela quiser um alvo de
-- temporada, e decisao dela e entra como `valor_min`/`valor_max` aqui.

begin;

-- -- 1. A acao muda de dono ANTES de o objetivo sair -------------------------
update plano_acoes a
   set objetivo_id = (select id from plano_objetivos where chave = 'lucro_100k'),
       atualizado_em = now()
 where a.objetivo_id = (select id from plano_objetivos where chave = 'alavanca_custo_fixo');

delete from plano_objetivos where chave = 'alavanca_custo_fixo';

-- -- 2. O Natal vira objetivo, no lugar que a Alavanca 3 deixou -------------
insert into plano_objetivos (parte_de, chave, titulo, descricao, secao, ordem)
select p.id, 'natal', 'Natal — a corrente de 30/10 a 16/12',
       'Cinco etapas encadeadas: gravar as 6 aulas, TSL e 10 criativos (13-24/10); '
       'mini lancamento para a base, que valida a oferta antes de pagar trafego (27-29/10); '
       'trafego frio subindo em degraus de 20-25% (a partir de 30/10); ultima chamada '
       '"ainda da tempo de produzir para o Natal" (01-15/12); e o corte do frio para virar '
       'o planejamento de janeiro (a partir de 16/12). Nasce sem alvo de propósito: a '
       'primeira venda aprovada da base e de janeiro/26, entao nao ha Natal anterior para '
       'comparar e qualquer numero aqui seria chute. O que julga a temporada e o faturamento '
       'de nov/dez contra out/26, na tela Resultado. Black Friday (20-30/11) fica em '
       'Recorrencia, porque a oferta principal dela e o Handify Completo anual.',
       4, 30
  from plano_objetivos p
 where p.chave = 'lucro_100k'
   and not exists (select 1 from plano_objetivos where chave = 'natal');

-- -- 3. A corrente inteira passa a ser dele ---------------------------------
--
-- Por titulo e nao por bloco: o bloco `calendario` tem tambem Black Friday e
-- etapas que nao sao do Natal. A prova la embaixo exige que sejam exatamente
-- cinco, entao se alguem renomear uma acao a migracao para em vez de mover
-- quatro e seguir calada.
update plano_acoes
   set objetivo_id = (select id from plano_objetivos where chave = 'natal'),
       atualizado_em = now()
 where titulo in (
   'Gravar as 6 aulas de Natal, página TSL e 10 criativos',
   'Mini lançamento do Natal para a base',
   'Natal no tráfego frio',
   '"Ainda dá tempo de produzir para o Natal"',
   'Cortar tráfego frio e virar para janeiro'
 );

-- -- As provas ---------------------------------------------------------------
do $prova$
declare
  v_n        int;
  v_orfas    int;
  v_natal    int;
  v_mini     int;
begin
  ---------------------------------------------------------------------------
  -- A Alavanca 3 saiu, e nao levou ninguem junto.
  ---------------------------------------------------------------------------
  if exists (select 1 from plano_objetivos where chave = 'alavanca_custo_fixo') then
    raise exception 'alavanca_custo_fixo continua na arvore';
  end if;

  select count(*) into v_n
    from plano_acoes a
    join plano_objetivos o on o.id = a.objetivo_id
   where o.chave = 'lucro_100k' and a.titulo = 'Arrumar o financeiro';
  if v_n <> 1 then
    raise exception '"Arrumar o financeiro" nao chegou na meta raiz (achei %)', v_n;
  end if;

  ---------------------------------------------------------------------------
  -- A corrente do Natal esta inteira, e a gravacao do curso esta nela. Esta
  -- e a prova que responde ao pedido dela literalmente.
  ---------------------------------------------------------------------------
  select count(*) into v_natal
    from plano_acoes a join plano_objetivos o on o.id = a.objetivo_id
   where o.chave = 'natal';
  if v_natal <> 5 then
    raise exception 'o Natal ficou com % acoes, esperava 5 - algum titulo mudou e a corrente quebrou', v_natal;
  end if;

  if not exists (
    select 1 from plano_acoes a join plano_objetivos o on o.id = a.objetivo_id
     where o.chave = 'natal' and a.titulo ilike 'Gravar as 6 aulas%') then
    raise exception 'a gravacao do curso nao esta na meta do Natal';
  end if;

  ---------------------------------------------------------------------------
  -- O balde das orfas encolheu de 3 para 1, e a que sobra sobra por motivo.
  -- "Checkout com total claro" serve a duas alavancas ao mesmo tempo (menos
  -- carrinho abandonado E menos reembolso), e encaixa-la numa so seria o
  -- chute que a tela diz estar evitando.
  ---------------------------------------------------------------------------
  select count(*) into v_orfas from plano_acoes where objetivo_id is null;
  if v_orfas <> 1 then
    raise exception 'sobraram % acoes sem meta, esperava 1', v_orfas;
  end if;

  ---------------------------------------------------------------------------
  -- O objetivo mensal nao perdeu novembro nem dezembro.
  ---------------------------------------------------------------------------
  select count(*) into v_mini
    from plano_acoes a join plano_objetivos o on o.id = a.objetivo_id
   where o.chave = 'fonte_mini_lancamentos' and a.bloco = 'mini_lancamento'
     and (a.titulo ilike 'Nov:%' or a.titulo ilike 'Dez:%');
  if v_mini <> 2 then
    raise exception 'a regua mensal perdeu novembro ou dezembro (achei % de 2)', v_mini;
  end if;

  ---------------------------------------------------------------------------
  -- Nenhuma acao ficou apontando para objetivo que nao existe mais.
  ---------------------------------------------------------------------------
  select count(*) into v_n
    from plano_acoes a
   where a.objetivo_id is not null
     and not exists (select 1 from plano_objetivos o where o.id = a.objetivo_id);
  if v_n > 0 then
    raise exception '% acoes apontam para objetivo inexistente', v_n;
  end if;

  raise notice 'Natal com % acoes (gravacao inclusa); orfas: %; alavancas restantes: %',
               v_natal, v_orfas,
               (select count(*) from plano_objetivos where chave like 'alavanca%');
end
$prova$;

commit;
