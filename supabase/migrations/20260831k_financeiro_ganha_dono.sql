/*
  O Financeiro é onde a separação mais importa, porque é o que vai para a
  contabilidade. A Aeliss tem conta bancária, NFs e conciliação próprias.

  `transacoes.empresa_id` já existe desde `20260831f`. Falta o resto do caminho:
  as views que leem a tabela precisam levar a coluna adiante, e três tabelas
  vizinhas precisam da sua.

  A COLUNA ENTRA NO FIM, SEMPRE

  `CREATE OR REPLACE VIEW` só aceita coluna nova no fim da lista — no meio, ele
  recusa. Por isso `empresa_id` aparece por último em todas, mesmo onde ficaria
  mais natural ao lado de `id`.

  CAIXA_CONFIG É POR EMPRESA PORQUE SALDO INICIAL É DE UMA CONTA

  A tabela guarda o saldo de partida da Reserva. Com duas contas bancárias, um
  saldo único faria a Reserva da Aeliss começar com o dinheiro da Alaskan — e
  como o número existiria e teria cara de certo, ninguém desconfiaria dele.

  DOCUMENTOS_FISCAIS TAMBÉM

  Ela disse: NF e conciliação separadas para a contabilidade. Uma nota da Aeliss
  aparecendo no checklist da Alaskan é erro que só o contador pega, meses depois.
*/

-- ── 1. As views levam a empresa adiante ──────────────────────────────────────

do $migracao$
DECLARE
  alvo text;
  def  text;
  novo text;
BEGIN
  FOREACH alvo IN ARRAY ARRAY[
    'vw_transacoes_revisao',
    'vw_conciliacao',
    'vw_custos_categoria_mes',
    'vw_divergencias_confirmadas'
  ] LOOP
    def := 'CREATE OR REPLACE VIEW public.' || alvo || ' AS'
        || pg_get_viewdef(('public.' || alvo)::regclass, true);

    /* Todas terminam a lista de colunas logo antes de `FROM transacoes t`. */
    novo := replace(def,
      E'\n   FROM transacoes t',
      E',\n    t.empresa_id\n   FROM transacoes t');
    IF novo = def THEN
      RAISE EXCEPTION '%: nao achei o FROM transacoes', alvo;
    END IF;

    /* A agregada precisa da coluna no GROUP BY também. Uma transação pertence a
       uma empresa só, então isto não muda a granularidade — só carrega o dado. */
    IF alvo = 'vw_custos_categoria_mes' THEN
      def  := novo;
      novo := replace(def,
        '  GROUP BY (date_trunc(',
        '  GROUP BY t.empresa_id, (date_trunc(');
      IF novo = def THEN
        RAISE EXCEPTION '%: nao achei o GROUP BY', alvo;
      END IF;
    END IF;

    EXECUTE novo;
  END LOOP;
END
$migracao$;

-- ── 2. Saldo inicial e nota fiscal ganham dono ───────────────────────────────

ALTER TABLE caixa_config       ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES empresas(id);
ALTER TABLE documentos_fiscais ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES empresas(id);

COMMENT ON COLUMN caixa_config.empresa_id IS
  'Saldo de partida da Reserva e de uma CONTA BANCARIA, e cada empresa tem a '
  'sua. Nulo = a configuracao antiga, que vale como a da Alaskan.';
COMMENT ON COLUMN documentos_fiscais.empresa_id IS
  'De quem e a nota. NF e conciliacao sao separadas por empresa para a '
  'contabilidade.';

UPDATE caixa_config       SET empresa_id = (SELECT id FROM empresas WHERE slug='alaskan') WHERE empresa_id IS NULL;
UPDATE documentos_fiscais SET empresa_id = (SELECT id FROM empresas WHERE slug='alaskan') WHERE empresa_id IS NULL;

CREATE INDEX IF NOT EXISTS documentos_fiscais_empresa_idx ON documentos_fiscais (empresa_id, competencia);
