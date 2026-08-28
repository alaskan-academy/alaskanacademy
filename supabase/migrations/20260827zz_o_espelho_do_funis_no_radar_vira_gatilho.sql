-- O espelho do Funis no Radar passa a ser gatilho.
--
-- Ele nascia no navegador: `TesteModal.syncToRadar` escrevia em `radar_testes`
-- logo depois de salvar o teste do funil, e um segundo UPDATE carimbava
-- `radar_teste_id`. Quarta armadilha do CLAUDE.md em estado puro -- espelho sem
-- gatilho -- e o estrago estava medido:
--
--   44 testes em `testes_funis`
--   23 com espelho     <- so metade aparecia no Radar
--   21 SEM espelho
--    2 espelhos orfaos <- o teste do funil foi apagado, a copia ficou viva
--   25 espelhos com `criado_por` nulo
--
-- Os 25 sem dono eram pior do que parecia: a policy `radar_testes_update` e
-- `criado_por = auth.uid() OR admin`, e `null = auth.uid()` da NULL -- entao
-- editar um teste de funil sendo nao-admin atualizava ZERO linhas do espelho,
-- sem erro nenhum na tela.
--
-- ── O que o gatilho NAO toca ───────────────────────────────────────────────
--
-- `area_id`, `projeto_ids`, `responsavel_id` e `aprendizado` so existem no
-- Radar. Um espelho que os sobrescrevesse apagaria trabalho a cada salvamento.
--
-- E mais duas, que so apareceram conferindo a fidelidade da traducao num
-- begin/rollback -- tocar os 25 testes sem mudar nada e olhar se o espelho
-- ficava igual:
--
--   "Pagina com SO"       conclusao: "Oferta nao escalou, apesar da conversao
--                         de 127 ter sido 70% do publico..."   ->  NULL
--   "24/48/36h Pos Venda" conclusao: "Baixa conversao e o publico demora um
--                         pouco para acessar o produto..."     ->  NULL
--
-- Os dois testes tem `resultado_a` e `resultado_b` vazios no Funis: alguem
-- escreveu a analise direto no Radar. A traducao fiel zerava os dois -- e o
-- frontend de hoje faria o mesmo no proximo salvamento; era uma mina que ainda
-- nao tinha pisado ninguem. Tres deles tambem tinham `metodologia` em prosa
-- ("Page validada apenas com variacao de ticket") no lugar do "Funil: X".
--
-- Dai a regra:
--
--   `conclusao` e `hipotese` -- so escreve quando tem o que escrever.
--   `metodologia` -- so escreve por cima do que o proprio espelho escreveu (o
--     que comeca com "Funil: ") ou do vazio. Renomear o funil continua
--     propagando; prosa humana fica.
--   `titulo`, `status`, `resultado`, datas e `tags` -- sempre do Funis.
--
-- Depois da regra, o mesmo teste deu: conclusao 0 diferencas, metodologia 1
-- (um funil renomeado de "REV7" para "REV7 - SO"), tags 7 (o `kpi` mudou depois
-- que o espelho foi escrito, e a tag estava velha).
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
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Soft delete, nunca DELETE: o teste sai do Radar mas continua na aba
    -- "Excluidos" da planilha, que e onde se procura o que sumiu.
    UPDATE radar_testes
       SET deletado_em = coalesce(deletado_em, now())
     WHERE fonte = 'funis' AND fonte_id = OLD.id;
    RETURN OLD;
  END IF;

  v_status := CASE WHEN NEW.data_fim IS NOT NULL THEN 'concluido' ELSE 'em_andamento' END;

  v_resultado := CASE
    WHEN NEW.data_fim IS NULL          THEN NULL
    WHEN NEW.vencedor = 'inconclusivo' THEN 'inconclusivo'
    WHEN NEW.validado IS TRUE          THEN 'positivo'
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

  -- O nome do PRIMEIRO funil, como o frontend fazia
  -- (`funis.find(f => f.id === funilIds[0])`).
  --
  -- Comparado como TEXTO dos dois lados, e nao com cast para uuid: `funil_ids`
  -- e text[] enquanto `funil_id` e uuid, e se um dia entrar ali algo que nao e
  -- uuid, comparar como texto so nao acha funil nenhum -- o cast derrubaria o
  -- salvamento do teste inteiro.
  v_funil := coalesce(NEW.funil_ids[1], NEW.funil_id::text);
  IF v_funil IS NOT NULL THEN
    SELECT 'Funil: ' || f.nome INTO v_metodologia FROM funis f WHERE f.id::text = v_funil;
  END IF;

  -- `::text` explicito: `v_tags || 'criativo'` nao compila, porque o literal e
  -- de tipo desconhecido e o Postgres nao sabe se e elemento ou array. So
  -- estourava no caso `tipo = 'ad'` com `link_ad`, que os primeiros testes nao
  -- pegaram -- apareceu ao tocar a tabela inteira num begin/rollback.
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
           -- Reeditar no Funis desfaz uma exclusao feita la: o teste voltou.
           deletado_em = NULL, deletado_por = NULL,
           atualizado_em = now()
     WHERE r.id = v_id;
  END IF;

  NEW.radar_teste_id := v_id;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_radar_espelha_teste_funil() IS
  'Mantem o espelho de testes_funis em radar_testes. Nao toca em area_id, projeto_ids, responsavel_id nem aprendizado -- esses so existem no Radar.';

-- BEFORE no insert/update para poder carimbar `NEW.radar_teste_id` sem um
-- segundo UPDATE na propria tabela (que reentraria no gatilho).
DROP TRIGGER IF EXISTS trg_radar_espelha_teste_funil     ON public.testes_funis;
DROP TRIGGER IF EXISTS trg_radar_espelha_teste_funil_del ON public.testes_funis;

CREATE TRIGGER trg_radar_espelha_teste_funil
  BEFORE INSERT OR UPDATE ON public.testes_funis
  FOR EACH ROW EXECUTE FUNCTION public.fn_radar_espelha_teste_funil();

CREATE TRIGGER trg_radar_espelha_teste_funil_del
  AFTER DELETE ON public.testes_funis
  FOR EACH ROW EXECUTE FUNCTION public.fn_radar_espelha_teste_funil();

-- A rede de seguranca da troca.
--
-- O frontend deixou de escrever o espelho no mesmo commit, mas o app publicado
-- so troca no proximo deploy. Nessa janela, salvar um teste de funil faria o
-- gatilho criar o espelho E o navegador, com a copia velha em memoria (sem
-- `radar_teste_id`), inserir um SEGUNDO. Com o indice unico esse insert falha,
-- `syncToRadar` cai no proprio caminho de erro e devolve null, e o salvamento
-- do teste segue normal -- com o espelho certo, o do gatilho.
--
-- Conferido antes de criar: 25 espelhos, 25 `fonte_id` distintos, nenhum nulo.
CREATE UNIQUE INDEX IF NOT EXISTS radar_testes_um_espelho_por_teste_de_funil
  ON public.radar_testes (fonte_id)
  WHERE fonte = 'funis';

-- ── Encher o espelho ───────────────────────────────────────────────────────
--
-- Um toque que nao muda nada em `testes_funis` -- so faz o gatilho rodar.
-- Conferido em begin/rollback antes: das 44 linhas, 21 mudam, e as 21 mudam
-- SOMENTE em `radar_teste_id`. Zero conclusoes alteradas. Os outros dois
-- gatilhos da tabela (`fn_teste_kpi_unico` e `fn_teste_sincroniza_funis`) sao
-- normalizadores idempotentes: re-derivam os mesmos valores.
UPDATE public.testes_funis SET updated_at = updated_at;

-- Os espelhos antigos herdam o dono do teste de origem, para sair da armadilha
-- do `criado_por` nulo. Onde `testes_funis.criado_por` tambem e nulo -- 33 das
-- 44 linhas -- nao ha o que herdar: continuam so-admin, como a origem.
UPDATE public.radar_testes r
   SET criado_por = f.criado_por
  FROM public.testes_funis f
 WHERE r.fonte = 'funis' AND r.fonte_id = f.id
   AND r.criado_por IS NULL AND f.criado_por IS NOT NULL;

-- Os 2 orfaos: o teste do funil foi apagado e a copia ficou viva no Radar.
-- Vao para excluido, nao para o lixo.
UPDATE public.radar_testes r
   SET deletado_em = now()
 WHERE r.fonte = 'funis'
   AND r.deletado_em IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.testes_funis f WHERE f.id = r.fonte_id);
