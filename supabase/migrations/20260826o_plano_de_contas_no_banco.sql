-- O DRE lia uma lista de categorias escrita no código-fonte.
--
-- Ela reparou que faltava informação. Faltava mesmo: R$ 10.065,58 de despesa em
-- agosto não apareciam, porque as categorias criadas depois de o DRE ser
-- escrito não estavam na lista fixa em `constants.ts`:
--
--   Editor de Vídeo   R$ 7.468,00   <- o maior, os pagamentos das editoras
--   Hospedagem/Infra  R$   759,52
--   Mídia             R$   600,60
--   Contábil          R$   569,70
--   Automação/Mkt     R$   438,36
--   Tokens            R$   138,33
--   Domínios          R$    91,07
--
-- A tela dizia R$ 109.591,19 de despesa quando o real era R$ 119.602,87. O
-- resultado saía inflado no mesmo tanto, e a lista envelhecia em silêncio a
-- cada categoria nova que ela criasse no campo.
create or replace view public.vw_plano_de_contas as
select cc.categoria,
       cc.centro_custo as grupo,
       cc.tipo,
       cc.ordem,
       coalesce(c.ordem, 999) as ordem_grupo
  from public.categorias_centro cc
  left join public.centros_custo c on c.nome = cc.centro_custo
 where cc.ativo;

comment on view public.vw_plano_de_contas is
  'As categorias como ela as mantém, com grupo e tipo. O DRE lê daqui em vez de ter a lista escrita no código — categoria nova aparece sozinha.';

grant select on public.vw_plano_de_contas to authenticated;

-- "Retirada do Caixa" é o oposto de "Reserva de Caixa", não um custo.
--
-- Estava com tipo 'custo' e sumia do bloco de reserva, que mostrava só as
-- saídas. Ela pediu para ver as retiradas ali também, e está certa: sem elas o
-- bloco dizia que R$ 15.500 saíram para a reserva em agosto e escondia que
-- R$ 4.000 voltaram.
--
-- Não vira receita: é dinheiro próprio mudando de conta, e contar como receita
-- inflaria o faturamento com o próprio caixa.
update public.categorias_centro
   set tipo = 'reserva'
 where categoria = 'Retirada do Caixa';
