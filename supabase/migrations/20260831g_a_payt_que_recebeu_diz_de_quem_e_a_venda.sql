/*
  A partir de 01/09/2026 são duas Payts: uma da Alaskan, outra da Aeliss.

  Cada uma tem a sua chave de integração, e é ela que diz de quem é a venda. Não
  o produto, não o funil, não a conta de anúncio — a conta que RECEBEU o dinheiro.
  É o dado mais confiável que existe para essa pergunta, e o único com 100% de
  cobertura: 60% das vendas históricas não têm funil nem conta de anúncio.

  Do lado do banco isso é só o caminho do carimbo:

      webhook  →  vendas_payt.empresa_id  →  vendas.empresa_id

  `fn_normalizar_venda_payt` passa a levar a empresa adiante. Ela entra no INSERT
  e fica FORA do `ON CONFLICT DO UPDATE`: quando a Payt reenvia o mesmo pedido
  (mudança de status, reembolso), tudo se atualiza menos o dono. Uma venda não
  troca de empresa depois de nascer.

  O ARQUIVO REESCREVE O TEXTO DA FUNÇÃO, DE NOVO POR ÂNCORA

  Mesma razão de `20260831e`: redigitar 7,8 KB de função para mexer em duas
  linhas é convite a erro de transcrição em cima de dinheiro. Se qualquer âncora
  não for encontrada, a migração levanta exceção e não aplica nada.
*/

ALTER TABLE vendas_payt ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES empresas(id);

COMMENT ON COLUMN vendas_payt.empresa_id IS
  'Qual Payt recebeu — resolvido no webhook pela chave de integracao que bateu. '
  'Segue para vendas.empresa_id e nunca mais muda.';

/*
  Tudo que ja existe veio da unica Payt que havia ate hoje.

  O GATILHO PRECISA SAIR DO CAMINHO, E NAO E DETALHE

  `vendas_payt` tem `trg_normalizar_venda_payt` em INSERT **e UPDATE**. Tocar a
  coluna nova nas 12.782 linhas chamaria `fn_normalizar_venda_payt` uma vez por
  linha — e cada chamada roda `fn_herdar_origem_do_upsell()`, que faz um UPDATE
  varrendo `vendas` inteira. Doze mil varreduras da tabela toda.

  A primeira tentativa desta migracao fez exatamente isso e estourou o timeout;
  a transacao voltou inteira e nada ficou pela metade. Aqui o gatilho e desligado
  dentro da propria transacao: quem estiver escrevendo espera o lock e so volta a
  gravar depois do COMMIT, ja com o gatilho ligado. Nao existe janela em que uma
  venda entre sem ser normalizada.
*/
ALTER TABLE vendas_payt DISABLE TRIGGER trg_normalizar_venda_payt;

UPDATE vendas_payt SET empresa_id = (SELECT id FROM empresas WHERE slug = 'alaskan')
 WHERE empresa_id IS NULL;

ALTER TABLE vendas_payt ENABLE TRIGGER trg_normalizar_venda_payt;

CREATE INDEX IF NOT EXISTS vendas_payt_empresa_idx ON vendas_payt (empresa_id);

do $migracao$
DECLARE
  def  text;
  novo text;
BEGIN
  def := pg_get_functiondef('public.fn_normalizar_venda_payt(vendas_payt)'::regprocedure);

  -- 1. A coluna entra na lista do INSERT.
  novo := replace(def,
    '    ad_id_meta, payload_webhook, funil_id, cart_id' || E'\n' || '  ) VALUES (',
    '    ad_id_meta, payload_webhook, funil_id, cart_id, empresa_id' || E'\n' || '  ) VALUES (');
  IF novo = def THEN
    RAISE EXCEPTION 'fn_normalizar_venda_payt: lista de colunas do INSERT nao encontrada';
  END IF;

  -- 2. E o valor, no fim da lista de VALUES.
  def  := novo;
  novo := replace(def,
    '    NULLIF(p_vp.payload_raw->>''cart_id'', '''')' || E'\n' || '  )' || E'\n' || '  ON CONFLICT',
    '    NULLIF(p_vp.payload_raw->>''cart_id'', ''''), p_vp.empresa_id' || E'\n' || '  )' || E'\n' || '  ON CONFLICT');
  IF novo = def THEN
    RAISE EXCEPTION 'fn_normalizar_venda_payt: lista de VALUES do INSERT nao encontrada';
  END IF;

  /*
    A garantia que importa: `empresa_id` NAO pode aparecer no DO UPDATE. Se
    aparecesse, um reenvio da Payt reatribuiria a venda — que e exatamente o
    congelamento que este desenho existe para dar.
  */
  IF substring(novo from position('ON CONFLICT (pedido_id) DO UPDATE' in novo))
       LIKE '%empresa_id%' THEN
    RAISE EXCEPTION 'fn_normalizar_venda_payt: empresa_id vazou para o DO UPDATE';
  END IF;

  EXECUTE novo;
END
$migracao$;
