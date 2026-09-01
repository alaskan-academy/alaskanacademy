-- O painel da Aeliss não mostrava gasto nenhum. Eram dois defeitos, espelhados.
--
-- ══ 1. O DIA DA VIRADA FICOU PARTIDO ENTRE AS DUAS EMPRESAS ═══════════════
--
-- Em 01/09/2026, a MESMA conta de anúncio, no MESMO dia:
--
--     nível       alaskan    aeliss
--     campanha     191,47        —
--     adset        128,68     62,79
--     ad            70,76    120,98
--
-- O carimbo de `metricas_meta` congela por LINHA, no INSERT. A linha de
-- campanha do dia nasceu 00h — antes da virada de 01:05 — pegou Alaskan, e o
-- upsert das 10h preservou. Os 13 anúncios que nasceram depois pegaram Aeliss.
--
-- E como TODA soma do sistema lê `nivel = 'campanha'`, a Aeliss aparecia com
-- ZERO gasto: o dinheiro dela estava gravado só nos níveis que ninguém soma.
--
-- O congelamento agora respeita a DATA da métrica contra `empresa_desde`, a
-- mesma coluna que o alerta de venda usa. Antes da troca fica com quem pagou;
-- a partir dela acompanha o projeto, e o próximo upsert conserta sozinho.
--
-- Há também o caminho inverso: o Meta reporta dias retroativos, então uma
-- métrica de 31/08 pode chegar DEPOIS da virada e ser carimbada com a empresa
-- de hoje — foram 3 linhas assim, dando gasto de agosto a quem não operava. A
-- resposta vem de uma linha IRMÃ: mesma conta, mesmo dia, outro nível.
--
-- ── O reparo precisou desligar o próprio gatilho ─────────────────────────
--
-- As 3 linhas resistiram ao UPDATE: o gatilho via data anterior à troca e
-- restaurava o valor antigo — que era justamente o errado. O congelamento
-- funcionando contra o conserto. Foi desligado dentro da transação, como no
-- backfill da Payt.
--
-- ══ 2. O TOTAL DO PERÍODO IGNORAVA A EMPRESA ══════════════════════════════
--
-- `fat_bruto_total` lia da CTE `periodo`, que filtra só por DATA. Com a Aeliss
-- selecionada, ele trazia o faturamento da ALASKAN: a tela mostrava R$ 2.429,50
-- de "faturamento total" para uma empresa com zero vendas.
--
-- O número visível era o menor problema. Ele é o DENOMINADOR do rateio do custo
-- fixo (`share = fat_bruto / fat_bruto_total`), então no dia em que a Aeliss
-- vendesse, a participação dela sairia contra o total da Alaskan — e o custo
-- fixo dela viria uma fração do que é.
--
-- Continua ignorando o SEGMENTO de propósito: é disso que serve, mostrar quanto
-- tráfego ou backend representam do todo. O que não pode ignorar é de quem é o
-- todo.
--
-- ── Verificado ───────────────────────────────────────────────────────────
--
--     alaskan agosto   fat_bruto = total = 204.254,92   (participação 100%)
--     aeliss  01/09    fat_bruto = total = 0, gasto 191,47
--     tela             Lucro operacional −R$ 215,40 = 191,47 + 23,93 de imposto

-- ── O gatilho ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_carimbar_empresa_metricas()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_empresa uuid;
  v_desde   timestamptz;
  v_irma    uuid;
BEGIN
  SELECT o.empresa_id, o.empresa_desde INTO v_empresa, v_desde
    FROM ad_accounts a
    JOIN ofertas_editores o ON o.id = a.projeto_id
   WHERE a.id = NEW.ad_account_id;

  /* Congela — menos depois de o projeto trocar de empresa. Projeto que nunca
     trocou tem `empresa_desde` nulo e congela sempre, como antes. */
  IF TG_OP = 'UPDATE' AND OLD.empresa_id IS NOT NULL
     AND NOT (v_desde IS NOT NULL AND NEW.data >= v_desde::date) THEN
    NEW.empresa_id := OLD.empresa_id;
    RETURN NEW;
  END IF;

  /* Linha nova com data anterior à troca: quem já carimbou aquele dia sabe de
     quem ele era. */
  IF v_desde IS NOT NULL AND NEW.data < v_desde::date THEN
    SELECT m.empresa_id INTO v_irma
      FROM metricas_meta m
     WHERE m.ad_account_id = NEW.ad_account_id
       AND m.data = NEW.data
       AND m.empresa_id IS NOT NULL
       AND m.empresa_id IS DISTINCT FROM v_empresa
     LIMIT 1;
    IF v_irma IS NOT NULL THEN
      NEW.empresa_id := v_irma;
      RETURN NEW;
    END IF;
  END IF;

  IF v_empresa IS NOT NULL
     AND (NEW.empresa_id IS NULL
          OR (v_desde IS NOT NULL AND NEW.data >= v_desde::date)) THEN
    NEW.empresa_id := v_empresa;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── O reparo do que já estava gravado ────────────────────────────────────

update metricas_meta m
   set empresa_id = o.empresa_id
  from ad_accounts a
  join ofertas_editores o on o.id = a.projeto_id
 where a.id = m.ad_account_id
   and o.empresa_desde is not null
   and m.data >= o.empresa_desde::date
   and m.empresa_id is distinct from o.empresa_id;

do $$
begin
  alter table metricas_meta disable trigger trg_carimbar_empresa_metricas;

  update metricas_meta m
     set empresa_id = (
       select m2.empresa_id from metricas_meta m2
        where m2.ad_account_id = m.ad_account_id and m2.data = m.data
          and m2.empresa_id is not null and m2.empresa_id is distinct from m.empresa_id
        limit 1)
   where exists (
     select 1 from ad_accounts a join ofertas_editores o on o.id = a.projeto_id
      where a.id = m.ad_account_id and o.empresa_desde is not null
        and m.data < o.empresa_desde::date and m.empresa_id = o.empresa_id)
     and exists (
     select 1 from metricas_meta m3
      where m3.ad_account_id = m.ad_account_id and m3.data = m.data
        and m3.empresa_id is not null and m3.empresa_id is distinct from m.empresa_id);

  alter table metricas_meta enable trigger trg_carimbar_empresa_metricas;
end $$;

-- ── O denominador do rateio ──────────────────────────────────────────────

do $$
declare def text; novo text;
  antigo text := $v$    'fat_bruto_total', coalesce((SELECT sum(valor_total) FROM periodo WHERE status = 'aprovada'), 0),$v$;
  troca  text := $n$    /* Respeita a EMPRESA; ignora o segmento de propósito.
       Ver o topo da migração 20260901d. */
    'fat_bruto_total', coalesce((SELECT sum(valor_total) FROM periodo
                                  WHERE status = 'aprovada'
                                    AND (p_empresa IS NULL OR empresa_id = p_empresa)), 0),$n$;
begin
  def := pg_get_functiondef('fn_overview'::regproc);
  if position('Respeita a EMPRESA' in def) > 0 then return; end if;
  if position(antigo in def) = 0 then
    raise exception 'ancora nao encontrada em fn_overview — fat_bruto_total mudou de forma';
  end if;
  novo := replace(def, antigo, troca);
  execute novo;
end $$;
