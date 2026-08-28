-- ── Os gatilhos que eu criei entram no padrao do projeto ──────────────────
--
-- Achado no mesmo lugar do anterior, e pelo mesmo motivo: fui conferir as
-- permissoes de uma funcao e olhei as vizinhas.
--
-- Ha uma limpeza antiga neste banco que tirou `anon` e `authenticated` das
-- funcoes de gatilho -- `fn_recado_notifica` e `fn_eventos_touch` estao com
-- `postgres, service_role` e mais nada. As funcoes de gatilho que EU criei
-- nesta rodada nasceram com o padrao do Supabase, que da EXECUTE para `anon` e
-- `authenticated`, e ninguem reparou:
--
--   fn_radar_espelha_teste_funil     (espelho do Funis no Radar)
--   fn_criativo_devolvido_notifica   (aviso ao responsavel)
--   fn_comentario_notifica           (mencao e resposta)
--
-- Nao ha exploracao obvia -- o PostgREST nao expoe funcao que devolve
-- `trigger`, e o Postgres executa gatilho sem consultar EXECUTE. Mas as tres
-- sao SECURITY DEFINER, e permissao a mais numa funcao que roda como dono e
-- exatamente o tipo de coisa que so parece inofensiva ate deixar de ser.
--
-- E ha o motivo menos tecnico, que pesa igual: excecao silenciosa a uma regra
-- ja estabelecida e como a regra morre. Da proxima vez, ninguem sabe mais qual
-- era o padrao -- e o padrao vira "depende de quem escreveu".
REVOKE ALL ON FUNCTION public.fn_radar_espelha_teste_funil()   FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_criativo_devolvido_notifica() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_comentario_notifica()         FROM anon, authenticated;
