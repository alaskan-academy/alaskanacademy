/*
  O remendo de UTM passa a morar num lugar só.

  ── O que aconteceu ──

  Em 21/08/2026 nasceu `checkouts_origem`, que classifica cada checkout por
  origem e por `trafego_pago`. O alerta `fn_alerta_checkout_sem_rastreio` foi
  ligado nela. O GATILHO que preenche `vendas.trafego_pago` não foi, e continuou
  lendo `links_trafego_sem_utm`.

  Entre 21 e 23/08 a tabela antiga foi esvaziada, e aí o gatilho parou de marcar
  qualquer coisa: `exists(...)` sobre tabela vazia é só `false`. Medido: o
  preenchimento de `trafego_pago` caiu de 82% na semana de 10/08 para 2,4% na de
  24/08, e nunca voltou.

  Duas tabelas para o mesmo fato, uma delas esvaziada: a primeira armadilha do
  CLAUDE.md, com o agravante de a que morreu falhar em silêncio.

  ── E o painel mandou esvaziar ──

  `fn_alerta_remendo_utm_resolvido` dizia, quando os links chegavam a 80% de
  `ad_id` resolvido: "Já dá para esvaziar links_trafego_sem_utm."

  O conselho estava certo para os links que ele olhava e errado para o resto,
  porque esvaziar é tudo ou nada. O checkout `Saponaria Brasil - Desconto de
  Aula` — que é o nome da VSL do Saponaria, não um link de desconto — tinha
  marcado 2.070 vendas e segue hoje com 0% de ad_id resolvido. Ele perdeu o
  remendo e virou 58% do alerta de "receita de origem desconhecida".

  Por isso o alerta agora nomeia O LINK que pode sair, e nunca manda apagar a
  lista inteira.

  NOTA de quem veio depois: horas mais tarde, no mesmo dia, este alerta foi
  apagado por inteiro na 20261004h. O conselho dele seguia errado na raiz —
  `checkouts_origem.trafego_pago` é classificação, não remendo, e continua
  verdadeira independente de UTM. No lugar entrou
  `fn_alerta_rastreio_regredindo`. Este arquivo fica porque o conserto do
  GATILHO (passo 1) é o que vale até hoje.
*/

-- 1. O gatilho lê a tabela que existe.
CREATE OR REPLACE FUNCTION public.trg_fn_marcar_trafego_sem_utm()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if new.ad_id_meta is null
     and new.link_titulo is not null
     and exists (select 1 from checkouts_origem c
                  where c.link_titulo = new.link_titulo
                    and c.trafego_pago is true)
  then
    new.trafego_pago := true;
  end if;
  return new;
end;
$function$;

-- 2. O alerta também, e com conselho por link em vez de "apague tudo".
CREATE OR REPLACE FUNCTION public.fn_alerta_remendo_utm_resolvido()
 RETURNS TABLE(codigo text, severidade text, titulo text, detalhe text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH recentes AS (
    SELECT c.link_titulo,
           count(*)            AS vendas,
           count(v.ad_id_meta) AS com_ad_id,
           round(100.0 * count(v.ad_id_meta) / nullif(count(*), 0), 1) AS pct
      FROM checkouts_origem c
      JOIN vendas v ON v.link_titulo = c.link_titulo
     WHERE c.trafego_pago IS TRUE
       AND v.status = 'aprovada'
       AND (v.data_venda AT TIME ZONE 'America/Sao_Paulo')::date
             >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 3)
     GROUP BY c.link_titulo
    HAVING count(*) >= 5 AND count(v.ad_id_meta) > 0
  ),
  prontos AS (SELECT * FROM recentes WHERE pct >= 80)
  SELECT 'remendo_utm_resolvido'::text,
         'atencao'::text,
         'UTM restabelecida em ' || count(*)::text || ' checkout(s): o remendo pode sair',
         string_agg(link_titulo || ' — ' || pct::text || '% rastreado ('
                    || com_ad_id || ' de ' || vendas || ' nos últimos 3 dias)', '; ')
           || '. Tire `trafego_pago` SÓ destes, em `checkouts_origem`. '
           || 'Nunca esvazie a tabela inteira: em 21/08/2026 isso tirou o remendo '
           || 'de um checkout que seguia com 0% de ad_id e custou 58% do alerta '
           || 'de receita sem origem.'
    FROM prontos
  HAVING count(*) > 0;
$function$;
