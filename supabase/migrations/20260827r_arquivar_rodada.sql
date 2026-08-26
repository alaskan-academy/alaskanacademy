-- Arquivar uma rodada: tira da vista sem negar que ela existiu.
--
-- Dois verbos que parecem o mesmo e não são, e a diferença é o que decide o
-- espelho:
--
--   arquivar  mexe na VISTA      -- aconteceu, não interessa mais na lista.
--                                   O Sheets e o Obsidian continuam com ela:
--                                   perder histórico é pior que uma linha
--                                   parada, que é a mesma regra já aplicada às
--                                   abas de REV que somem do cadastro.
--   excluir   mexe na EXISTÊNCIA -- não deveria ter existido (rodada de teste).
--                                   Aí sim sai do banco, da planilha e do vault.
--
-- Sem esta coluna o único jeito de limpar a lista era apagar, e apagar o que
-- aconteceu de verdade é perder o registro que o módulo existe para guardar.

alter table public.analises
  add column if not exists arquivada_em timestamptz;

comment on column public.analises.arquivada_em is
  'Fora da lista por padrão, mas continua no banco e nos espelhos. Para "isto '
  'não deveria existir", apagar a linha — o arquivo é para "isto existiu e não '
  'interessa mais".';

-- A rodada aberta é retomada ao abrir a tela; arquivada não deve ser retomada,
-- ou arquivar uma rodada em andamento a traria de volta no recarregar seguinte.
create index if not exists analises_abertas_idx
  on public.analises (data desc)
  where fechada_em is null and arquivada_em is null;
