/*
  O alerta que ESTAVA aqui pedia para tirar o remendo de UTM, e a premissa
  dele era errada de duas maneiras.

  Primeira: o gatilho só age quando `ad_id_meta is null`. Num checkout 100%
  rastreado o remendo já está inerte — não há nada para remover. Segunda, e
  pior: `checkouts_origem.trafego_pago` não é remendo, é CLASSIFICAÇÃO
  (tráfego · suporte · recuperação · bio · upsell), e continua verdadeira
  independente de UTM. Tirar a marca do Saponaria Rev5, que está em 92,3%,
  jogaria as 2 vendas restantes para "origem desconhecida".

  O alerta herdou o modelo mental de `links_trafego_sem_utm`, que era remendo
  de verdade e foi apagada em 04/10/2026. Seguir o conselho dele reproduziria
  exatamente o estrago de 21/08/2026, quando esvaziar aquela tabela custou 58%
  do alerta de receita sem origem.

  ── O que entra no lugar ──────────────────────────────────────────────────

  O que ninguém estava vendo: rastreio que REGRIDE. O "Saponaria Brasil -
  Desconto de Aula" saiu de 79,8% para 69,4% ao longo de seis semanas, com
  volume alto o tempo todo, e nada na tela disse. Não é queda que dispara
  alarme nenhum: o alerta de `receita_sem_rastreio` olha o total dos 7 dias,
  onde um checkout escorregando 10pp se dilui nos outros.

  Janelas de 14 dias e piora nas TRÊS leituras, a mesma regra do aviso de
  tendência dos REVs (`pioraSeguida`). Com 7 dias a série fica ruidosa — o
  mesmo link dava 75,2 → 69,6 → 71,6 e não passava.

  ── Por que estes cortes ──────────────────────────────────────────────────

  `p1 >= 50` é o que separa checkout de tráfego pago dos outros, e é derivado
  do dado em vez de lido de `checkouts_origem`: um link que já esteve em 78%
  É de anúncio, tenha alguém classificado ou não. Lista mantida à mão é a
  terceira armadilha, e um checkout novo ainda sem classificação ficaria
  invisível justo na estreia, que é quando a UTM costuma sair errada.
  Os links de suporte, bio e recuperação ficam em 0,0% nas três janelas e
  saem por aqui, sem precisar de cadastro.

  `menor_volume >= 20` tira o que oscila por acidente: o Workshop Buquê Rev1
  tem 15 vendas por janela, onde uma venda mexe 6pp.

  `p1 - p3 >= 5` evita acusar 100 → 99 → 98.

  Medido na calibração: destes cortes passa EXATAMENTE um link hoje, o
  Desconto de Aula (78,2 → 75,6 → 70,6, queda 7,6pp, 321 vendas na menor
  janela). Nenhum falso positivo. Aviso que aparece sempre é aviso que
  ninguém lê, que é o defeito que o de "26% de origem desconhecida" tinha.

  O preço da regra estrita: se a próxima leitura subir um décimo o aviso
  desaparece com o problema ainda de pé. É o mesmo preço que o aviso dos REVs
  paga de propósito — duas janelas e uma virada é ruído com sorte —, e aqui
  ele volta sozinho quando a queda retomar.
*/
create or replace function public.fn_alerta_rastreio_regredindo()
returns table(codigo text, severidade text, titulo text, detalhe text)
language sql
stable
as $fn$
  with hoje as (
    select (now() at time zone 'America/Sao_Paulo')::date as d
  ),
  janelas as (
    select 1 as n, d - 42 as ini, d - 29 as fim from hoje
    union all select 2, d - 28, d - 15 from hoje
    union all select 3, d - 14, d -  1 from hoje
  ),
  por_janela as (
    select v.link_titulo,
           j.n,
           count(*)                                        as vendas,
           round(100.0 * count(v.ad_id_meta) / count(*), 1) as pct
      from vendas v
     cross join janelas j
     where v.status = 'aprovada'
       and v.is_upsell is not true
       and v.link_titulo is not null
       and (v.data_venda at time zone 'America/Sao_Paulo')::date
             between j.ini and j.fim
     group by 1, 2
  ),
  serie as (
    select link_titulo,
           count(*)    as janelas,
           min(vendas) as menor_volume,
           max(pct) filter (where n = 1) as p1,
           max(pct) filter (where n = 2) as p2,
           max(pct) filter (where n = 3) as p3
      from por_janela
     group by 1
  ),
  caindo as (
    select *
      from serie
     where janelas = 3
       and menor_volume >= 20
       and p1 >= 50
       and p2 < p1
       and p3 < p2
       and p1 - p3 >= 5
  )
  select 'rastreio_regredindo'::text,
         (case when max(p1 - p3) >= 15 then 'critico' else 'atencao' end)::text,
         count(*)::text || ' checkout(s) perdendo rastreio a cada leitura',
         string_agg(
           link_titulo || ' — '
             || replace(p1::text, '.', ',') || '% → '
             || replace(p2::text, '.', ',') || '% → '
             || replace(p3::text, '.', ',') || '% das vendas com ad_id (queda de '
             || replace(round(p1 - p3, 1)::text, '.', ',') || 'pp, '
             || menor_volume::text || ' vendas na menor janela)',
           '; ' order by (p1 - p3) desc
         )
         || '. Janelas de 14 dias, a mesma leitura do aviso de tendência dos REVs. '
         || 'A receita continua entrando, mas sem dizer de qual anúncio: confira se '
         || 'os anúncios novos desse checkout saíram com a UTM no link de destino.'
    from caindo
  having count(*) > 0;
$fn$;
