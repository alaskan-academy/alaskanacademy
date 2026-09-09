-- A view de checkouts leva o `eh_vsl` junto
--
-- Defeito meu, do commit que criou a marcação da VSL (20260908b). Acrescentei
-- `eh_vsl` em `funil_checkouts` e passei a pedir a coluna na tela --
--
--   .select('id,url,titulo,funil_id,eh_funil,eh_vsl,vendas,…')
--
-- -- mas nunca a acrescentei em `vw_checkouts_a_confirmar`, que é de onde a
-- tela lê. O PostgREST recusa a consulta INTEIRA quando não conhece uma das
-- colunas pedidas, então `data` voltava nulo e a lista ficava vazia.
--
-- E não era só o seletor: `todos` alimenta as DUAS listas do componente, então
-- "Checkouts deste REV" também aparecia vazio, em todo REV. Medido agora: a
-- view tem 119 checkouts, 95 deles sem REV — a tela mostrava zero dos dois
-- lados desde 08/09.
--
-- O erro chegava a virar toast ("Erro ao carregar checkouts"), mas quem estava
-- com o cadastro aberto lia primeiro a lista vazia, que não parece defeito:
-- parece que não há checkout livre. Foi como ela descreveu.
--
-- É a armadilha 3 com outra roupa: a lista de colunas do `select` é uma lista
-- fixa no código, e a coluna nova entrou de um lado só.
--
-- `CREATE OR REPLACE VIEW` só aceita coluna NOVA no fim, e é onde ela entra. O
-- resto do corpo é o que já estava no banco, palavra por palavra.

CREATE OR REPLACE VIEW public.vw_checkouts_a_confirmar AS
 SELECT c.id,
    c.url,
    c.titulo,
    c.funil_id,
    c.eh_funil,
    f.nome AS rev_nome,
    p.nome AS projeto_nome,
    s.vendas,
    s.primeira_venda,
    s.ultima_venda,
    (regexp_match(c.titulo, '(?i)rev\s*0*(\d+)'::text))[1] AS rev_no_titulo,
    c.preco,
    s.preco_praticado,
    s.vendas_pendentes,
    -- A coluna que faltava. Marcada à mão, nunca deduzida do título: um
    -- checkout não diz sozinho se é o da VSL.
    c.eh_vsl
   FROM funil_checkouts c
     LEFT JOIN funis f ON f.id = c.funil_id
     LEFT JOIN ofertas_editores p ON p.id = f.projeto_id
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE v.status = 'aprovada'::status_venda) AS vendas,
            count(*) FILTER (WHERE v.status <> 'aprovada'::status_venda) AS vendas_pendentes,
            min(v.data_venda) FILTER (WHERE v.status = 'aprovada'::status_venda)::date AS primeira_venda,
            max(v.data_venda) FILTER (WHERE v.status = 'aprovada'::status_venda)::date AS ultima_venda,
            mode() WITHIN GROUP (ORDER BY v.valor_oferta_principal) FILTER (WHERE v.status = 'aprovada'::status_venda) AS preco_praticado
           FROM vendas v
          WHERE split_part(v.link_url, '?'::text, 1) = c.url AND NOT v.link_titulo IS DISTINCT FROM c.titulo) s ON true;
