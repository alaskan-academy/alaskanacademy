-- Uma das 7 notas veio com dois eventos dentro.
--
-- O corte automático procurava datas no formato `DD/MM/AA`, com dois dígitos
-- no dia. A entrada de 1º de agosto foi escrita "1/08/26 -", com um dígito, e
-- por isso ficou grudada na nota de 08/07.
--
-- Afrouxar o padrão para `\d{1,2}` resolveria este caso e criaria outros:
-- "1/2 do time", "9/10 dos criativos". Como é UM caso, visto na tela e
-- contado no banco (1 de 7), separo ele e deixo o padrão em paz.
--
-- Depois disto: zero datas soltas dentro do texto de qualquer nota.

WITH alvo AS (
  SELECT id, texto,
         strpos(texto, '1/08/26') AS corte
    FROM public.editor_notas
   WHERE data = date '2026-07-08'
     AND texto LIKE '%1/08/26%'
),
novo AS (
  INSERT INTO public.editor_notas (editor_id, data, tipo, texto)
  SELECT n.editor_id, date '2026-08-01', 'remuneracao',
         btrim(regexp_replace(substr(a.texto, a.corte), '^1/08/26\s*[—–-]\s*', ''))
    FROM alvo a JOIN public.editor_notas n ON n.id = a.id
  RETURNING id
)
UPDATE public.editor_notas n
   SET texto = btrim(substr(a.texto, 1, a.corte - 1))
  FROM alvo a
 WHERE n.id = a.id
   AND (SELECT count(*) FROM novo) = 1;
