-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A fila de mover para de cobrar quem nasceu no lugar certo              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `vw_documentos_a_mover` definia a fila como "não tem linha com `ok` em
-- `documentos_movidos`". Isso estava certo para os 212 da migração, e errado
-- para todo documento criado DEPOIS dela: eles nascem na estrutura nova, nunca
-- precisaram ser movidos, e nunca ganharam o marcador — então entram na fila e
-- ficam lá para sempre.
--
-- Apareceu no mesmo dia. Às 15:38 de 08/10/2026 a fila marcava 20, e os 20 eram
-- notas de ferramenta de setembro que ela acabara de subir, já no caminho certo
-- e já espelhadas. Nada a fazer com nenhuma delas.
--
-- O preço de deixar assim não é o número errado: é a fila deixar de ser sinal.
-- Uma contagem que nunca zera é uma contagem que ninguém olha, e aí o dia em
-- que ela subir de verdade não vai dizer nada a ninguém. É a segunda armadilha
-- pelo avesso — medir sem que a medida signifique algo.
--
-- A definição passa a ser o que a pergunta realmente é: **o `storage_path` está
-- fora da forma canônica?** Derivado do próprio caminho e do slug da empresa,
-- não de uma data de corte no código — documento novo entra certo e fica fora
-- da fila sozinho, documento torto entra na fila mesmo que alguém já tenha
-- tentado movê-lo antes.
--
-- O lado do Drive não aparece na condição porque SQL não tem como olhar o
-- Drive. Ele não precisa: `espelhar()` e `moverUm()` montam a pasta pela MESMA
-- `pastaDoDocumento`, então documento com o Storage certo tem o Drive certo. O
-- que sobra de visível é o passo que falhou, e esse continua na fila pela
-- linha com `ok = false`.

-- `drop` e não `create or replace`: a view antiga tinha as colunas
-- `storage_pronto` e `drive_pronto`, e o Postgres não deixa renomear coluna
-- num replace. Sem `cascade`, de propósito — se algo depender dela, quero o
-- erro, não a dependência levada junto em silêncio.
--
-- O `with (security_invoker = on)` vai na PRÓPRIA instrução: recriar uma view
-- redefine as reloptions, e omitir APAGA a opção que estava lá. Foi assim que
-- `vw_alertas` e `vw_rev_tendencia` voltaram a rodar com os direitos do dono
-- em 04/10/2026, legíveis por `anon`.
drop view if exists public.vw_documentos_a_mover;

create view public.vw_documentos_a_mover
with (security_invoker = on) as
select d.id, d.storage_path, d.criado_em,
       -- A forma canônica, escrita uma vez e usada nas três colunas abaixo.
       (e.slug || '/' || to_char(d.competencia, 'YYYY-MM') || '/' ||
        case d.tipo when 'servico'     then 'servicos'
                    when 'comprovante' then 'comprovantes'
                    else                    'ferramentas' end || '/' ||
        regexp_replace(d.storage_path, '^.*/', ''))        as caminho_canonico,
       d.storage_path <> (
         e.slug || '/' || to_char(d.competencia, 'YYYY-MM') || '/' ||
         case d.tipo when 'servico'     then 'servicos'
                     when 'comprovante' then 'comprovantes'
                     else                    'ferramentas' end || '/' ||
         regexp_replace(d.storage_path, '^.*/', '')
       )                                                   as fora_do_lugar,
       exists (select 1 from public.documentos_movidos m
                where m.documento_id = d.id and not m.ok)  as passo_falhou
from public.documentos_fiscais d
join public.empresas e on e.id = d.empresa_id
where d.storage_path is not null
  and (
    -- Está no lugar errado...
    d.storage_path <> (
      e.slug || '/' || to_char(d.competencia, 'YYYY-MM') || '/' ||
      case d.tipo when 'servico'     then 'servicos'
                  when 'comprovante' then 'comprovantes'
                  else                    'ferramentas' end || '/' ||
      regexp_replace(d.storage_path, '^.*/', '')
    )
    -- ...ou alguém tentou mexer nele e não conseguiu.
    or exists (select 1 from public.documentos_movidos m
                where m.documento_id = d.id and not m.ok)
  )
order by d.criado_em;

comment on view public.vw_documentos_a_mover is
  'Documento cujo storage_path não está na forma {empresa}/{aaaa-mm}/{tipo}/, '
  'ou cujo passo de movimento falhou. Documento criado já no lugar certo NÃO '
  'entra: a fila mede trabalho a fazer, não ausência de marcador.';

-- ── A prova ────────────────────────────────────────────────────────────────
-- Zerar não basta: tem de zerar PELO MOTIVO certo, e voltar a acusar quando um
-- documento sai do lugar.

do $$
declare
  v_fila   int;
  v_vitima uuid;
  v_antes  text;
  v_opts   text;
begin
  -- A reloption voltou junto? A catraca do projeto lê as migrações, mas a
  -- conta aqui é barata e pega o caso de alguém editar este arquivo depois.
  select coalesce(reloptions::text, '(nenhuma)') into v_opts
  from pg_class where relname = 'vw_documentos_a_mover';
  if v_opts !~ 'security_invoker=on' then
    raise exception 'PROVA FALHOU: a view voltou sem security_invoker (%).', v_opts;
  end if;

  select count(*) into v_fila from public.vw_documentos_a_mover;
  if v_fila <> 0 then
    raise exception 'PROVA FALHOU: a fila deveria estar vazia, tem %.', v_fila;
  end if;

  -- Torce um caminho e confere que a fila acusa. Só o `storage_path` da linha,
  -- sem tocar no arquivo: o `update` é desfeito logo abaixo, e o gatilho do
  -- espelho corta sozinho porque `drive_url` está preenchido.
  select id, storage_path into v_vitima, v_antes
  from public.documentos_fiscais where storage_path is not null limit 1;

  update public.documentos_fiscais
     set storage_path = 'torto/' || regexp_replace(v_antes, '^.*/', '')
   where id = v_vitima;

  select count(*) into v_fila from public.vw_documentos_a_mover;

  update public.documentos_fiscais set storage_path = v_antes where id = v_vitima;

  if v_fila <> 1 then
    raise exception 'PROVA FALHOU: com um documento torto a fila deveria ter 1, tem %.', v_fila;
  end if;

  select count(*) into v_fila from public.vw_documentos_a_mover;
  if v_fila <> 0 then
    raise exception 'PROVA FALHOU: o desfazer nao devolveu a fila a zero (%).', v_fila;
  end if;

  raise notice 'PROVA OK: invoker no lugar, fila em zero, acusa caminho torto e volta a zero.';
end $$;
