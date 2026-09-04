-- AS FATIAS DA RECEITA DESCONTAM A COPRODUCAO
--
-- Ela olhou o ROAS da Aeliss e desconfiou:
--
--     ROAS  4,17x
--     4,61x sem upsell
--
-- Tirar receita nao pode AUMENTAR o ROAS. E o `qtd_upsells` daquele dia era
-- ZERO — nao havia upsell nenhum para tirar, entao os dois tinham de ser
-- identicos.
--
-- A CAUSA FUI EU
--
-- Quando a coproducao passou a sair da receita (migracao 20260902a), mudei
-- `receita` e `receita_tributavel` e esqueci as irmas:
--
--     receita              1.101,47   ja liquida de coproducao
--     receita_sem_upsell   1.216,29   ainda BRUTA
--     coproducao             114,82   ← a diferenca inteira
--
-- `receita_backend` tinha o mesmo defeito, e nele e pior: e uma FATIA da
-- receita, entao podia passar do total — parte maior que o todo, sem nada dar
-- erro.
--
-- O QUE FICA DE FORA, DE PROPOSITO
--
-- `faturamento` (por dia), `base_copro`, `ticket` e as somas de
-- `por_link`/`por_origem` continuam BRUTAS. `base_copro` e justamente o
-- denominador do percentual de coproducao: medi-la liquida daria um numero
-- circular.
--
-- Travado em `src/test/receita-e-suas-fatias-usam-a-mesma-base.test.ts`, que
-- le esta definicao e cobra a mesma deducao de toda chave que comeca com
-- `receita`. Nao e erro de digitacao: e a forma de errar quando um numero
-- ganha uma deducao nova, e quem mexer amanhã esqueceria as mesmas irmas.
--
-- Reescrita ancorada: le a definicao viva e troca duas expressoes. `fn_overview`
-- tem ~400 linhas e copia-las aqui seria convidar divergencia com o banco.

DO $mig$
DECLARE v_def text; v_de text; v_para text; v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_overview';

  IF position('''receita_sem_upsell'', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0))' IN v_def) > 0 THEN
    RETURN;  -- ja aplicada
  END IF;

  -- 1) sem upsell: e uma variante de `receita`, mostrada ao lado dela
  v_de   := '''receita_sem_upsell'', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total))';
  v_para := '''receita_sem_upsell'', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0))';
  v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF v_n <> 1 THEN RAISE EXCEPTION 'ancora sem_upsell bate %x, esperava 1', v_n; END IF;
  v_def := replace(v_def, v_de, v_para);

  -- 2) back-end: e uma FATIA da receita; bruta, podia passar do total
  v_de   := '''receita_backend'', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total)) FROM aprovadas WHERE NOT eh_trafego), 0)';
  v_para := '''receita_backend'', coalesce((SELECT sum(coalesce(valor_sem_juros, valor_total) - coalesce(valor_coproducao, 0)) FROM aprovadas WHERE NOT eh_trafego), 0)';
  v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF v_n <> 1 THEN RAISE EXCEPTION 'ancora backend bate %x, esperava 1', v_n; END IF;
  v_def := replace(v_def, v_de, v_para);

  EXECUTE v_def;
END
$mig$;
