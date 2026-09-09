-- A data do lançamento é a do Brasil, não a do UTC
--
-- O `cs-sync` gravava `String(tx.transactionDate).slice(0, 10)`. O carimbo da
-- Conta Simples vem em UTC, e o Brasil está três horas atrás — então toda
-- compra feita depois das 21h caía no dia seguinte.
--
-- Medido antes de mexer:
--
--   conta_simples_cartao   69 de 948 linhas no dia errado   R$ 51.262,51
--   conta_simples           6 de 374 linhas no dia errado   R$  2.628,93
--
-- Dia errado por si só já é ruim numa conciliação, mas o que estraga um
-- fechamento é a virada do MÊS, e seis linhas do cartão atravessaram:
--
--   março → abril      2 linhas   R$    56,41
--   maio  → junho      1 linha    R$ 2.286,58
--   junho → julho      1 linha    R$    97,93
--   agosto → setembro  2 linhas   R$ 1.693,00
--
-- Os R$ 1.693,00 são exatamente a diferença que a conferência de 09/09 achou
-- entre o extrato do cartão de agosto e o painel. Não era lançamento faltando:
-- era agosto fechando mais barato do que foi, e setembro mais caro.
--
-- ── A correção ───────────────────────────────────────────────────────────
--
-- Cada linha carrega o próprio carimbo em `payload_raw`, então a data certa
-- sai dela mesma — não há nada a adivinhar nem nada a buscar de fora. Só as
-- fontes da Conta Simples entram: `c6` e `inter` são digitadas à mão, não têm
-- carimbo, e a data delas é a que a pessoa leu no extrato.
--
-- O `cs-sync` foi corrigido junto, e é lá que a regra vive: converte para
-- America/Sao_Paulo antes de tirar a data. Esta migração alcança o passado; o
-- importador mantém o presente. Sem as duas metades, as linhas voltariam a
-- nascer torta amanhã de madrugada.
--
-- Uso a zona IANA e não "menos três horas" de propósito: o Brasil aboliu o
-- horário de verão em 2019, mas fixar o deslocamento no código seria uma lista
-- fixa envelhecendo em silêncio — a armadilha 3 na forma de fuso.

UPDATE public.transacoes t
   SET data = ((t.payload_raw->>'transactionDate')::timestamptz
                 at time zone 'America/Sao_Paulo')::date
 WHERE t.fonte in ('conta_simples', 'conta_simples_cartao')
   AND t.payload_raw->>'transactionDate' is not null
   AND t.data <> ((t.payload_raw->>'transactionDate')::timestamptz
                    at time zone 'America/Sao_Paulo')::date;

-- Não sobrou nenhuma. Se a conta estiver errada, a migração falha aqui em vez
-- de deixar meia correção gravada.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.transacoes t
   WHERE t.fonte in ('conta_simples', 'conta_simples_cartao')
     AND t.payload_raw->>'transactionDate' is not null
     AND t.data <> ((t.payload_raw->>'transactionDate')::timestamptz
                      at time zone 'America/Sao_Paulo')::date;
  IF n <> 0 THEN
    RAISE EXCEPTION 'ainda restam % linhas com a data fora do fuso do Brasil', n;
  END IF;
END $$;
