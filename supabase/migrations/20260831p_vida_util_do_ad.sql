/*
  Quanto tempo um AD viveu: da primeira impressão até parar de ter impressões.

  Parece uma subtração de duas datas, e não é — duas coisas estragam o número se
  ninguém as marcar, e as duas foram medidas em 31/08/2026 sobre 851 ADs:

  1. ANÚNCIO QUE AINDA RODA NÃO TEM VIDA ENCERRADA — 51 ADs

     A última impressão dele é ontem porque ele está vivo, não porque parou.
     Somá-lo à média puxa tudo para baixo e, pior, responde a pergunta errada:
     "quanto durou" vira "quanto durou até agora".

     Quem responde isso é `meta_objetos.effective_status`, que existe desde
     29/08. Deduzir de impressão não serve: medido contra 4 meses, "sem
     impressão há 2 dias = desligado" erra 33,6% das vezes.

  2. A SÉRIE COMEÇA EM 01/05/2026 — 37 ADs

     `metricas_meta` não tem nada antes disso. Um AD cuja primeira impressão
     registrada é o primeiro dia da série provavelmente começou antes, e a vida
     dele aparece menor do que foi. Ele é marcado, não descartado: 37 de 851 é
     pouco para jogar fora e demais para fingir que não existe.

  Sem as duas marcas, a mediana seria 5 dias com uma cauda que ninguém sabe
  interpretar. Com elas, 5 dias é a mediana dos ADs que de fato terminaram.

  UM CARD PODE TER MAIS DE UM AD

  `producao_ads` liga os dois, e há card com várias veiculações do mesmo
  criativo. A vida do card vai da primeira impressão de QUALQUER um deles até a
  última — é o tempo em que aquele criativo esteve no ar, que é a pergunta.
*/

CREATE OR REPLACE FUNCTION public.fn_vida_util_ads()
RETURNS TABLE(
  producao_id uuid,
  primeira    date,
  ultima      date,
  dias        integer,
  aberta      boolean,
  truncada    boolean
)
LANGUAGE sql STABLE AS $fn$
  WITH inicio_da_serie AS (
    SELECT min(data) AS dia FROM metricas_meta
  ),
  por_ad AS (
    SELECT m.ad_id,
           min(m.data) FILTER (WHERE m.impressoes > 0) AS primeira,
           max(m.data) FILTER (WHERE m.impressoes > 0) AS ultima
      FROM metricas_meta m
     WHERE m.nivel = 'ad'
     GROUP BY m.ad_id
  )
  SELECT pa.producao_id,
         min(a.primeira) AS primeira,
         max(a.ultima)   AS ultima,
         (max(a.ultima) - min(a.primeira) + 1)::integer AS dias,
         /* Aberta enquanto QUALQUER veiculação do card seguir ativa na Meta. */
         COALESCE(bool_or(o.effective_status = 'ACTIVE'), false) AS aberta,
         (min(a.primeira) <= (SELECT dia FROM inicio_da_serie)) AS truncada
    FROM producao_ads pa
    JOIN por_ad a ON a.ad_id = pa.ad_id
    LEFT JOIN meta_objetos o ON o.nivel = 'ad' AND o.objeto_id = pa.ad_id
   WHERE a.primeira IS NOT NULL
   GROUP BY pa.producao_id;
$fn$;

COMMENT ON FUNCTION public.fn_vida_util_ads() IS
  'Da primeira impressao ate a ultima, por card. `aberta` = ainda ACTIVE na '
  'Meta, entao a vida NAO terminou e o numero e "ate agora". `truncada` = a '
  'primeira impressao cai no primeiro dia da serie (01/05/2026), entao o AD '
  'provavelmente comecou antes e a vida aparece menor do que foi.';

REVOKE ALL ON FUNCTION public.fn_vida_util_ads() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_vida_util_ads() TO authenticated;
