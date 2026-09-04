-- A TRANSACAO GANHA NOME PROPRIO
--
-- Ela reclamou: "eu edito o nome da transacao e nao salva". Salva — o problema
-- e outro, e maior.
--
-- O campo "Nome do fornecedor" grava em `fornecedores`, com upsert em
-- (nome, padrao). Como o NOME faz parte da chave, renomear nao atualiza:
-- INSERE uma linha nova competindo com a anterior pelo mesmo padrao. E
-- `fn_fornecedor_info` desempata por (valores is null, prioridade,
-- length(padrao)) — os tres iguais entre as concorrentes. O vencedor virava a
-- ordem FISICA da tabela, que muda sozinha num VACUUM: a tela mostrava um nome
-- hoje e outro depois, sem ninguem ter mexido em nada.
--
-- O ESTRAGO ACUMULADO
--
--     JESSICA GAVAZZA PEISINO   5 nomes competindo
--     MINISTERIO DA FAZENDA     Impostos (DARF) | (INSS) | (SIMPLES) | (PARCELAMENTO)
--     LUCAS DOS SANTOS VEIGA    Lucas Veiga | Swipe
--     OPENAI                    OpenAI (API) | OpenAI (Token)
--
-- Todos sao o MESMO pagador com propositos diferentes. Nao e digitacao
-- repetida: e ela usando um campo de fornecedor como memo da transacao, porque
-- memo da transacao nao existia. Treze linhas de alguem batendo na mesma
-- parede — isso e requisito, nao erro de uso.
--
-- O CAMPO NOVO
--
-- `transacoes.apelido` — o nome DESTE lancamento. As telas mostram
-- `coalesce(apelido, fn_fornecedor(...))`: o apelido manda quando existe, o
-- nome do fornecedor continua valendo para todo o resto.
--
-- Nao sao "dois campos dizendo a mesma coisa": sao ESCOPOS diferentes, como a
-- aliquota geral e a da empresa em `configuracoes`. O especifico ganha, e o
-- formulario agora pergunta qual dos dois ela quer.
--
-- E `descricao` continua intocada: e o que o banco mandou, e as duas telas
-- mostram os dois nomes, um sobre o outro.
--
-- O DESEMPATE VIRA DETERMINISTICO
--
-- As concorrentes que ja existem ficam onde estao — apagar quatro rotulos dela
-- seria jogar fora trabalho que ela fez, e nao da para saber a qual lancamento
-- cada um pertencia. O que muda e o criterio: a mais RECENTE ganha, sempre.

ALTER TABLE transacoes ADD COLUMN IF NOT EXISTS apelido text;

COMMENT ON COLUMN transacoes.apelido IS
  'O nome DESTE lancamento, quando o nome do fornecedor nao basta. Ex.: tres '
  'PIX para a mesma pessoa que sao aporte, retirada e recarga de chip. Nulo '
  'significa "usa o nome do fornecedor".';

CREATE OR REPLACE FUNCTION public.fn_fornecedor_info(p_descricao text, p_valor numeric DEFAULT NULL::numeric)
 RETURNS TABLE(nome text, definido boolean)
 LANGUAGE sql
 STABLE
AS $function$
  select f.nome, f.definido
    from public.fornecedores f
   where f.ativo
     and ( (f.tipo_match = 'contains' and upper(p_descricao) like '%' || upper(f.padrao) || '%')
        or (f.tipo_match = 'regex'    and p_descricao ~* f.padrao) )
     and ( f.valores is null
        or (p_valor is not null and round(abs(p_valor), 2) = any (f.valores)) )
   -- Regra com valor ganha da generica: mais especifica primeiro.
   -- `criado_em desc` no fim porque sem ele o empate entre nomes concorrentes
   -- era resolvido pela ordem FISICA da tabela: a tela mostrava um nome hoje e
   -- outro depois de um VACUUM, sem ninguem ter mexido em nada.
   order by (f.valores is null), f.prioridade, length(f.padrao) desc, f.criado_em desc
   limit 1;
$function$;

-- As duas telas passam a preferir o apelido. Reescrita ancorada: le a definicao
-- viva e troca so a expressao do nome, porque as views tem dezenas de colunas e
-- copia-las inteiras aqui seria convidar divergencia com o que esta no banco.
DO $mig$
DECLARE v_def text; v_de text; v_para text; v_n int;
BEGIN
  v_de   := 'fn_fornecedor(t.descricao, - t.valor) AS fornecedor';
  v_para := 'COALESCE(t.apelido, fn_fornecedor(t.descricao, - t.valor)) AS fornecedor';
  v_def  := rtrim(btrim(pg_get_viewdef('vw_transacoes_revisao'::regclass, true)), ';');
  IF position(v_para IN v_def) = 0 THEN
    v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
    IF v_n <> 1 THEN RAISE EXCEPTION 'ancora da revisao bate %x, esperava 1', v_n; END IF;
    EXECUTE 'CREATE OR REPLACE VIEW vw_transacoes_revisao AS ' || replace(v_def, v_de, v_para);
  END IF;

  v_de   := 'fn_fornecedor(t.descricao, - t.valor) AS nome';
  v_para := 'COALESCE(t.apelido, fn_fornecedor(t.descricao, - t.valor)) AS nome';
  v_def  := rtrim(btrim(pg_get_viewdef('vw_conciliacao'::regclass, true)), ';');
  IF position(v_para IN v_def) = 0 THEN
    v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
    IF v_n <> 1 THEN RAISE EXCEPTION 'ancora da conciliacao bate %x, esperava 1', v_n; END IF;
    EXECUTE 'CREATE OR REPLACE VIEW vw_conciliacao AS ' || replace(v_def, v_de, v_para);
  END IF;
END
$mig$;
