-- O alerta "Vendas (Payt) sem atualizar" estava mentindo.
--
-- ── O que ela viu ─────────────────────────────────────────────────────────
--
--   ⚠ Vendas (Payt) sem atualizar — Última entrada há 6h
--
-- E a Payt estava entregando normalmente: a última venda tinha entrado seis
-- MINUTOS antes. Medido em 31/08/2026 às 21h:
--
--   alaskan          12.804 eventos   último há 0,1h
--   (sem empresa)          1 evento   último há 6,4h
--
-- ── A causa ───────────────────────────────────────────────────────────────
--
-- `GROUP BY vp.empresa_id` cru cria um grupo para as linhas SEM empresa. Esse
-- grupo tinha uma linha só, de 14:30, e nunca cresceria — então `min(ultimo)`
-- ficava preso nela e o alerta acenderia para sempre.
--
-- Uma venda órfã é um problema real, mas é OUTRO problema: quem o mostra é
-- `vw_dinheiro_sem_empresa`. Misturar os dois fez o painel gritar "a Payt
-- parou" quando o que havia era "uma venda ficou sem dono".
--
-- ── E o `HAVING`, que separa "parou" de "ainda não começou" ───────────────
--
-- Tomar o `min()` entre as empresas significa que a mais quieta manda no
-- alerta. Hoje isso é inofensivo porque só a Alaskan recebe; a partir da
-- virada, uma noite calma da Aeliss acenderia o alarme da Alaskan junto.
--
-- O `HAVING` só olha quem recebeu algo nos últimos 7 dias: empresa sem
-- movimento não é uma Payt caída, é uma Payt que ainda não começou — e ela
-- entra na vigilância sozinha no dia da primeira venda, sem ninguém mexer aqui.
--
-- O fallback existe porque o `HAVING` sozinho abriria um buraco pior: se TODAS
-- as empresas parassem por mais de 7 dias, a lista ficaria vazia e o alerta se
-- calaria justamente na pane maior.
--
-- ── A raiz, que fica anotada ──────────────────────────────────────────────
--
-- A órfã veio de uma falha transitória em `empresaDoSlug()` no payt-webhook:
-- ela guarda em cache o SUCESSO, e numa falha devolve nulo. A venda entra sem
-- dono, o que é a decisão certa — não se recusa venda legítima por causa de um
-- cadastro —, mas nada volta para carimbá-la depois. Foram 77 acertos e 1 falha
-- em 78 eventos do dia.
--
-- A linha foi carimbada a partir da `vendas` derivada dela, que tinha o dono
-- correto. E `vw_dinheiro_sem_empresa` passou a olhar a camada bruta, para a
-- próxima aparecer onde deve — em vez de virar um alerta sobre outra coisa.

-- ── 1. A frescura da Payt para de contar as órfãs ─────────────────────────

do $$
declare
  def text; novo text;
  antigo text := $v$ WITH payt_por_empresa AS (
         SELECT vp.empresa_id,
            max(vp.criado_em) AS ultimo
           FROM vendas_payt vp
          GROUP BY vp.empresa_id
        )$v$;
  troca text := $n$ WITH payt_por_empresa AS (
         SELECT vp.empresa_id,
            max(vp.criado_em) AS ultimo
           FROM vendas_payt vp
          WHERE vp.empresa_id IS NOT NULL
          GROUP BY vp.empresa_id
         HAVING max(vp.criado_em) > (now() - '7 days'::interval)
        ), payt_referencia AS (
         SELECT COALESCE(
                  (SELECT min(p.ultimo) FROM payt_por_empresa p),
                  (SELECT max(vp.criado_em) FROM vendas_payt vp WHERE vp.empresa_id IS NOT NULL)
                ) AS ultimo
        )$n$;
begin
  def := pg_get_viewdef('vw_ingest_health'::regclass, true);

  /* Já aplicado? Sai sem erro: a migração precisa poder rodar duas vezes. */
  if position('payt_referencia' in def) > 0 then
    return;
  end if;

  if position(antigo in def) = 0 then
    raise exception 'ancora nao encontrada em vw_ingest_health — o CTE da Payt mudou de forma';
  end if;

  novo := replace(def, antigo, troca);
  novo := replace(novo, '( SELECT min(p.ultimo) AS min
           FROM payt_por_empresa p)', '( SELECT r.ultimo FROM payt_referencia r)');

  execute 'create or replace view vw_ingest_health as ' || novo;
end $$;

-- ── 2. A camada bruta da Payt entra no painel de dinheiro sem dono ────────

create or replace view vw_dinheiro_sem_empresa as
 SELECT 'vendas'::text AS tabela, count(*) AS linhas,
    round(COALESCE(sum(vendas.valor_total), 0::numeric), 2) AS valor,
    max(vendas.data_venda::date) AS mais_recente
   FROM vendas WHERE vendas.empresa_id IS NULL
UNION ALL
 SELECT 'transacoes'::text, count(*),
    round(COALESCE(sum(transacoes.valor), 0::numeric), 2),
    max(transacoes.data)
   FROM transacoes WHERE transacoes.empresa_id IS NULL
UNION ALL
 SELECT 'metricas_meta'::text, count(*),
    round(COALESCE(sum(metricas_meta.investimento), 0::numeric), 2),
    max(metricas_meta.data)
   FROM metricas_meta WHERE metricas_meta.empresa_id IS NULL
UNION ALL
 SELECT 'vendas_payt'::text, count(*),
    round(COALESCE(sum(vendas_payt.valor), 0::numeric), 2),
    max(vendas_payt.data)
   FROM vendas_payt WHERE vendas_payt.empresa_id IS NULL;

-- ── 3. A órfã carimbada a partir da venda derivada dela ───────────────────

update vendas_payt vp
set empresa_id = v.empresa_id
from vendas v
where v.pedido_id = vp.payt_id
  and vp.empresa_id is null
  and v.empresa_id is not null;
