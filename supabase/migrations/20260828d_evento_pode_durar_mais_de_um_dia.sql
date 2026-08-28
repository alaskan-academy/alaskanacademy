-- ── Evento pode durar mais de um dia ──────────────────────────────────────
--
-- Feriado emendado, folga de uma semana, viagem: tudo isso era um evento por
-- dia, digitado um a um, e nada ligava um ao outro. Apagar "as ferias" queria
-- dizer apagar sete linhas e lembrar de todas.
--
-- `data` continua sendo o comeco. `data_fim` nulo quer dizer "um dia so", que
-- e o caso da esmagadora maioria e por isso e o padrao.
--
-- Por que NAO reaproveitei `recorrencia_fim`, que tambem e uma data de fim:
-- sao duas coisas diferentes e juntar as duas seria a primeira armadilha do
-- CLAUDE.md em pessoa. `recorrencia_fim` e ate quando a SERIE se repete -- a
-- reuniao de toda terca ate outubro, que sao varios eventos de um dia.
-- `data_fim` e quanto tempo UMA ocorrencia dura -- o feriado que pega de 24 a
-- 26, que e um evento so. Uma reuniao semanal de dois dias tem os dois campos
-- preenchidos, cada um dizendo o seu.
ALTER TABLE public.eventos
  ADD COLUMN IF NOT EXISTS data_fim date;

COMMENT ON COLUMN public.eventos.data_fim IS
  'Ultimo dia DESTA ocorrencia. Nulo = um dia so. Nao confundir com recorrencia_fim, que e ate quando a serie se repete.';

-- Fim antes do comeco nao existe, e um evento de mais de um ano quase sempre e
-- erro de digitacao numa data -- e, com recorrencia junto, seria a diferenca
-- entre desenhar dezenas e desenhar dezenas de milhares de celulas.
ALTER TABLE public.eventos
  DROP CONSTRAINT IF EXISTS eventos_data_fim_coerente;

ALTER TABLE public.eventos
  ADD CONSTRAINT eventos_data_fim_coerente
  CHECK (data_fim IS NULL OR (data_fim >= data AND data_fim <= data + 366));
