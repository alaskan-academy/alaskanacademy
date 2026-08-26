-- O backfill precisa CORRIGIR, não só preencher.
--
-- Como estava, ele só tocava em vendas com `funil_id` nulo. Consequência: se
-- alguém atribuísse um checkout ao REV errado, rodasse, e depois corrigisse, as
-- vendas ficavam no REV errado para sempre — e nada na tela denunciaria, porque
-- o contador de "vendas ligadas" continuaria alto.
--
-- Isso não é hipótese: eu mesmo cometi o erro ao testar a tela. Cliquei numa
-- coordenada, caí em "Handify · REV2 - VSL" em vez de "Workshop Buquê de Velas ·
-- REV1", e 538 vendas foram para o funil errado. Só descobri porque o mapa de
-- REVs mostrou o checkout do Workshop pendurado no Handify.
--
-- Ela está prestes a atribuir 96 checkouts. Errar alguns é certo; o que não
-- pode é o erro ser irreversível.
--
-- A troca: a atribuição do checkout passa a ser a fonte da verdade, e uma
-- eventual edição manual de `vendas.funil_id` seria sobrescrita. Vale a pena
-- porque a interface não oferece editar venda por venda — ninguém tem essa
-- expectativa —, enquanto trocar o REV de um checkout é exatamente o que a tela
-- convida a fazer.

create or replace function public.fn_backfill_funil_das_vendas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.vendas v
     set funil_id = c.funil_id
    from public.funil_checkouts c
   where c.url = split_part(v.payload_webhook->'link'->>'url', '?', 1)
     and c.titulo is not distinct from (v.payload_webhook->'link'->>'title')
     -- `is distinct from` e não `<>`: com `<>`, uma venda cujo checkout foi
     -- desatribuído (funil_id volta a ser nulo) nunca seria limpa, porque
     -- comparação com null não dá verdadeiro.
     and v.funil_id is distinct from c.funil_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.fn_backfill_funil_das_vendas() is
  'Reconcilia vendas.funil_id com a atribuição atual dos checkouts. Corrige '
  'divergências e limpa o que foi desatribuído, não só preenche vazios — senão '
  'um erro de atribuição fica gravado para sempre.';

revoke execute on function public.fn_backfill_funil_das_vendas() from public, anon;
grant execute on function public.fn_backfill_funil_das_vendas() to authenticated, service_role;
