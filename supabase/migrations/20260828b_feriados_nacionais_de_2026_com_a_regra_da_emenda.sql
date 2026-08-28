-- Os feriados nacionais que faltam em 2026, e a regra da emenda.
--
-- A agenda estava VAZIA -- zero eventos -- e o mes na tela nao dizia nada. Com
-- os feriados dentro, ela passa a responder a pergunta que se faz aqui: quando
-- da para contar com a equipe.
--
-- ── Quais entram ──────────────────────────────────────────────────────────
--
-- Os nacionais, de hoje ate 31/12. Nao entram estaduais nem municipais: a
-- equipe esta espalhada e cada cidade tem os seus, entao chutar aqui criaria
-- folga que nao existe para uns e esconderia a que existe para outros.
--
-- 20/11 (Consciencia Negra) esta na lista porque virou feriado NACIONAL pela
-- Lei 14.759/2023 -- muita agenda antiga ainda o trata como estadual.
--
-- ── A regra da emenda ─────────────────────────────────────────────────────
--
-- Feriado na quinta puxa folga na sexta. Ela esta escrita abaixo e roda em
-- cima da lista, e nao a mao, para valer nos proximos anos sem ninguem ter que
-- lembrar.
--
-- Em 2026 ela NAO dispara nenhuma vez: dos seis, tres caem na segunda, dois na
-- sexta e um no domingo. A regra fica escrita mesmo assim, porque o ano que vem
-- nao vai ser tao bem-comportado.
--
-- ── Por que `feriado` e nao `folga` ───────────────────────────────────────
--
-- Neste sistema `folga` significa UMA pessoa fora: tem `pessoa_id` e alimenta a
-- lista "quem esta fora", que mostra o primeiro nome. Um dia em que a empresa
-- inteira para nao e isso -- e `feriado`, que e o que ele e para a agenda. A
-- emenda entra como feriado pelo mesmo motivo.
--
-- `participantes` leva todo mundo ativo, que e o "prevendo folga para toda a
-- equipe": derivado de `perfis`, e nao uma lista de ids escrita aqui, para
-- quem entrar na equipe depois nao ficar de fora.

INSERT INTO public.eventos (tipo, titulo, data, participantes, motivo)
WITH nacionais(data, nome) AS (VALUES
  (date '2026-09-07', 'Independência do Brasil'),
  (date '2026-10-12', 'Nossa Senhora Aparecida'),
  (date '2026-11-02', 'Finados'),
  (date '2026-11-15', 'Proclamação da República'),
  (date '2026-11-20', 'Consciência Negra'),
  (date '2026-12-25', 'Natal')
), equipe AS (
  SELECT array_agg(id) AS ids FROM public.perfis WHERE ativo
), com_emenda AS (
  -- O feriado em si.
  SELECT data, nome AS titulo, 'Feriado nacional' AS motivo FROM nacionais
  UNION ALL
  -- E a emenda, quando ele cai na quinta (dow = 4).
  SELECT data + 1, 'Emenda — ' || nome, 'Emenda: o feriado caiu na quinta'
    FROM nacionais WHERE extract(dow FROM data) = 4
)
SELECT 'feriado', c.titulo, c.data, e.ids, c.motivo
  FROM com_emenda c CROSS JOIN equipe e
 WHERE c.data >= current_date
   AND NOT EXISTS (
     SELECT 1 FROM public.eventos ev
      WHERE ev.data = c.data AND ev.tipo = 'feriado' AND ev.titulo = c.titulo
   );
