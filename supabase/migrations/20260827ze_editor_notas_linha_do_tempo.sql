-- O blob de observações vira linha do tempo — na tabela que JÁ EXISTIA.
--
-- Eu ia criar `editor_notas` do zero. Olhando de novo, `editor_promocoes` já
-- era ela com o tipo implícito: editor_id, cargo_id, data, observacao,
-- criado_em. Criar uma segunda seria a primeira armadilha do CLAUDE.md — duas
-- tabelas dizendo a mesma coisa divergem sempre, e esta já tinha 3 registros.
--
-- O que faltava era o TIPO. Sem ele a tabela só aceitava promoção, e o resto —
-- call de feedback, mudança de salário, plano de evolução — não tinha onde
-- caber. Foi para um campo de texto ao lado, que se reescreve inteiro a cada
-- save e não guarda quem escreveu nem quando.
--
-- O sintoma estava na tela: o perfil mostrava 3.000 caracteres de observação
-- e, logo abaixo, "Histórico de promoções — Sem registros".

ALTER TABLE public.editor_promocoes ADD COLUMN tipo text NOT NULL DEFAULT 'promocao';
ALTER TABLE public.editor_promocoes ADD COLUMN autor_id uuid REFERENCES public.perfis(id);

-- `cargo_id` era obrigatório, e fazia sentido numa tabela só de promoções.
-- Numa nota de feedback não há cargo nenhum para apontar. Deixa de ser
-- obrigatório sempre e passa a ser obrigatório QUANDO for promoção — que é a
-- afirmação verdadeira, e a que o banco consegue garantir.
ALTER TABLE public.editor_promocoes ALTER COLUMN cargo_id DROP NOT NULL;

ALTER TABLE public.editor_promocoes
  ADD CONSTRAINT editor_notas_tipo_valido
  CHECK (tipo IN ('promocao', 'feedback', 'remuneracao'));

ALTER TABLE public.editor_promocoes
  ADD CONSTRAINT editor_notas_promocao_tem_cargo
  CHECK (tipo <> 'promocao' OR cargo_id IS NOT NULL);

ALTER TABLE public.editor_promocoes RENAME COLUMN observacao TO texto;
ALTER TABLE public.editor_promocoes RENAME TO editor_notas;

COMMENT ON TABLE public.editor_notas IS
  'Linha do tempo do editor: promocao, feedback e remuneracao. Era `editor_promocoes`, que so aceitava promocao — o resto vivia num blob de texto em `editores`.';

-- ── As 7 entradas do blob viram notas ───────────────────────────────────────
--
-- O texto tinha a data digitada à mão no começo de cada entrada
-- ("12/05/26 — Call de feedback..."). O corte usa isso: marca cada data com um
-- separador e divide. Conferido ANTES de gravar — 3 notas para uma editora e 4
-- para a outra, com inícios coerentes.
--
-- O tipo sai do próprio texto: quem fala de salário ou R$ vira 'remuneracao',
-- o resto é 'feedback'. Não há autor: o blob não guardava quem escreveu, e
-- inventar um seria pior do que admitir que não se sabe.
WITH limpo AS (
  SELECT r.editor_id,
         btrim(regexp_replace(
           regexp_replace(r.observacoes, '</p>|<br\s*/?>', E'\n', 'gi'),
           '<[^>]+>', '', 'g')) AS texto
    FROM public.editores_remuneracao r
   WHERE r.observacoes IS NOT NULL AND btrim(r.observacoes) <> ''
),
marcado AS (
  SELECT editor_id,
         regexp_replace(texto, '(\d{2}/\d{2}/\d{2,4})\s*[—–-]\s*', E'\x01\\1\x02', 'g') AS texto
    FROM limpo
),
partes AS (
  SELECT editor_id, btrim(p) AS parte
    FROM marcado, regexp_split_to_table(marcado.texto, E'\x01') AS p
)
INSERT INTO public.editor_notas (editor_id, data, texto, tipo)
SELECT editor_id,
       to_date(split_part(parte, E'\x02', 1), 'DD/MM/YY'),
       btrim(split_part(parte, E'\x02', 2)),
       CASE WHEN split_part(parte, E'\x02', 2) ~* '(sal[áa]rio|R\$ ?[0-9]|aumento)'
            THEN 'remuneracao' ELSE 'feedback' END
  FROM partes
 WHERE parte <> ''
   AND strpos(parte, E'\x02') > 0
   AND btrim(split_part(parte, E'\x02', 2)) <> '';

-- ── A mesma regra das avaliações ────────────────────────────────────────────
-- Nota de carreira é do editor e de quem o conduz. Escrever é de quem conduz.
ALTER TABLE public.editor_notas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read  ON public.editor_notas;
DROP POLICY IF EXISTS authenticated_write ON public.editor_notas;

CREATE POLICY editor_notas_leitura ON public.editor_notas
  FOR SELECT TO authenticated
  USING (fn_ve_o_time() OR editor_id = fn_meu_editor_id());

CREATE POLICY editor_notas_escrita ON public.editor_notas
  FOR ALL TO authenticated
  USING (fn_ve_o_time())
  WITH CHECK (fn_ve_o_time());

-- `editores_remuneracao.observacoes` FICA por enquanto, de propósito: o corte
-- foi automático e ela precisa conferir antes de o original sumir. Sai numa
-- migração seguinte, depois do aceite.
