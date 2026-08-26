-- O processo vira uma lista de BLOCOS: texto, imagem, vídeo e HTML.
--
-- O formulário tinha três campos soltos — um textarea de Markdown, uma URL de
-- vídeo e uma lista de URLs de imagem — e a ordem entre eles era fixa: vídeo
-- sempre no topo, imagens sempre no fim. Não dava para explicar um passo,
-- mostrar o print dele, e só então o vídeo.
--
-- Quatro tipos:
--   texto   HTML vindo do editor rico (TipTap)
--   imagem  { url, legenda }
--   video   { url }              — embed do Panda
--   html    { html }             — a escotilha, para o que os outros não fazem
--
-- `imagem` não estava no pedido, mas o campo `imagens` já existia: sem ele
-- aqui, migrar para blocos REMOVERIA uma capacidade que a tela tinha.
--
-- ---------------------------------------------------------------------------
-- A conversão, e por que ela não é um bloco só
-- ---------------------------------------------------------------------------
--
-- O caminho óbvio seria: todo o Markdown vira um bloco de texto. Isso PERDERIA
-- conteúdo em silêncio, e só na primeira vez que alguém abrisse o editor.
--
-- O TipTap monta o documento a partir do HTML e descarta o que não conhece. O
-- StarterKit conhece título, parágrafo, lista, citação e regra — não conhece
-- TABELA nem IMAGEM. Dos 9 artigos, 1 tem tabela e 1 tem imagem: as duas
-- sobreviveriam à migration e morreriam no primeiro `Editar`.
--
-- Por isso o Markdown é FATIADO antes: tabela vira bloco `html`, imagem em
-- linha própria vira bloco `imagem`, e o resto vira blocos de `texto`.

alter table public.processos_artigos
  add column if not exists blocos jsonb not null default '[]'::jsonb;

comment on column public.processos_artigos.blocos is
  'Lista ordenada de blocos: {tipo: texto|imagem|video|html, dados: {...}}. '
  'Substitui conteudo/video_url/imagens, que ficam para tras como registro do '
  'que foi convertido.';

-- ---------------------------------------------------------------------------
-- Markdown → HTML, no subconjunto que o MarkdownRenderer entendia
-- ---------------------------------------------------------------------------

create or replace function public.fn_md_inline(p text)
returns text
language sql
immutable
as $$
  -- Ordem importa: escapar o HTML ANTES, senão um "<" escrito por alguém
  -- viraria tag; e negrito antes de itálico, senão "**x**" vira "*<em>x</em>*".
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   replace(replace(replace(coalesce(p,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                   '\[([^\]]+)\]\(([^)]+)\)', '<a href="\2">\1</a>', 'g'),
                 '\*\*([^*]+)\*\*', '<strong>\1</strong>', 'g'),
               '(^|[^*])\*([^*]+)\*', '\1<em>\2</em>', 'g'),
             '`([^`]+)`', '<code>\1</code>', 'g'),
           '~~([^~]+)~~', '<s>\1</s>', 'g');
$$;

create or replace function public.fn_md_para_html(p_md text)
returns text
language plpgsql
immutable
as $$
declare
  linhas text[] := string_to_array(coalesce(p_md, ''), E'\n');
  i int := 1;
  n int := coalesce(array_length(linhas, 1), 0);
  l text;
  out text := '';
  buffer text := '';
begin
  while i <= n loop
    l := linhas[i];

    if l ~ '^### '      then out := out || '<h3>' || fn_md_inline(substr(l, 5)) || '</h3>'; i := i + 1;
    elsif l ~ '^## '    then out := out || '<h2>' || fn_md_inline(substr(l, 4)) || '</h2>'; i := i + 1;
    elsif l ~ '^# '     then out := out || '<h2>' || fn_md_inline(substr(l, 3)) || '</h2>'; i := i + 1;
    elsif l ~ '^\s*---+\s*$' then out := out || '<hr>'; i := i + 1;

    elsif l ~ '^\d+\.\s' then
      buffer := '';
      while i <= n and linhas[i] ~ '^\d+\.\s' loop
        buffer := buffer || '<li>' || fn_md_inline(regexp_replace(linhas[i], '^\d+\.\s+', '')) || '</li>';
        i := i + 1;
      end loop;
      out := out || '<ol>' || buffer || '</ol>';

    elsif l ~ '^[-*]\s' then
      buffer := '';
      while i <= n and linhas[i] ~ '^[-*]\s' loop
        buffer := buffer || '<li>' || fn_md_inline(regexp_replace(linhas[i], '^[-*]\s+', '')) || '</li>';
        i := i + 1;
      end loop;
      out := out || '<ul>' || buffer || '</ul>';

    elsif l ~ '^>\s?' then
      buffer := '';
      while i <= n and linhas[i] ~ '^>\s?' loop
        buffer := buffer || case when buffer = '' then '' else ' ' end
                         || fn_md_inline(regexp_replace(linhas[i], '^>\s?', ''));
        i := i + 1;
      end loop;
      out := out || '<blockquote><p>' || buffer || '</p></blockquote>';

    elsif btrim(l) = '' then
      i := i + 1;

    else
      -- Parágrafo: junta linhas seguidas até a próxima linha em branco ou o
      -- próximo começo de bloco.
      buffer := '';
      while i <= n and btrim(linhas[i]) <> ''
            and linhas[i] !~ '^(#{1,3}\s|\d+\.\s|[-*]\s|>|\||!\[)' loop
        buffer := buffer || case when buffer = '' then '' else ' ' end || fn_md_inline(linhas[i]);
        i := i + 1;
      end loop;
      if buffer <> '' then out := out || '<p>' || buffer || '</p>'; end if;
    end if;
  end loop;

  return out;
end;
$$;

create or replace function public.fn_md_tabela_para_html(p_md text)
returns text
language plpgsql
immutable
as $$
declare
  linhas text[] := string_to_array(p_md, E'\n');
  i int; n int := coalesce(array_length(linhas,1),0);
  celulas text[]; c text;
  cabecalho text := ''; corpo text := '';
begin
  for i in 1..n loop
    -- A linha separadora (|---|---|) não vira nada.
    continue when linhas[i] ~ '^\|[\s\-:|]+\|?\s*$';
    celulas := string_to_array(btrim(linhas[i], '|'), '|');
    if i = 1 then
      foreach c in array celulas loop
        cabecalho := cabecalho || '<th>' || fn_md_inline(btrim(c)) || '</th>';
      end loop;
    else
      corpo := corpo || '<tr>';
      foreach c in array celulas loop
        corpo := corpo || '<td>' || fn_md_inline(btrim(c)) || '</td>';
      end loop;
      corpo := corpo || '</tr>';
    end if;
  end loop;
  return '<table><thead><tr>' || cabecalho || '</tr></thead><tbody>' || corpo || '</tbody></table>';
end;
$$;

-- ---------------------------------------------------------------------------
-- O fatiador
-- ---------------------------------------------------------------------------

create or replace function public.fn_md_para_blocos(p_md text)
returns jsonb
language plpgsql
immutable
as $$
declare
  linhas text[] := string_to_array(coalesce(p_md, ''), E'\n');
  i int := 1; n int := coalesce(array_length(linhas,1),0);
  blocos jsonb := '[]'::jsonb;
  acumulado text := '';
  pedaco text;
  m text[];
begin
  -- Fecha o texto acumulado como um bloco antes de emitir outro tipo.
  while i <= n loop
    if linhas[i] ~ '^\|' then
      if btrim(acumulado) <> '' then
        blocos := blocos || jsonb_build_array(jsonb_build_object(
          'tipo','texto','dados', jsonb_build_object('html', fn_md_para_html(acumulado))));
        acumulado := '';
      end if;
      pedaco := '';
      while i <= n and linhas[i] ~ '^\|' loop
        pedaco := pedaco || case when pedaco = '' then '' else E'\n' end || linhas[i];
        i := i + 1;
      end loop;
      blocos := blocos || jsonb_build_array(jsonb_build_object(
        'tipo','html','dados', jsonb_build_object('html', fn_md_tabela_para_html(pedaco))));

    elsif btrim(linhas[i]) ~ '^!\[[^\]]*\]\([^)]+\)$' then
      if btrim(acumulado) <> '' then
        blocos := blocos || jsonb_build_array(jsonb_build_object(
          'tipo','texto','dados', jsonb_build_object('html', fn_md_para_html(acumulado))));
        acumulado := '';
      end if;
      m := regexp_match(btrim(linhas[i]), '^!\[([^\]]*)\]\(([^)]+)\)$');
      blocos := blocos || jsonb_build_array(jsonb_build_object(
        'tipo','imagem','dados', jsonb_build_object('url', m[2], 'legenda', m[1])));
      i := i + 1;

    else
      acumulado := acumulado || case when acumulado = '' then '' else E'\n' end || linhas[i];
      i := i + 1;
    end if;
  end loop;

  if btrim(acumulado) <> '' then
    blocos := blocos || jsonb_build_array(jsonb_build_object(
      'tipo','texto','dados', jsonb_build_object('html', fn_md_para_html(acumulado))));
  end if;

  return blocos;
end;
$$;

-- ---------------------------------------------------------------------------
-- A conversão dos que já existiam
-- ---------------------------------------------------------------------------

-- Vídeo primeiro, que era onde ele aparecia no desenho antigo; depois o texto
-- fatiado; e as imagens soltas no fim, que era onde a tela as mostrava.
--
-- Conferido antes de aplicar, comparando original e resultado: as 15 URLs dos
-- dois artigos que têm link sobreviveram todas, e as únicas palavras que
-- "sumiam" na comparação eram pedaços de URL que passaram a viver dentro do
-- atributo `href` — invisíveis para quem tira as tags, presentes no HTML.
update public.processos_artigos a set blocos =
  case when a.video_url is not null and btrim(a.video_url) <> ''
       then jsonb_build_array(jsonb_build_object('tipo','video','dados', jsonb_build_object('url', a.video_url)))
       else '[]'::jsonb end
  || fn_md_para_blocos(a.conteudo)
  || coalesce((select jsonb_agg(jsonb_build_object('tipo','imagem','dados', jsonb_build_object('url', u, 'legenda','')))
                 from unnest(coalesce(a.imagens, '{}')) u), '[]'::jsonb)
where a.blocos = '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- A busca passa a ler os blocos
-- ---------------------------------------------------------------------------

create or replace function public.fn_texto_dos_blocos(p_blocos jsonb)
returns text
language sql
immutable
as $$
  select coalesce(btrim(regexp_replace(regexp_replace(
    (select string_agg(
              coalesce(b->'dados'->>'html', '') || ' ' || coalesce(b->'dados'->>'legenda', ''),
              ' ' order by ord)
       from jsonb_array_elements(coalesce(p_blocos, '[]'::jsonb)) with ordinality t(b, ord)),
    '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

comment on function public.fn_texto_dos_blocos(jsonb) is
  'Texto puro de dentro dos blocos: tira as tags e junta html + legenda. Usado '
  'pela coluna de busca e pelo trecho do resultado.';

alter table public.processos_artigos drop column if exists busca;

-- `conteudo` continua na conta enquanto existir: um artigo que ainda não passou
-- pelo editor novo tem o texto lá, e tirá-lo da busca agora faria a pesquisa
-- piorar no dia da migration.
alter table public.processos_artigos
  add column busca tsvector
  generated always as (
    setweight(to_tsvector('public.portugues_sem_acento'::regconfig, coalesce(titulo, '')), 'A') ||
    setweight(to_tsvector('public.portugues_sem_acento'::regconfig, coalesce(conteudo, '')), 'B') ||
    setweight(to_tsvector('public.portugues_sem_acento'::regconfig, fn_texto_dos_blocos(blocos)), 'B')
  ) stored;

create index if not exists processos_artigos_busca_idx
  on public.processos_artigos using gin (busca);

revoke execute on function public.fn_texto_dos_blocos(jsonb) from public, anon;
grant  execute on function public.fn_texto_dos_blocos(jsonb) to authenticated;
