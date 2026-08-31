/*
  A Aeliss começa em 01/09/2026, e o dinheiro precisa saber de quem é.

  A REGRA, EM UMA LINHA

    Quem escreve dinheiro CARIMBA a empresa. O resto DERIVA do projeto.

  Ou seja: `vendas`, `transacoes` e `metricas_meta` guardam a empresa na própria
  linha, no momento em que ela nasce, e nunca mais mudam. Produção, criativos,
  funis e UTMs continuam derivando de `ofertas_editores.empresa_id`, e por isso
  acompanham o projeto quando ele troca de dono.

  Foi assim que a decisão dela se traduziu em desenho: "muda tudo que não esteja
  ligado ao financeiro, financeiro deve congelar".

  POR QUE CARIMBAR, E NÃO DERIVAR TAMBÉM AQUI

  Porque a derivação não alcança. Medido hoje, das 14.063 vendas:

      3.885  têm funil
      1.743  têm só a conta de anúncio
      8.435  não têm nem funil nem conta   ← 60%

  Derivar empresa do projeto deixaria 8.475 vendas (60%) sem dono. A conta que
  RECEBEU o dinheiro sabe sempre — e a partir de 01/09 são duas Payts e duas
  contas bancárias, uma de cada empresa. O carimbo tem 100% de cobertura porque
  vem de quem recebeu, não de quem foi atribuído.

  E carimbar é o que faz o passado congelar sem nenhum mecanismo extra: quando
  Desafios e Guia virarem Aeliss, as vendas de agosto continuam Alaskan porque
  foi a Alaskan que as recebeu. Sem tabela de histórico, sem data de corte
  escrita em lugar nenhum.

  O QUE ESTA MIGRAÇÃO NÃO FAZ

  Não põe NOT NULL. Uma venda que chegue por um caminho que o gatilho não
  resolva seria RECUSADA, e recusar venda é pior do que uma venda sem etiqueta.
  A cobertura é medida por `vw_dinheiro_sem_empresa`, que existe para isso — sem
  tela de resultado, ninguém volta para conferir.

  A COR NÃO ENTRA AQUI

  `empresas` ganha `slug`, não `cor`. A identidade da Alaskan vive nos tokens de
  `src/index.css`; um hex no banco seria a mesma dívida com um esconderijo pior.
  O slug é o que a interface usa para escolher o token (`--empresa-alaskan`).
*/

-- ── 1. A empresa ganha identidade ────────────────────────────────────────────

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS cnpj text;

UPDATE empresas SET slug = 'alaskan' WHERE nome = 'Alaskan Academy' AND slug IS NULL;
UPDATE empresas SET slug = 'aeliss'  WHERE nome = 'Aeliss Ltda'     AND slug IS NULL;
UPDATE empresas SET slug = 'ravenna' WHERE nome = 'Ravenna Group'   AND slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS empresas_slug_key ON empresas (slug);

COMMENT ON COLUMN empresas.slug IS
  'Identificador estavel para a interface escolher o token de cor em index.css '
  '(--empresa-<slug>). Nunca guardar hex aqui: a identidade vive no CSS.';

-- ── 2. As três tabelas de dinheiro ganham dono ───────────────────────────────

ALTER TABLE vendas        ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES empresas(id);
ALTER TABLE transacoes    ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES empresas(id);
ALTER TABLE metricas_meta ADD COLUMN IF NOT EXISTS empresa_id uuid REFERENCES empresas(id);

COMMENT ON COLUMN vendas.empresa_id IS
  'Carimbado no nascimento pela Payt que recebeu — nunca derivado do projeto, e '
  'nunca reescrito. E o que faz o faturamento passado congelar quando um projeto '
  'troca de empresa.';
COMMENT ON COLUMN transacoes.empresa_id IS
  'Carimbado pela conta bancaria de onde veio o extrato. Imutavel.';
COMMENT ON COLUMN metricas_meta.empresa_id IS
  'Carimbado no INSERT a partir da conta de anuncio. O UPSERT do sync NAO o '
  'reescreve — senao a Meta, que reapresenta ate 28 dias, reatribuiria o passado.';

/*
  Tudo que existe hoje e da Alaskan. Nao ha nada da Aeliss no banco: a operacao
  dela comeca em 01/09/2026.
*/
UPDATE vendas        SET empresa_id = (SELECT id FROM empresas WHERE slug='alaskan') WHERE empresa_id IS NULL;
UPDATE transacoes    SET empresa_id = (SELECT id FROM empresas WHERE slug='alaskan') WHERE empresa_id IS NULL;
UPDATE metricas_meta SET empresa_id = (SELECT id FROM empresas WHERE slug='alaskan') WHERE empresa_id IS NULL;

CREATE INDEX IF NOT EXISTS vendas_empresa_data_idx        ON vendas (empresa_id, data_venda);
CREATE INDEX IF NOT EXISTS transacoes_empresa_data_idx    ON transacoes (empresa_id, data);
CREATE INDEX IF NOT EXISTS metricas_meta_empresa_data_idx ON metricas_meta (empresa_id, data);

-- ── 3. O carimbo, e a garantia de que ele não se reescreve ───────────────────

/*
  A conta de anuncio sabe de qual projeto e, e o projeto sabe de qual empresa.
  O sync da Meta faz upsert de ate 28 dias para tras toda madrugada, entao um
  carimbo ja dado tem de sobreviver a isso.
*/
CREATE OR REPLACE FUNCTION fn_carimbar_empresa_metricas()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  /*
    Carimbo ja dado e carimbo definitivo: o upsert da madrugada nao o reescreve.
    Linha que ficou SEM dono ainda pode ganhar um — senao uma conta que chegou
    antes do projeto ficaria orfa para sempre, sem jeito de consertar.
  */
  IF TG_OP = 'UPDATE' AND OLD.empresa_id IS NOT NULL THEN
    NEW.empresa_id := OLD.empresa_id;
    RETURN NEW;
  END IF;

  IF NEW.empresa_id IS NULL THEN
    SELECT o.empresa_id INTO NEW.empresa_id
      FROM ad_accounts a
      JOIN ofertas_editores o ON o.id = a.projeto_id
     WHERE a.id = NEW.ad_account_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_carimbar_empresa_metricas ON metricas_meta;
CREATE TRIGGER trg_carimbar_empresa_metricas
  BEFORE INSERT OR UPDATE ON metricas_meta
  FOR EACH ROW EXECUTE FUNCTION fn_carimbar_empresa_metricas();

/*
  A venda: o webhook manda a empresa (e a partir de 01/09 e a chave da Payt que
  diz qual). Este gatilho e so a rede de baixo, para insercao que venha por
  outro caminho — e ele NAO discorda de quem manda, porque so age quando o
  campo chegou vazio.

  Cobre 40% das vendas historicas. Nao e falha do gatilho: e a razao pela qual o
  carimbo do webhook precisa existir.
*/
CREATE OR REPLACE FUNCTION fn_carimbar_empresa_venda()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  /*
    So preenche o que esta vazio — nunca sobrescreve.

    Num UPDATE que nao mencione a coluna, o Postgres ja traz o valor antigo em
    NEW, entao o carimbo se preserva sozinho: a venda que muda de `pendente`
    para `aprovada` (e depois para `reembolsada`) mantem a empresa sem que este
    gatilho precise fazer nada. E uma correcao deliberada continua possivel.
  */
  IF NEW.empresa_id IS NULL THEN
    SELECT o.empresa_id INTO NEW.empresa_id
      FROM ofertas_editores o
     WHERE o.id = coalesce(
             (SELECT f.projeto_id FROM funis       f WHERE f.id = NEW.funil_id),
             (SELECT a.projeto_id FROM ad_accounts a WHERE a.id = NEW.ad_account_id));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_carimbar_empresa_venda ON vendas;
CREATE TRIGGER trg_carimbar_empresa_venda
  BEFORE INSERT OR UPDATE ON vendas
  FOR EACH ROW EXECUTE FUNCTION fn_carimbar_empresa_venda();

-- ── 4. A tela de resultado do carimbo ────────────────────────────────────────

/*
  Cadastro sem coluna de resultado envelhece em silencio. Se alguma linha de
  dinheiro comecar a nascer sem dono, e aqui que aparece — com o valor em jogo,
  que e o que faz alguem olhar.
*/
CREATE OR REPLACE VIEW vw_dinheiro_sem_empresa AS
  SELECT 'vendas'        AS tabela, count(*) AS linhas,
         round(coalesce(sum(valor_total), 0), 2) AS valor,
         max(data_venda::date) AS mais_recente
    FROM vendas WHERE empresa_id IS NULL
  UNION ALL
  SELECT 'transacoes', count(*), round(coalesce(sum(valor), 0), 2), max(data)
    FROM transacoes WHERE empresa_id IS NULL
  UNION ALL
  SELECT 'metricas_meta', count(*), round(coalesce(sum(investimento), 0), 2), max(data)
    FROM metricas_meta WHERE empresa_id IS NULL;

COMMENT ON VIEW vw_dinheiro_sem_empresa IS
  'Linhas de dinheiro que nasceram sem empresa. Deve ficar em zero; se subir, o '
  'carimbo deixou de alcancar algum caminho de entrada.';

REVOKE ALL ON vw_dinheiro_sem_empresa FROM anon;
GRANT SELECT ON vw_dinheiro_sem_empresa TO authenticated;
