-- 2026-08-24 (parte 10) — auditoria do Financeiro: o que o banco precisou mudar
--
-- ---------------------------------------------------------------------------
-- 1. aplicar_regras_categoria marca o que fez
-- ---------------------------------------------------------------------------
-- A função preenchia `categoria` e `centro_custo` e deixava `status_revisao`
-- em 'pendente'. O CLAUDE.md do módulo manda marcar 'auto_categorizado' desde
-- sempre; só o código não marcava.
--
-- Não é preciosismo de estado: a fila de revisão passava a misturar "a máquina
-- decidiu, confira" com "ninguém decidiu nada", que são trabalhos diferentes.
-- Depois do backfill da Conta Simples eram 439 itens indistinguíveis — e o
-- botão de confirmação em lote teve que redescobrir a diferença checando
-- `categoria is not null`, informação que o estado deveria carregar.
create or replace function public.aplicar_regras_categoria()
 returns integer
 language plpgsql
as $function$
DECLARE
  updated_count INTEGER;
BEGIN
  WITH matched AS (
    SELECT DISTINCT ON (t.id) t.id, r.categoria, r.centro_custo
    FROM transacoes t
    JOIN regras_categoria r ON r.ativo = true
      AND (
        (r.tipo_match = 'contains'    AND LOWER(t.descricao) LIKE '%' || LOWER(r.padrao) || '%') OR
        (r.tipo_match = 'starts_with' AND LOWER(t.descricao) LIKE LOWER(r.padrao) || '%')        OR
        (r.tipo_match = 'exact'       AND LOWER(t.descricao) = LOWER(r.padrao))                   OR
        (r.tipo_match = 'regex'       AND t.descricao ~* r.padrao)
      )
    WHERE t.categoria IS NULL AND t.status_revisao = 'pendente'
    ORDER BY t.id, r.confianca DESC, LENGTH(r.padrao) DESC
  )
  UPDATE transacoes t
  SET categoria      = matched.categoria,
      centro_custo   = COALESCE(matched.centro_custo, t.centro_custo),
      status_revisao = 'auto_categorizado'
  FROM matched
  WHERE t.id = matched.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

-- As 412 que já estavam na base com categoria e estado 'pendente' foram
-- corrigidas junto, para o estado parar de mentir sobre o passado:
--
--   update transacoes set status_revisao = 'auto_categorizado'
--    where status_revisao = 'pendente' and categoria is not null;
--
-- Resultado: 412 'auto_categorizado' (todas com categoria) e 27 'pendente'
-- (todas sem) — a fila finalmente distingue "confira" de "decida".

-- ---------------------------------------------------------------------------
-- 2. fn_alerta_payt_silencio — o alarme para a falha que não deixa rastro
-- ---------------------------------------------------------------------------
-- O alerta `webhook_nao_processado` conta linhas de `payt_webhook_raw` com
-- `processado = false`. Se o insert do PRÓPRIO corpo bruto falhar, não há linha
-- para contar, e o alerta fica mudo justamente na pior falha possível.
--
-- Aconteceu em 24/08: a instância (NANO, 0,5 GB, CPU compartilhada) ficou sem
-- recurso, e dois eventos das 17:06 sumiram sem deixar registro. O log da edge
-- function guardou "Falha ao gravar payload bruto: undefined" e mais nada.
--
-- Aqui a evidência é a AUSÊNCIA. Dimensionado com 30 dias de histórico:
--
--   horário comercial (9h-21h)   média 5 min · p99 38 min · MÁXIMO 73 min
--   fora (22h-8h)                média 10 min · p99 89 min · máximo 220 min
--
-- Daí o limiar de 90 min só em horário comercial: nunca teria disparado à toa
-- em 30 dias, e teria pego a queda de hoje.
create or replace function public.fn_alerta_payt_silencio()
 returns table(codigo text, severidade text, titulo text, detalhe text)
 language sql
 stable
as $function$
  select 'payt_em_silencio', 'critico',
         'Nenhuma venda da Payt há ' ||
           round(extract(epoch from (now() - max(recebido_em)))/60) || ' minutos',
         'Em 30 dias o maior intervalo em horário comercial foi de 73 min. ' ||
         'Silêncio longo assim costuma ser o webhook sem conseguir gravar, e ' ||
         'nesse caso o evento se perde sem deixar registro. Último recebido às ' ||
         to_char(max(recebido_em) at time zone 'America/Sao_Paulo', 'HH24:MI') || '.'
    from payt_webhook_raw
   where extract(hour from (now() at time zone 'America/Sao_Paulo')) between 9 and 21
  having max(recebido_em) < now() - interval '90 minutes';
$function$;

-- Ligada em `vw_alertas` como mais um UNION ALL, no padrão dos outros alertas
-- que já são função.
