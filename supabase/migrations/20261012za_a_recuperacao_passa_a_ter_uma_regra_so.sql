-- A recuperacao de checkout passa a ter uma regra so
-- ============================================================================
--
-- Pergunta dela, 12/10/2026: "refizemos o como analisar a recuperacao de
-- vendas perdidas ne, cruzando CPF e produto, veja se em resumo - perdas
-- considera isso". Nao considerava: o Resumo tinha uma regra anterior ao CPF.
--
--     Resumo    cliente_id + produto_nome, +-7 dias   634 casos, 201 recuperados
--     Metas     CPF + produto,              30 dias   632 casos, 224 recuperados
--
-- Conferir as duas lado a lado encontrou CINCO defeitos. Tres eram meus, de
-- ontem; o quarto e o quinto nasceram dentro desta migracao, consertando os
-- outros.
--
-- -- Defeito 1: `valor_perdido` somava todas as tentativas ------------------
--
-- `fn_checkout_recuperado` agrupava por (pessoa, produto) e fazia
-- `sum(valor)`. Em setembro sao 789 tentativas para 632 casos — 102 pessoas
-- geraram cobranca mais de uma vez para o mesmo produto —, e cada repeticao
-- entrava de novo no prejuizo. O carrinho era um so.
--
--     somando tudo       R$ 89.283,04     <- o que a meta de ontem usou
--     so a ultima        R$ 71.550,89
--     inflado em         R$ 17.732,15     (25%)
--
-- O Resumo ja fazia certo, com `distinct on ... order by data_venda desc`.
-- A regra unica fica com a dele.
--
-- -- Defeito 2: o recorte por meio de pagamento apagou maio -----------------
--
-- Eu escrevi `(meio='pix' and status in ('expirada','pendente')) or
-- (meio='cartao_credito' and status='cancelada')`. Conferido em setembro,
-- isso cobre 789 de 789 linhas — parecia exato. Em maio:
--
--     meio nulo,  expirada    382
--     meio nulo,  cancelada    84
--     pix,        expirada    162
--     cartao,     cancelada    32
--
-- O campo so comecou a ser preenchido em junho. O recorte descartou 466
-- linhas de maio sem dizer nada, e a serie que eu commitei dizia "mai/26: 166
-- casos" quando sao 569. Terceira armadilha do CLAUDE.md, cometida no mesmo
-- dia em que a reescrevi: lista fixa no codigo que envelhece em silencio —
-- aqui envelhecida para TRAS, contra dados que ja existiam.
--
-- O recorte sai. "Nao aprovada" passa a ser `status in ('pendente',
-- 'cancelada','expirada')`, que e o que o Resumo sempre usou, nao depende de
-- campo opcional e nao precisa de manutencao quando entrar boleto.
--
-- -- Defeito 3: a janela do Resumo olhava para TRAS tambem ------------------
--
-- `a.data_venda BETWEEN n.data_venda - 7 days AND n.data_venda + 7 days`
-- contava como "recuperada" uma venda aprovada ANTES do checkout abandonado.
-- Isso nao e recuperacao: e quem ja tinha comprado e gerou outra cobranca
-- depois. Sao 6 casos em setembro, 10 em maio.
--
-- Tambem nao e perda, entao continua descontado do "ficou pelo caminho" — mas
-- numa chave propria, `ja_comprado`, para nao inflar a taxa de recuperacao da
-- meta.
--
-- -- Defeito 4: aprovacao no MESMO instante nao e recuperacao ---------------
--
-- Apareceu durante a propria escrita desta migracao, e so porque maio deu
-- 23,7% onde a medicao a mao tinha dado 15,8%.
--
-- A primeira versao usava `rows between 1 following`, que ordena por
-- (data_venda, id) e chama de "depois" qualquer linha adiante na ordenacao —
-- inclusive uma de MESMO instante que so desempatou pelo id. Quantas falhas
-- tem uma aprovada no mesmo instante exato:
--
--     jan/26     5        jun/26 em diante    0
--     fev/26    45
--     mar/26    92
--     abr/26    96
--     mai/26   110
--
-- Zero de junho em diante: e artefato da importacao antiga, a mesma que
-- deixou o meio de pagamento nulo. Nao e alguem que voltou — e a mesma
-- transacao com carimbo de hora grosseiro.
--
-- `groups between 1 following` conta grupos de valores iguais em vez de
-- linhas, entao "1 grupo adiante" e literalmente `data_venda > a minha`.
--
-- -- Defeito 5: a primeira versao DERRUBOU o Resumo inteiro -----------------
--
-- Este e o mais caro, e so apareceu porque a suite tem uma catraca que eu nao
-- conhecia: `cpf-nao-vaza-por-view-nem-por-anon`, escrita hoje de manha.
--
-- Eu fiz a regra virar uma VIEW, com `security_invoker = on` como manda o
-- CLAUDE.md. Mas `20261012d` trancou a coluna do documento em `clientes` por
-- PRIVILEGIO DE COLUNA, e view invoker roda com os direitos de quem consulta.
-- Medido como `authenticated`, que e todo usuario do painel:
--
--     select from vw_checkout_perdido   permission denied for table clientes
--     fn_overview(...)                  permission denied for table clientes
--
-- Nao era a aba Perdas: era o Resumo INTEIRO, para todo mundo, enquanto nas
-- minhas provas passava verde — porque eu rodava como dono. Exatamente o que
-- o CLAUDE.md descreve sobre o banco compartilhado: a migracao vale na hora,
-- e quem paga e quem esta usando o painel.
--
-- A saida tentadora seria tirar o invoker. Seria pior: o documento de 12.786
-- pessoas ficaria legivel por `anon`, cuja chave esta no bundle.
--
-- Entao a regra vira FUNCAO `security definer`, e ela nao devolve o documento
-- nem hash dele. Devolve `caso`, um inteiro de `dense_rank()` sobre (pessoa,
-- produto) — opaco e suficiente, porque quem le so precisa saber quais linhas
-- sao do mesmo par. Hash NAO serviria: sao 11 digitos, 10^11 combinacoes e
-- forca bruta de fim de semana.
--
-- -- O desenho: a regra na funcao, a janela em quem pergunta ----------------
--
-- `fn_checkout_perdido()` da uma linha por cobranca nao paga e responde, para
-- cada uma: de que caso ela e, e quando foi a aprovacao mais proxima do mesmo
-- caso — depois e antes. A REGRA mora ai.
--
-- A JANELA nao: ela e pergunta de quem le, e as duas telas perguntam coisas
-- diferentes de proposito. O Resumo usa 7 dias, decisao dela hoje, porque a
-- tela e recortada por periodo e uma janela de 30 dias olharia para fora
-- dele. A meta usa 30, porque mede o funil de recuperacao inteiro.
--
-- Isso e o oposto de ter duas regras: antes eram duas definicoes que ninguem
-- podia comparar; agora e uma definicao com um parametro visivel.
--
-- -- Por que `produto` e nao `produto_nome` ---------------------------------
--
-- Medido: 632 casos / 209 recuperados pelo enum contra 633 / 206 pelo nome. A
-- diferenca e ruido, e o enum nao muda quando alguem renomeia uma oferta.
--
-- -- Por que o valor recuperado e o PERDIDO, e nao o aprovado ---------------
--
-- Quem abandona R$ 67 e volta comprando R$ 141 recuperaria 210% do proprio
-- carrinho, e a soma passaria de 100% do perdido. Contando o valor do
-- carrinho que deixou de estar em risco, a taxa fica entre 0 e 100 e e a
-- mesma grandeza do card do Resumo, que faz `perdido - recuperado`.

-- -- A regra, num lugar so ---------------------------------------------------
--
-- Funcao de janela e nao `lateral`: isto roda a cada carregamento do Resumo, e
-- um `lateral` correlacionado custaria 4.445 varreduras sobre 16.862 linhas.
-- Assim e uma ordenacao.
create or replace function public.fn_checkout_perdido()
returns table(venda_id uuid, empresa_id uuid, data_venda timestamptz, status text,
              produto text, caso bigint, valor numeric, aprovada_em timestamptz,
              aprovada_pela_automacao boolean, comprou_antes_em timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with tudo as (
    select v.id,
           v.empresa_id,
           v.data_venda,
           v.status::text                             as status,
           v.produto::text                            as produto,
           coalesce(v.cart_recovered, false)          as pela_automacao,
           coalesce(v.valor_sem_juros, v.valor_total) as valor,
           -- `left join` com fallback: hoje sao 0 vendas sem cliente, e um
           -- `join` as descartaria em silencio no dia em que aparecer uma.
           coalesce(nullif(btrim(c.cpf), ''),
                    'cli:' || v.cliente_id::text,
                    'ped:' || v.pedido_id)            as pessoa
      from vendas v
      left join clientes c on c.id = v.cliente_id
     where v.pedido_id not like 'TEST%'
       and v.pedido_id not like 'LC-%'
  ),
  vizinhos as (
    select t.*,
           min(case when t.status = 'aprovada' then t.data_venda end)
             over (partition by t.pessoa, t.produto order by t.data_venda
                   groups between 1 following and unbounded following) as aprovada_em,
           min(case when t.status = 'aprovada' and t.pela_automacao then t.data_venda end)
             over (partition by t.pessoa, t.produto order by t.data_venda
                   groups between 1 following and unbounded following) as aprovada_auto_em,
           max(case when t.status = 'aprovada' then t.data_venda end)
             over (partition by t.pessoa, t.produto order by t.data_venda
                   groups between unbounded preceding and 1 preceding) as comprou_antes_em
      from tudo t
  )
  select v.id, v.empresa_id, v.data_venda, v.status, v.produto,
         -- O que SAI no lugar do documento: um inteiro opaco por (pessoa,
         -- produto). Quem le so precisa saber quais linhas sao do mesmo caso.
         dense_rank() over (order by v.pessoa, v.produto)::bigint as caso,
         v.valor,
         v.aprovada_em,
         -- A recuperacao veio da automacao se a PRIMEIRA aprovacao depois desta
         -- cobranca for uma marcada com `cart_recovered`. Comparar as duas datas
         -- responde isso sem precisar carregar a linha inteira.
         (v.aprovada_auto_em is not null and v.aprovada_auto_em = v.aprovada_em),
         v.comprou_antes_em
    from vizinhos v
   where v.status in ('pendente', 'cancelada', 'expirada');
$function$;

comment on function public.fn_checkout_perdido() is
  'Uma linha por cobranca nao paga, com a aprovacao mais proxima do mesmo (pessoa, produto) depois e antes dela. SECURITY DEFINER porque casa pelo documento, e authenticated nao tem privilegio na coluna: devolve um caso inteiro e opaco, nunca o documento nem hash dele. A REGRA mora aqui; a JANELA e de quem pergunta - 7 dias no Resumo, 30 nas Metas. Ver 20261012za.';

revoke all on function public.fn_checkout_perdido() from public, anon;
grant execute on function public.fn_checkout_perdido() to authenticated, service_role;

-- -- Quem pergunta: a meta, com 30 dias --------------------------------------
drop function if exists public.fn_checkout_recuperado(uuid, date);
drop function if exists public.fn_checkout_recuperado(uuid, date, int);

create or replace function public.fn_checkout_recuperado(
  p_empresa uuid default null,
  p_mes     date default null,
  p_dias    int  default 30)
returns table(casos bigint, tentativas bigint, recuperadas bigint, pct_casos numeric,
              valor_perdido numeric, valor_recuperado numeric, pct_valor numeric,
              recuperadas_automacao bigint, valor_automacao numeric, pct_valor_automacao numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with ref as (
    select coalesce(p_mes,
             date_trunc('month', date_trunc('month', current_date)::date - 1)::date) as mes
  ),
  no_mes as (
    select p.* from public.fn_checkout_perdido() p, ref r
     where p.data_venda >= r.mes
       and p.data_venda <  (r.mes + interval '1 month')
       and (p_empresa is null or p.empresa_id = p_empresa)
  ),
  caso as (
    select p.caso,
           count(*) as tentativas,
           max(p.data_venda) as ultima,
           (array_agg(p.valor                   order by p.data_venda desc, p.venda_id desc))[1] as perdido,
           (array_agg(p.aprovada_em             order by p.data_venda desc, p.venda_id desc))[1] as aprovada_em,
           (array_agg(p.aprovada_pela_automacao order by p.data_venda desc, p.venda_id desc))[1] as pela_automacao
      from no_mes p
     group by 1
  ),
  julgado as (
    select c.*,
           (c.aprovada_em is not null
            and c.aprovada_em <= c.ultima + make_interval(days => p_dias)) as voltou
      from caso c
  )
  select count(*)::bigint,
         coalesce(sum(tentativas), 0)::bigint,
         count(*) filter (where voltou)::bigint,
         round(100.0 * count(*) filter (where voltou) / nullif(count(*), 0), 2),
         round(coalesce(sum(perdido), 0), 2),
         round(coalesce(sum(perdido) filter (where voltou), 0), 2),
         round(100.0 * coalesce(sum(perdido) filter (where voltou), 0)
                     / nullif(sum(perdido), 0), 2),
         count(*) filter (where voltou and pela_automacao)::bigint,
         round(coalesce(sum(perdido) filter (where voltou and pela_automacao), 0), 2),
         round(100.0 * coalesce(sum(perdido) filter (where voltou and pela_automacao), 0)
                     / nullif(sum(perdido), 0), 2)
    from julgado;
$function$;

comment on function public.fn_checkout_recuperado(uuid, date, int) is
  'Recuperacao de checkout de um mes fechado, lendo fn_checkout_perdido(). Um caso e um par (pessoa, produto) no mes; o valor perdido e o da ULTIMA tentativa, nao a soma delas. p_dias e a janela - 30 para a meta, 7 para o Resumo.';

revoke all on function public.fn_checkout_recuperado(uuid, date, int) from public, anon;
grant execute on function public.fn_checkout_recuperado(uuid, date, int) to authenticated, service_role;

-- -- Quem pergunta: o Resumo, com 7 dias -------------------------------------
--
-- `fn_overview` nao tem arquivo de definicao: e remendada por ancora desde
-- sempre (ver 20260917b, 20261006b, 20261006h). Aqui a ancora e a IMPRESSAO
-- md5 do bloco inteiro, nao um trecho repetido — se alguem mexer nele entre
-- hoje e a aplicacao desta migracao, ela para e diz qual impressao achou, em
-- vez de remendar por cima de uma versao que nao e a que eu li.
--
-- O bloco continua lendo `base`, e nao a funcao direto: `base` e quem respeita
-- o filtro de conta de anuncio, de empresa e de segmento. A funcao entra por
-- `venda_id` so para trazer o casamento. Assim os filtros da tela continuam
-- valendo e a regra mesmo assim tem um dono so.
DO $mig$
DECLARE
  v_def   text;
  v_ini   int;
  v_fim   int;
  v_bloco text;
  -- O bloco exato que esta migracao substitui, lido do banco em 12/10/2026.
  c_impressao constant text := '0641d00c43d129bd5d22461e9badfafa';
  v_novo text := $novo$    'nao_aprovadas', coalesce((
      SELECT jsonb_object_agg(c.status, jsonb_build_object('qtd', c.qtd, 'valor', c.valor))
      FROM (
        SELECT u.status, count(*) AS qtd, sum(u.valor) AS valor
        FROM (
          SELECT DISTINCT ON (p.caso) p.status, p.valor
            FROM base b JOIN fn_checkout_perdido() p ON p.venda_id = b.id
           ORDER BY p.caso, p.data_venda DESC, p.venda_id DESC
        ) u
        GROUP BY u.status
      ) c
    ), '{}'::jsonb),

    /* O card dizia "N tentativas" sobre um numero que ja vinha deduplicado por
       caso: eram CARRINHOS. Em setembro sao 632 carrinhos e 789 tentativas, e
       a diferenca e justamente quem insistiu. */
    'tentativas_nao_aprovadas', (
      SELECT count(*) FROM base b JOIN fn_checkout_perdido() p ON p.venda_id = b.id
    ),

    /* `voltou` e recuperacao: comprou DEPOIS de desistir. `ja_tinha` e quem ja
       era dono e gerou outra cobranca — nao e perda, mas tambem nao e merito
       de ninguem, entao nao entra na taxa. A janela de 7 dias e decisao dela,
       12/10/2026: esta tela e recortada por periodo, e 30 dias olhariam para
       fora do recorte. A regra do casamento e a mesma da meta, em
       fn_checkout_perdido(). */
    'recuperadas', (
      SELECT coalesce(jsonb_build_object(
               'qtd',               count(*) FILTER (WHERE u.voltou),
               'valor',             coalesce(sum(u.valor) FILTER (WHERE u.voltou), 0),
               'ja_comprado_qtd',   count(*) FILTER (WHERE u.ja_tinha AND NOT u.voltou),
               'ja_comprado_valor', coalesce(sum(u.valor) FILTER (WHERE u.ja_tinha AND NOT u.voltou), 0)
             ), '{}'::jsonb)
      FROM (
        SELECT DISTINCT ON (p.caso)
               p.valor,
               (p.aprovada_em IS NOT NULL
                AND p.aprovada_em <= p.data_venda + interval '7 days')      AS voltou,
               (p.comprou_antes_em IS NOT NULL
                AND p.comprou_antes_em >= p.data_venda - interval '7 days') AS ja_tinha
          FROM base b JOIN fn_checkout_perdido() p ON p.venda_id = b.id
         ORDER BY p.caso, p.data_venda DESC, p.venda_id DESC
      ) u
    ),

$novo$;
BEGIN
  v_def := pg_get_functiondef('fn_overview'::regproc);

  -- Idempotente: aplicada duas vezes, a segunda nao faz nada.
  IF position('fn_checkout_perdido()' IN v_def) > 0 THEN
    RAISE NOTICE 'fn_overview ja le fn_checkout_perdido(); nada a fazer';
    RETURN;
  END IF;

  v_ini := position(E'    ''nao_aprovadas'', coalesce((' IN v_def);
  v_fim := position(E'    ''perdas'', coalesce((' IN v_def);

  IF v_ini = 0 OR v_fim <= v_ini THEN
    RAISE EXCEPTION 'nao achei os blocos nao_aprovadas/perdas em fn_overview (ini=%, fim=%)',
                    v_ini, v_fim;
  END IF;

  v_bloco := substring(v_def FROM v_ini FOR v_fim - v_ini);

  IF md5(v_bloco) <> c_impressao THEN
    RAISE EXCEPTION
      'o bloco de recuperacao de fn_overview mudou desde 12/10/2026: impressao % em vez de %. Leia o bloco atual antes de remendar por cima dele.',
      md5(v_bloco), c_impressao;
  END IF;

  EXECUTE left(v_def, v_ini - 1) || v_novo || substring(v_def FROM v_fim);
END
$mig$;

-- -- A meta remarcada, porque a base mudou -----------------------------------
--
-- Os alvos 28/32/35 de ontem saiam de uma serie com o denominador inflado e
-- com maio pela metade. Na serie corrigida:
--
--     mes      casos   perdido    % casos   % valor
--     mai/26     569   49.443,70    15,8      16,4
--     jun/26     213   19.625,69    43,7      45,0
--     jul/26     397   39.881,70    40,6      44,6
--     ago/26     577   62.659,12    32,4      31,6
--     set/26     632   71.550,89    35,4      31,5
--
-- Setembro e 31,5% e nao 22,5% — ou seja, o primeiro alvo de ontem (28%) ja
-- estava batido antes de existir, que era exatamente o defeito que a
-- reescrita de ontem tentou corrigir. Os novos saem dos melhores meses que a
-- casa ja fez, junho e julho, que chegaram a 45,0% e 44,6%.
--
-- O desafio nao e a taxa, e segura-la no volume: julho fez 44,6% com 397
-- casos e R$ 39,9 mil; setembro tem 632 casos e R$ 71,5 mil.
update metas m
   set valor_alvo        = x.alvo,
       valor_base_medido = (select pct_valor
                              from fn_checkout_recuperado(m.empresa_id, date '2026-09-01', 30)),
       base_em           = date '2026-10-12',
       observacao        = 'Alvo remarcado em 12/10/2026, segunda vez no mesmo dia. O primeiro (28%) saiu de uma serie com tres erros de medicao: o valor perdido somava todas as tentativas do mesmo carrinho (+25%), o recorte por meio de pagamento apagava maio inteiro, e a janela contava aprovacao do mesmo instante. Corrigido, setembro e 31,5% e nao 22,5%, e 28% ja estava batido. Os novos saem de junho/26 (45,0%) e julho/26 (44,6%), os melhores meses da casa. O plano original pedia 15% e 20%, sobre uma definicao que media so o que a automacao do Voxuy reivindicava.'
  from (values (date '2026-12-31', 36::numeric),
               (date '2027-03-31', 41::numeric),
               (date '2027-07-31', 45::numeric)) as x(prazo, alvo)
 where m.kpi = 'checkout_recuperado_pct'
   and m.prazo = x.prazo;

-- As descricoes citavam os numeros errados (22,5%, R$ 141, R$ 90).
update metas_kpi set observacao =
  'Fatia do VALOR perdido em checkout que voltou. Um caso e um par (pessoa, produto) que gerou cobranca e nao pagou; vale o carrinho da ULTIMA tentativa, nao a soma delas. Recuperado = esse mesmo carrinho deixou de estar em risco porque a pessoa comprou o produto em ate 30 dias, por qualquer meio. Conta o valor PERDIDO e nao o da compra que o substituiu, senao quem abandona R$ 67 e volta comprando R$ 141 recuperaria 210%. Em setembro: R$ 71.550,89 perdidos em 632 casos, 31,5% de volta. A regra mora em fn_checkout_perdido() e e a mesma do Resumo; la a janela e de 7 dias.'
 where chave = 'checkout_recuperado_pct';

update metas_kpi set observacao =
  'A mesma conta contando CASOS em vez de reais. Em setembro: 35,4% dos casos contra 31,5% do valor - os carrinhos que voltam valem um pouco menos que a media, entao a taxa por pessoa sozinha pinta um quadro melhor do que o caixa confirma. Existe ao lado do valor por isso, e nao e meta: a taxa por pessoa oscilou entre 32% e 44% nos ultimos quatro meses sem relacao com esforco nenhum.'
 where chave = 'checkout_recuperado_casos_pct';

update metas_kpi set observacao =
  'A fatia do valor perdido que a automacao do Voxuy trouxe, por cart_recovered. MESMO denominador do indicador principal, entao le-se "3,5 dos 31,5 pontos". Em setembro a automacao respondeu por 3,5 pontos dos 31,5: o resto voltou sozinho ou por atendimento humano. Separado de proposito - sem isso, crescimento organico seria lido como resultado das acoes do plano. O campo cart_recovered so passou a ser preenchido em 11/08/2026, entao nao ha serie antes disso.'
 where chave = 'checkout_recuperado_automacao_pct';

-- -- As provas ---------------------------------------------------------------
DO $prova$
DECLARE
  r           record;
  v_casos     bigint;
  v_tent      bigint;
  v_perdido   numeric;
  v_pct       numeric;
  v_resumo_q  bigint;
  v_meta_q    bigint;
  v_viu       int := 0;
  j           jsonb;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. A prova que faltava, e que teria pego o defeito 5 na hora: rodar como
  --    quem usa o painel. Todas as minhas provas passavam verdes porque eu
  --    rodava como dono, e a tela estava quebrada para todo mundo.
  ---------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM count(*) FROM fn_checkout_perdido();
    PERFORM fn_overview('2026-09-01', '2026-09-30 23:59:59', 'misto', NULL, NULL);
    RESET ROLE;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    RAISE EXCEPTION 'o painel esta quebrado para authenticated: %', SQLERRM;
  END;

  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM fn_checkout_perdido();
    RESET ROLE;
    RAISE EXCEPTION 'anon consegue ler fn_checkout_perdido(): a chave anon esta no bundle';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;  -- e o que tem de acontecer
  END;
  RAISE NOTICE 'authenticated le, anon nao le';

  ---------------------------------------------------------------------------
  -- 2. Maio inteiro. Prova do defeito 2: com o recorte por meio de pagamento
  --    a funcao via 166 casos, porque o campo era nulo em 466 de 660 linhas.
  ---------------------------------------------------------------------------
  SELECT casos INTO v_casos FROM fn_checkout_recuperado(NULL, date '2026-05-01', 30);
  IF v_casos < 500 THEN
    RAISE EXCEPTION 'maio/26 voltou a enxergar so % casos (eram 569): algum filtro esta descartando linhas com o meio de pagamento nulo', v_casos;
  END IF;
  RAISE NOTICE 'maio/26: % casos (com o recorte antigo eram 166)', v_casos;

  ---------------------------------------------------------------------------
  -- 3. O valor perdido e o da ultima tentativa, nao a soma delas. Em setembro
  --    sao 789 tentativas para 632 casos; somar tudo daria R$ 89.283,04.
  ---------------------------------------------------------------------------
  SELECT casos, tentativas, valor_perdido, pct_valor
    INTO v_casos, v_tent, v_perdido, v_pct
    FROM fn_checkout_recuperado(NULL, date '2026-09-01', 30);

  IF v_tent <= v_casos THEN
    RAISE EXCEPTION 'setembro: % tentativas para % casos - a prova virou tautologia, nao ha repetido para distinguir as duas contas', v_tent, v_casos;
  END IF;
  IF v_perdido > 80000 THEN
    RAISE EXCEPTION 'setembro: valor_perdido voltou a % - esta somando as % tentativas em vez dos % carrinhos', v_perdido, v_tent, v_casos;
  END IF;
  RAISE NOTICE 'setembro: % casos em % tentativas, R$ % perdidos, % por cento de volta em 30 dias',
               v_casos, v_tent, v_perdido, v_pct;

  ---------------------------------------------------------------------------
  -- 4. A INVARIANTE, que e o motivo desta migracao existir: para cada empresa,
  --    o que o Resumo mostra em Perdas e o que a meta mede sao o MESMO numero
  --    quando a janela e a mesma. Antes desta migracao davam 201 e 224.
  --
  --    Escrita como invariante e nao como numero: continua valendo mes que vem
  --    e pega de volta qualquer tentativa de recriar a segunda regra.
  ---------------------------------------------------------------------------
  FOR r IN SELECT id, nome FROM empresas WHERE ativo LOOP
    j := fn_overview('2026-09-01 00:00:00', '2026-09-30 23:59:59.999999', 'misto', NULL, r.id);

    v_resumo_q := coalesce((j -> 'recuperadas' ->> 'qtd')::bigint, 0);
    SELECT recuperadas INTO v_meta_q
      FROM fn_checkout_recuperado(r.id, date '2026-09-01', 7);

    IF v_resumo_q <> v_meta_q THEN
      RAISE EXCEPTION '%: o Resumo diz % recuperadas e a regra da meta diz % na mesma janela de 7 dias - voltaram a ser duas definicoes',
                      r.nome, v_resumo_q, v_meta_q;
    END IF;

    IF v_resumo_q > 0 THEN v_viu := v_viu + 1; END IF;
    RAISE NOTICE '% : Resumo e meta concordam em % recuperadas (7 dias)', r.nome, v_resumo_q;
  END LOOP;

  -- Sem isto a invariante passaria verde comparando zero com zero.
  IF v_viu = 0 THEN
    RAISE EXCEPTION 'nenhuma empresa com recuperacao em setembro: a invariante virou tautologia';
  END IF;

  ---------------------------------------------------------------------------
  -- 5. A meta NAO pode nascer batida - foi o defeito dos alvos de ontem.
  ---------------------------------------------------------------------------
  SELECT pct_valor INTO v_pct FROM fn_checkout_recuperado(NULL, date '2026-09-01', 30);
  FOR r IN SELECT prazo, valor_alvo FROM metas WHERE kpi = 'checkout_recuperado_pct' LOOP
    IF r.valor_alvo <= v_pct THEN
      RAISE EXCEPTION 'o alvo de % (%) ja esta batido: setembro mediu % por cento',
                      r.prazo, r.valor_alvo, v_pct;
    END IF;
  END LOOP;
  RAISE NOTICE 'os tres alvos (36/41/45) estao acima dos % por cento de setembro', v_pct;
END
$prova$;
