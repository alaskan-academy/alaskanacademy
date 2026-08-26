-- Limpar o UTM da Payt na porta, e não em seis telas depois.
--
-- Três sujeiras chegam grudadas no valor, e hoje cada consumidor se defende
-- sozinho — `calcular_origem` com `like 'fb%'`, a view de campanhas com
-- `split_part(...,'::',1)`, o `cleanUtmValue` do UTMPage com um regex próprio,
-- e o `fn_overview` com o dele. Quatro regras para o mesmo lixo é a armadilha
-- nº 3: a próxima consulta que alguém escrever vai errar por padrão, porque o
-- valor GRAVADO continua sujo.
--
--   1. `::<fbclid>::`  o Facebook cola o click id depois de "::"
--   2. `jLj6…`         a Payt cola um id de SESSÃO de 27 chars no fim da fonte
--   3. `{{ad.id}}`     a macro do Meta que não foi substituída
--
-- A nº 2 é a que mais custa: 1.008 "fontes" distintas só em agosto para o que
-- eram 11 — e, pior, ela ESCONDE fonte de verdade. Atrás do sufixo havia
-- `chatgpt.com`, que nunca apareceria em relatório nenhum.
--
-- A nº 3 é a que mente: `utm_campaign = '{{campaign.name}}|{{campaign.id}}'`
-- virava uma campanha de 21 vendas na análise de UTM. Macro que não expandiu
-- não é valor — é ausência de valor, e precisa ser null para a tela dizer
-- "sem campanha" em vez de inventar uma.
--
-- O que NÃO se mexe: o `Nome|id` de `utm_campaign` e `utm_medium` fica. O id do
-- conjunto e da campanha é informação de verdade, e as views já sabem cortar no
-- "|" quando querem só o nome. Limpeza tira lixo, não informação.

-- ---------------------------------------------------------------------------
-- A regra, escrita uma vez
-- ---------------------------------------------------------------------------

create or replace function public.fn_limpar_utm(p_valor text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      regexp_replace(
        -- 2. id de sessão da Payt colado no fim da fonte
        regexp_replace(
          -- 1. tudo a partir de "::" é o fbclid, não o valor
          split_part(coalesce(p_valor, ''), '::', 1),
          'jLj6[A-Za-z0-9]{23}$', ''
        ),
        -- 3. macro não substituída: o valor inteiro é ficção
        '^.*\{\{.*$', ''
      )
    ),
    ''
  );
$$;

comment on function public.fn_limpar_utm(text) is
  'Tira do UTM o fbclid (::), o id de sessao da Payt (jLj6+23) e as macros do '
  'Meta que nao expandiram ({{...}} vira null). Mantem o "Nome|id" -- o id e '
  'informacao.';

-- ---------------------------------------------------------------------------
-- A porta
-- ---------------------------------------------------------------------------

create or replace function public.trg_fn_limpar_utm()
returns trigger
language plpgsql
as $function$
begin
  new.utm_source   := fn_limpar_utm(new.utm_source);
  new.utm_medium   := fn_limpar_utm(new.utm_medium);
  new.utm_campaign := fn_limpar_utm(new.utm_campaign);
  new.utm_content  := fn_limpar_utm(new.utm_content);
  new.utm_term     := fn_limpar_utm(new.utm_term);
  new.ad_id_meta   := fn_limpar_utm(new.ad_id_meta);
  return new;
end;
$function$;

comment on function public.trg_fn_limpar_utm() is
  'Limpa o UTM antes de qualquer outro gatilho ler os campos. Ver trg_0_limpar_utm.';

drop trigger if exists trg_0_limpar_utm on public.vendas;

-- O gatilho, e não a `fn_normalizar_venda_payt`, porque ele é a porta MAIS
-- ESTREITA: cobre webhook, importação e correção manual, e não só o caminho da
-- Payt. Limpar dentro da normalizadora deixaria de fora todo UPDATE direto.
create trigger trg_0_limpar_utm
  before insert or update on public.vendas
  for each row execute function public.trg_fn_limpar_utm();

comment on trigger trg_0_limpar_utm on public.vendas is
  'O "0" no nome e deliberado: o Postgres dispara os gatilhos BEFORE em ordem '
  'alfabetica, e trg_marcar_trafego_sem_utm e trg_origem_venda LEEM ad_id_meta '
  'e utm_source. Se a limpeza rodasse depois deles, os dois decidiriam com o '
  'valor sujo -- um ad_id que e so o fbclid nao e nulo, e o marcar_trafego '
  'pularia a linha.';

-- ---------------------------------------------------------------------------
-- O passado
-- ---------------------------------------------------------------------------

-- A carga inicial arruma o que já está gravado; o gatilho acima é o que mantém
-- o presente. Sem as duas, a limpeza valeria só para as vendas novas e o
-- histórico continuaria com as fontes fantasma — é a armadilha nº 4, o retrato
-- único que nunca se atualiza, ao contrário.
--
-- Basta TOCAR as linhas sujas: o gatilho faz a limpeza, e `trg_origem_venda`
-- recalcula `origem` de graça no mesmo UPDATE.
with sujas as (
  select id from public.vendas
  where utm_source   is distinct from fn_limpar_utm(utm_source)
     or utm_medium   is distinct from fn_limpar_utm(utm_medium)
     or utm_campaign is distinct from fn_limpar_utm(utm_campaign)
     or utm_content  is distinct from fn_limpar_utm(utm_content)
     or utm_term     is distinct from fn_limpar_utm(utm_term)
     or ad_id_meta   is distinct from fn_limpar_utm(ad_id_meta)
)
update public.vendas v set atualizado_em = atualizado_em
from sujas s where v.id = s.id;

-- As assinaturas guardam cópia do UTM da venda que as originou e não têm
-- gatilho: a limpeza aqui é direta.
update public.assinaturas set
  utm_source   = fn_limpar_utm(utm_source),
  utm_medium   = fn_limpar_utm(utm_medium),
  utm_campaign = fn_limpar_utm(utm_campaign),
  utm_content  = fn_limpar_utm(utm_content)
where utm_source   is distinct from fn_limpar_utm(utm_source)
   or utm_medium   is distinct from fn_limpar_utm(utm_medium)
   or utm_campaign is distinct from fn_limpar_utm(utm_campaign)
   or utm_content  is distinct from fn_limpar_utm(utm_content);
