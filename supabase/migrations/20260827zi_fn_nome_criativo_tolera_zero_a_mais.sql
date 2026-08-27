-- O zero a mais que escondia 9 anúncios do editor que os fez.
--
-- A convenção de nome usa dois dígitos na versão: V01, V02 … V19. Nove
-- anúncios do Meta foram nomeados com TRÊS — "AD 006 H01 V011" em vez de
-- "AD 006 H01 V11" — e por isso nunca casaram com o card. Apareciam como
-- "sem card" no aviso amarelo, com R$ 1.092 investidos e nenhum editor
-- levando o crédito pelo que fez.
--
-- E o erro acontece dos DOIS lados: há 4 cards em Produção com o mesmo
-- deslize (AD 054 H04 V011..V014). Como esta função é aplicada ao nome do
-- card E ao do anúncio, normalizar aqui conserta as duas pontas de uma vez.
--
-- Conferido ANTES de aplicar:
--   cards com V + 2 dígitos ............ 3.645  (a convenção)
--   cards com V + 3 dígitos ................ 4  (o mesmo erro, do lado do card)
--   anúncios com V0 + 2 dígitos ............ 9
--   desses, com card do outro lado ......... 9  (todos)
--   nomes distintos que colidiriam ......... 0
--
-- O zero cai só quando há TRÊS dígitos começando em zero. "V01" continua
-- "V01" — dois dígitos não são tocados —, então nada do que já casava muda.
--
-- Depois de aplicar, no período de agosto:
--   sem_card   13 → 2 anúncios
--   sugerido    0 → 11 anúncios, R$ 1.092,85
-- e o aviso da tela caiu de 12 para 6 anúncios sem editor identificado.

CREATE OR REPLACE FUNCTION public.fn_nome_criativo(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT nullif(trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t,'')),
          '\s*[-–—]?\s*(c[oó]pia|copy)\s*[0-9]*\s*$', '', 'gi'),
        '\s*\([0-9]+\)\s*$', '', 'g'),
      -- v011 -> v11, e só isso: dois dígitos não são tocados
      '\mv0([0-9]{2})\M', 'v\1', 'g')
  ), '')
$function$;
