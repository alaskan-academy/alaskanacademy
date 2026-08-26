-- A busca da Central de Processos passa a ler o CONTEÚDO, não só o título.
--
-- Procurar "aprendizado" — palavra que está no corpo do artigo do Radar —
-- devolvia "0 resultados". São ~25 mil caracteres de processo escritos que a
-- busca não enxergava, numa tela cujo campo diz "Buscar processos, políticas,
-- guias...". Uma central de processos em que não se acha o processo.
--
-- Poderia ser resolvido carregando `conteudo` no cliente e filtrando lá — cinco
-- linhas, e funciona com os 9 artigos de hoje. Mas isso envelhece exatamente na
-- direção em que a base cresce: 100 artigos viram meio mega baixado a cada
-- abertura da página, para filtrar com `includes`.
--
-- A coluna gerada é gatilho, não carga inicial: ela se recalcula sozinha a cada
-- edição do artigo. Sem isso, a busca ficaria correta no dia da migration e
-- desatualizada a partir do primeiro texto editado.

-- ---------------------------------------------------------------------------
-- Português sem acento
-- ---------------------------------------------------------------------------

-- Uma configuração própria, e não `unaccent()` solto: `unaccent` é STABLE e não
-- IMMUTABLE, então não pode entrar numa coluna gerada. Já `to_tsvector` com a
-- configuração dita explicitamente É imutável — e o desacento fica dentro do
-- dicionário, aplicado do mesmo jeito no texto e na consulta.
--
-- É o que faz "analise" achar "análise". Quem busca com pressa não digita acento.
create extension if not exists unaccent;

do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'portugues_sem_acento') then
    create text search configuration public.portugues_sem_acento (copy = portuguese);
    alter text search configuration public.portugues_sem_acento
      alter mapping for hword, hword_part, word with unaccent, portuguese_stem;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- O índice do texto
-- ---------------------------------------------------------------------------

alter table public.processos_artigos
  drop column if exists busca;

-- Peso A no título, B no conteúdo: um artigo chamado "Radar" ganha de um que
-- só cita radar de passagem. Sem os pesos, o ranking trata as duas coisas como
-- iguais e o resultado óbvio some no meio da lista.
alter table public.processos_artigos
  add column busca tsvector
  generated always as (
    setweight(to_tsvector('public.portugues_sem_acento'::regconfig, coalesce(titulo, '')),   'A') ||
    setweight(to_tsvector('public.portugues_sem_acento'::regconfig, coalesce(conteudo, '')), 'B')
  ) stored;

comment on column public.processos_artigos.busca is
  'Titulo (peso A) + conteudo (peso B) em portugues sem acento. Coluna gerada: '
  'se refaz sozinha a cada edicao, sem gatilho e sem carga inicial.';

create index if not exists processos_artigos_busca_idx
  on public.processos_artigos using gin (busca);

-- ---------------------------------------------------------------------------
-- A consulta
-- ---------------------------------------------------------------------------

create or replace function public.fn_buscar_processos(p_termo text)
returns table (
  id             uuid,
  titulo         text,
  categoria_id   uuid,
  categoria_nome text,
  categoria_icone text,
  trecho         text
)
language plpgsql
stable
-- SECURITY INVOKER (o padrão): a função enxerga o que quem chamou enxerga, e a
-- RLS de `processos_artigos` continua valendo. Definer aqui abriria por baixo
-- a porta que a migration anterior acabou de fechar.
as $fn$
declare
  v_expr  text;
  v_query tsquery;
begin
  -- Tudo que não é letra ou número vira espaço ANTES de montar a tsquery. É o
  -- que impede um "&" ou ":" digitado na busca de virar operador e derrubar a
  -- consulta com erro de sintaxe -- `to_tsquery` lança exceção com entrada mal
  -- formada, e a tela mostraria erro em vez de "nenhum resultado".
  select string_agg(w || ':*', ' & ')
    into v_expr
    from unnest(regexp_split_to_array(
           regexp_replace(coalesce(p_termo, ''), '[^[:alnum:][:space:]]', ' ', 'g'),
           '\s+')) w
   where length(w) > 0;

  if v_expr is null then return; end if;

  -- `:*` em cada palavra: a busca acontece enquanto se digita, e sem o prefixo
  -- "aprend" não acharia "aprendizado" até a palavra terminar.
  v_query := to_tsquery('public.portugues_sem_acento'::regconfig, v_expr);

  return query
  select
    a.id,
    a.titulo,
    a.categoria_id,
    coalesce(c.nome, '')  as categoria_nome,
    coalesce(c.icone, '📋') as categoria_icone,
    -- O trecho com a palavra encontrada, para a pessoa ver POR QUE aquele
    -- artigo apareceu. Os marcadores são «» e não <b>: quem renderiza é o
    -- React, e devolver HTML daqui exigiria injetá-lo cru na página.
    ts_headline(
      'public.portugues_sem_acento'::regconfig,
      -- Sem a marcação do Markdown e com os espaços colapsados: o trecho é para
      -- LER, e "**arquivo vivo**" com quebras de linha no meio da frase é
      -- ruído. O tsvector continua sendo o do texto original — limpar aqui só
      -- muda o que se MOSTRA, nunca o que casa.
      btrim(regexp_replace(
        regexp_replace(coalesce(a.conteudo, ''), '[*#`_>]', ' ', 'g'),
        '\s+', ' ', 'g')),
      v_query,
      'StartSel=«, StopSel=», MaxWords=24, MinWords=10, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'
    ) as trecho
  from public.processos_artigos a
  left join public.processos_categorias c on c.id = a.categoria_id
  where a.ativo
    and a.busca @@ v_query
  order by ts_rank(a.busca, v_query) desc, a.titulo
  limit 40;
end;
$fn$;

comment on function public.fn_buscar_processos(text) is
  'Busca titulo e conteudo dos processos, em portugues sem acento e com prefixo '
  '(acha enquanto se digita). Devolve um trecho com a palavra entre « », para a '
  'tela mostrar por que o artigo apareceu.';

revoke execute on function public.fn_buscar_processos(text) from public, anon;
grant  execute on function public.fn_buscar_processos(text) to authenticated;
