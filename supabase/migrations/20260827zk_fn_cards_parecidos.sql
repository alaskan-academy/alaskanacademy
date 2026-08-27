-- O aviso de "sem card" dizia o problema e parava ali.
--
-- Nove anúncios ficaram meses invisíveis por um zero a mais no nome. O aviso
-- dizia "nenhum card postado do tipo criativo tem este nome" e não dizia que
-- havia um card a um caractere de distância. Se dissesse, teriam sido nove
-- cliques em vez de meses — e o investimento teria tido dono desde o começo.
--
-- `pg_trgm` dá a semelhança por trigramas: quanto dos pedaços de três letras
-- os dois nomes têm em comum. "ad 006 h01 v011" contra "ad 006 h01 v11" dá
-- 0.93; contra "ad 041 h01 v04" dá 0.5.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── O card mais parecido com um nome de anúncio ─────────────────────────────
--
-- Devolve no máximo três, do mais parecido para o menos, e só acima de 0.55.
-- O corte existe para a tela não sugerir qualquer coisa: sugestão ruim é pior
-- que nenhuma, porque ensina a ignorar a sugestão.
--
-- NÃO vincula nada sozinho. A tela mostra, alguém confirma — a mesma distinção
-- entre 'sugerido' e 'confirmado' que o resto desta área já faz.
--
-- Conferido:
--   "AD 006 H01 V11X"  → AD 006 H01 V11 (82%), V17 (72%), V14 (72%)
--   "AD 015 H5 V04"    → AD 015 H04 V04 (75%)
--   "WSP_ONE_C13_G44"  → nada, e está certo: é outro padrão de nome
CREATE OR REPLACE FUNCTION public.fn_cards_parecidos(p_nome text, p_limite integer DEFAULT 3)
 RETURNS TABLE (producao_id uuid, nome text, editor text, projeto text, semelhanca real)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.nome, perf.nome::text, o.nome::text,
         similarity(fn_nome_criativo(p.nome), fn_nome_criativo(p_nome)) as semelhanca
    from producoes p
    left join perfis perf on perf.id = p.responsavel_id
    left join ofertas_editores o on o.id = p.projeto_id
   where p.fase = 'postado' and p.tipo = 'criativo'
     and similarity(fn_nome_criativo(p.nome), fn_nome_criativo(p_nome)) > 0.55
   order by semelhanca desc, p.criado_em desc
   limit greatest(p_limite, 1);
$function$;

COMMENT ON FUNCTION public.fn_cards_parecidos(text, integer) IS
  'Cards postados com nome parecido com o de um anuncio orfao. Serve para o aviso de "sem card" sugerir o conserto em vez de so apontar o problema.';
