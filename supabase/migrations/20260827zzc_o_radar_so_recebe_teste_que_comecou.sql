-- O Radar so recebe teste que comecou -- e o status vem do Funis, nao da data.
--
-- O espelho lia `data_fim` e ignorava `pipeline_status` inteiro. Errava nas
-- duas pontas, e o retrato dos 44 testes mostra as duas:
--
--   planejado                    20  ->  "Em andamento" no Radar   ERRADO
--   produzindo                    2  ->  "Em andamento"            ERRADO
--   rodando                       9  ->  "Em andamento"            certo
--   concluido COM data_fim        8  ->  "Concluido"               certo
--   concluido SEM data_fim        5  ->  "Em andamento"            ERRADO
--
-- 22 testes que nunca sairam do papel contavam como em andamento, e 5 que o
-- Funis da por encerrados apareciam como se estivessem rodando -- e sem
-- resultado, porque a regra do resultado tambem dependia de `data_fim`.
--
-- Agora quem manda e o `pipeline_status`:
--
--   entrou em andamento  =  rodando ou concluido
--
-- "Pronto para teste" fica de fora junto com "planejado" e "produzindo": esta
-- pronto e nao comecou. Nao ha nenhum hoje, mas a regra ja o cobre.
--
-- Voltar de "rodando" para "planejado" NAO apaga o espelho: marca como
-- excluido. Area, projeto e aprendizado sao escritos no Radar e nao existem no
-- Funis -- perde-los porque alguem mexeu no status do outro lado seria o pior
-- tipo de perda, a silenciosa. Se o teste voltar a rodar, o espelho ressuscita
-- inteiro, porque o caminho de update ja limpa `deletado_em`.
CREATE OR REPLACE FUNCTION public.fn_radar_espelha_teste_funil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_titulo      text;
  v_hipotese    text;
  v_conclusao   text;
  v_metodologia text;
  v_status      radar_status;
  v_resultado   radar_resultado;
  v_tags        text[];
  v_partes      text[] := '{}';
  v_funil       text;
  v_id          uuid;
  v_comecou     boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE radar_testes
       SET deletado_em = coalesce(deletado_em, now())
     WHERE fonte = 'funis' AND fonte_id = OLD.id;
    RETURN OLD;
  END IF;

  v_comecou := NEW.pipeline_status IN ('rodando', 'concluido');

  IF NOT v_comecou THEN
    -- Some da tela, guarda o que foi anotado. Nao cria espelho se nao havia.
    UPDATE radar_testes
       SET deletado_em = coalesce(deletado_em, now())
     WHERE fonte = 'funis' AND fonte_id = NEW.id;
    RETURN NEW;
  END IF;

  v_status := CASE WHEN NEW.pipeline_status = 'concluido' THEN 'concluido' ELSE 'em_andamento' END;

  -- O resultado segue a MESMA leitura que ja valia para os concluidos com data
  -- de fim: `validado` e "o teste validou a hipotese", e concluido sem validar
  -- e negativo. Dos 8 que ja estavam la, 3 negativos nao tinham nada
  -- preenchido -- entao isto nao e regra nova, e a mesma alcancando mais 5.
  v_resultado := CASE
    WHEN NEW.pipeline_status <> 'concluido' THEN NULL
    WHEN NEW.vencedor = 'inconclusivo'      THEN 'inconclusivo'
    WHEN NEW.validado IS TRUE               THEN 'positivo'
    ELSE 'negativo'
  END;

  IF NEW.tipo = 'ad' THEN
    v_titulo    := coalesce(nullif(NEW.nome_ad, ''), nullif(NEW.titulo, ''), 'Sem título');
    v_hipotese  := coalesce(nullif(NEW.comentario_ad, ''), nullif(NEW.notas, ''));
    v_conclusao := nullif(NEW.resultado_a, '');
  ELSE
    v_titulo   := coalesce(nullif(NEW.titulo, ''), 'Sem título');
    v_hipotese := nullif(NEW.notas, '');

    IF nullif(NEW.variante_a,'') IS NOT NULL AND nullif(NEW.resultado_a,'') IS NOT NULL THEN
      v_partes := v_partes || format('A (%s): %s', NEW.variante_a, NEW.resultado_a);
    ELSIF nullif(NEW.resultado_a,'') IS NOT NULL THEN
      v_partes := v_partes || format('A: %s', NEW.resultado_a);
    END IF;

    IF nullif(NEW.variante_b,'') IS NOT NULL AND nullif(NEW.resultado_b,'') IS NOT NULL THEN
      v_partes := v_partes || format('B (%s): %s', NEW.variante_b, NEW.resultado_b);
    ELSIF nullif(NEW.resultado_b,'') IS NOT NULL THEN
      v_partes := v_partes || format('B: %s', NEW.resultado_b);
    END IF;

    v_conclusao := nullif(array_to_string(v_partes, E'\n\n'), '');
  END IF;

  v_funil := coalesce(NEW.funil_ids[1], NEW.funil_id::text);
  IF v_funil IS NOT NULL THEN
    SELECT 'Funil: ' || f.nome INTO v_metodologia FROM funis f WHERE f.id::text = v_funil;
  END IF;

  v_tags := ARRAY['funis'::text, NEW.tipo::text];
  IF nullif(NEW.kpi,'') IS NOT NULL THEN
    v_tags := v_tags || lower(NEW.kpi)::text;
  END IF;
  IF NEW.tipo = 'ad' AND nullif(NEW.link_ad,'') IS NOT NULL THEN
    v_tags := v_tags || 'criativo'::text;
  END IF;

  SELECT id INTO v_id FROM radar_testes WHERE fonte = 'funis' AND fonte_id = NEW.id;

  IF v_id IS NULL THEN
    INSERT INTO radar_testes
      (titulo, hipotese, metodologia, conclusao, data_inicio, data_fim,
       status, resultado, tags, fonte, fonte_id, criado_por, criado_em, atualizado_em)
    VALUES
      (v_titulo, v_hipotese, v_metodologia, v_conclusao, NEW.data_inicio, NEW.data_fim,
       v_status, v_resultado, v_tags, 'funis', NEW.id, NEW.criado_por, now(), now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE radar_testes r
       SET titulo      = v_titulo,
           hipotese    = coalesce(v_hipotese,  r.hipotese),
           conclusao   = coalesce(v_conclusao, r.conclusao),
           metodologia = CASE
             WHEN v_metodologia IS NULL         THEN r.metodologia
             WHEN r.metodologia IS NULL         THEN v_metodologia
             WHEN r.metodologia LIKE 'Funil: %' THEN v_metodologia
             ELSE r.metodologia   -- prosa escrita a mao no Radar: nao se toca
           END,
           data_inicio = NEW.data_inicio,
           data_fim    = NEW.data_fim,
           status      = v_status,
           resultado   = v_resultado,
           tags        = v_tags,
           -- Voltou a rodar (ou foi reeditado depois de apagado): ressuscita.
           deletado_em = NULL, deletado_por = NULL,
           atualizado_em = now()
     WHERE r.id = v_id;
  END IF;

  NEW.radar_teste_id := v_id;
  RETURN NEW;
END;
$function$;

-- ── Os 22 que nunca comecaram saem ─────────────────────────────────────────

-- Backup do que sai. Apagar quando ela conferir.
CREATE TABLE IF NOT EXISTS public.backup_radar_nao_comecados_20260827 AS
  SELECT r.* FROM public.radar_testes r
   JOIN public.testes_funis f ON f.id = r.fonte_id
   WHERE r.fonte = 'funis' AND f.pipeline_status NOT IN ('rodando', 'concluido');

ALTER TABLE public.backup_radar_nao_comecados_20260827 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backup_radar_nao_comecados_admin ON public.backup_radar_nao_comecados_20260827;
CREATE POLICY backup_radar_nao_comecados_admin ON public.backup_radar_nao_comecados_20260827
  FOR ALL TO authenticated USING (public.fn_sou_admin()) WITH CHECK (public.fn_sou_admin());

COMMENT ON TABLE public.backup_radar_nao_comecados_20260827 IS
  'Os 22 espelhos de testes que nunca sairam do papel, antes de saírem do Radar (27/08/2026). Apagar quando conferido.';

-- Um toque que nao muda nada em `testes_funis`: e o gatilho que reclassifica
-- tudo. Conferido em begin/rollback antes -- 22 saem da tela, 5 mudam de
-- status, 5 ganham resultado, 22 seguem visiveis.
UPDATE public.testes_funis SET updated_at = updated_at;

-- E os 22 saem de vez, por decisao dela: nenhum deles tem area, projeto,
-- aprendizado ou responsavel preenchido no Radar -- conferido antes -- entao
-- nao ha anotacao para preservar, e deixa-los como "excluidos" so sujaria a
-- aba de exclusoes da planilha com testes que nunca foram excluidos.
--
-- So os que ainda TEM origem no Funis: os 2 orfaos de verdade (o teste foi
-- apagado) continuam marcados como excluidos, que e o lugar deles.
DELETE FROM public.radar_testes r
 USING public.testes_funis f
 WHERE r.fonte_id = f.id
   AND r.fonte = 'funis'
   AND f.pipeline_status NOT IN ('rodando', 'concluido');
