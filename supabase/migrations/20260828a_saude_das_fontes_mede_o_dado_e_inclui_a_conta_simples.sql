-- A saude das fontes passa a medir o DADO, e a Conta Simples entra na lista.
--
-- ── O que estava errado ───────────────────────────────────────────────────
--
-- A fonte "Meta" media `fn_ultima_execucao_cron('meta-sync-horario')`: o
-- horario em que o DESPERTADOR tocou, nao a hora em que o dado chegou. Se o
-- cron rodasse e a Edge Function falhasse, a tela dizia "ha 0 min, tudo certo"
-- com zero metrica nova. E o painel existe exatamente para pegar isso.
--
-- Nao era descuido a toa: medir `criado_em` com limiar de 3h daria alarme falso
-- toda madrugada, porque entre 20h e 6h nao ha gasto e a sincronizacao horaria
-- nao encosta em nada. Conferido: ultimo insert as 19h, ultimo toque as 20h, e
-- o cron das 00h nao mexeu em nada -- corretamente.
--
-- A pergunta certa nao e "quantas horas desde o ultimo byte", e sim ATE QUE DIA
-- EU TENHO NUMERO. Essa nao oscila com a madrugada, com fim de semana nem com
-- um dia sem venda.
--
-- ── A Conta Simples ───────────────────────────────────────────────────────
--
-- Ela nao era monitorada como fonte: so o agendamento dela aparecia. E foi
-- justamente esse buraco que deixou o `cs-sync` falhar 52 vezes seguidas entre
-- 30/06 e 20/08 -- por `schema "net" does not exist` -- sem ninguem perceber,
-- levando julho inteiro de transacoes junto. O agendamento aparecia como
-- "existe"; o que faltava era alguem perguntando se CHEGOU DADO.
--
-- Se ela tivesse estado nesta lista, teria ficado vermelha no primeiro dia.
CREATE OR REPLACE VIEW public.vw_ingest_health
WITH (security_invoker = true) AS

-- Vendas: chegam o dia inteiro, entao aqui a hora do ultimo registro e um sinal
-- honesto e mais rapido que o dia.
SELECT 'payt'::text AS fonte,
       'Vendas (Payt)'::text AS rotulo,
       max(criado_em) AS ultimo_evento,
       count(*) AS registros,
       round(extract(epoch FROM now() - max(criado_em)) / 3600::numeric, 1) AS horas_atras,
       6::numeric AS limiar_horas,
       (extract(epoch FROM now() - max(criado_em)) / 3600::numeric) > 6::numeric AS defasado
  FROM vendas_payt

UNION ALL

-- Meta: o dia mais recente com metrica. Esperado hoje ou ontem; dois dias sem
-- numero significa que a sincronizacao parou, e ai e vermelho de verdade.
SELECT 'meta',
       'Métricas de anúncios (Meta)',
       max(data)::timestamptz,
       count(*),
       ((now()::date - max(data)) * 24)::numeric,
       48::numeric,
       (now()::date - max(data)) > 2
  FROM metricas_meta

UNION ALL

-- Conta Simples: extrato bancario, sincronizado uma vez por dia. O limiar e
-- generoso de proposito -- banco nao movimenta sabado e domingo, e um feriado
-- na sexta estica isso para quatro dias. Menos que isso viraria alarme que
-- toca todo fim de semana, e alarme que toca a toa e alarme que ninguem olha.
SELECT 'conta_simples',
       'Extrato (Conta Simples)',
       max(data)::timestamptz,
       count(*),
       ((now()::date - max(data)) * 24)::numeric,
       96::numeric,
       (now()::date - max(data)) > 4
  FROM transacoes;

COMMENT ON VIEW public.vw_ingest_health IS
  'Frescura de cada fonte, medida pelo DADO que chegou -- nunca pelo horario do cron, que so diz que o despertador tocou.';
