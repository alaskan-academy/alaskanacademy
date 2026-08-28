-- Arquivar no Funis tira o espelho do Radar.
--
-- `arquivado` era o unico estado do Funis que o espelho ignorava. O quadro de
-- testes carrega os cards com `.eq('arquivado', false)`, entao um teste
-- arquivado some de la e continuava vivo no Radar -- e agora que o Radar tem o
-- link "Abrir no Funis", ele mandaria a pessoa para um card que nao esta no
-- quadro.
--
-- Hoje nao ha nenhum teste arquivado, entao isto nao muda dado nenhum: e a
-- trava antes do primeiro arquivamento, nao a limpeza depois dele.
--
-- Some da tela e guarda o que foi anotado, igual a voltar para "planejado":
-- desarquivar traz o espelho de volta inteiro. Conferido nos dois sentidos num
-- begin/rollback -- arquivar leva de 22 para 21, desarquivar devolve os 22.
--
-- Substitui a versao de 20260827zzc.

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
  v_no_radar    boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE radar_testes
       SET deletado_em = coalesce(deletado_em, now())
     WHERE fonte = 'funis' AND fonte_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Entra no Radar quem comecou E nao foi arquivado.
  v_no_radar := NEW.pipeline_status IN ('rodando', 'concluido')
                AND NOT coalesce(NEW.arquivado, false);

  IF NOT v_no_radar THEN
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
