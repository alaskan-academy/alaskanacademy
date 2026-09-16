-- O HISTORICO RESPONDE RAPIDO POR QUEM APROVOU
--
-- A aba "O que eu aprovei" pergunta a `criativo_historico`:
--
--   usuario_id = eu
--   campo_alterado = 'fase'
--   valor_anterior in (as fases de revisao do meu setor)
--   order by criado_em desc
--
-- Sao exatamente as tres primeiras colunas, e a tabela so cresce -- ela ja
-- guarda 1.006 linhas de mudanca de fase e ganha uma a cada movimento de card.
-- Sem indice, a consulta e varredura da tabela inteira a cada abertura da aba.
--
-- `valor_anterior` fica FORA do indice de proposito: sao poucos valores
-- distintos (as fases), entao ele nao seleciona quase nada depois de
-- usuario_id + campo_alterado, e so engordaria a arvore.

create index if not exists idx_hist_usuario_fase
  on public.criativo_historico (usuario_id, campo_alterado, criado_em desc);

comment on index public.idx_hist_usuario_fase is
  'Para a aba "O que eu aprovei": as aprovacoes de uma pessoa, da mais recente para a mais antiga.';
