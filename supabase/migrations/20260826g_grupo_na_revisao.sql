-- O grupo na tela de revisão, e um fornecedor que rotulava R$ 524 mil errado.
--
-- ── O rótulo errado ────────────────────────────────────────────────────────
-- Ela mandou um print pedindo a coluna do grupo, e no print havia um anúncio de
-- São Paulo chamado "Meta - WhatsApp". Existiam DOIS fornecedores com o mesmo
-- padrão `FACEBK`:
--
--   Meta - WhatsApp   padrão FACEBK   prioridade 50   <- vencia
--   Meta Ads          padrão FACEBK   prioridade 70
--
-- Menor prioridade ganha, então os 551 anúncios -- R$ 524.426 de mídia --
-- apareciam como "Meta - WhatsApp". Mesmo erro da regra `FACEBK -> WhatsApp`
-- que corrigi hoje: intenção certa, alcance grosso demais.
update public.fornecedores
   set padrao = '650-5434800',
       nota = 'Cobrança de conversa do WhatsApp, pelos cartões •••• 7488 e •••• 4353. O padrão era "FACEBK" e pegava os 575 lançamentos, inclusive R$ 524 mil de mídia.'
 where nome = 'Meta - WhatsApp' and padrao = 'FACEBK';

-- ── A coluna do grupo ──────────────────────────────────────────────────────
-- `grupo` vem de `categorias_centro`, e NÃO do `centro_custo` cru do CS.
--
-- Não é detalhe: os 31 lançamentos de WhatsApp chegaram do CS marcados como
-- "Softwares e Ferramentas". Mostrar aquele valor faria a tela de conferência
-- exibir um grupo e o relatório somar outro -- que é o pior tipo de tela, a que
-- parece conferir e não confere.
--
-- A coluna entra no FIM: `create or replace view` não deixa inserir no meio
-- ("cannot change name of view column"). A ordem na tabela é decidida no
-- front-end de qualquer forma.
create or replace view public.vw_transacoes_revisao as
select t.id,
       t.data,
       t.descricao,
       t.valor,
       t.categoria,
       t.centro_custo,
       t.status_revisao,
       t.categoria_origem,
       t.fonte,
       t.created_at,
       fn_fornecedor(t.descricao, - t.valor) as fornecedor,
       (select f.definido from fornecedores f
         where f.ativo and f.nome = fn_fornecedor(t.descricao, - t.valor)
         order by f.definido, f.prioridade limit 1) as fornecedor_definido,
       coalesce((select f.padrao from fornecedores f
                  where f.ativo and f.tipo_match = 'contains'
                    and f.nome = fn_fornecedor(t.descricao, - t.valor)
                  order by f.prioridade limit 1), t.descricao) as padrao_sugerido,
       (t.payload_raw -> 'card') ->> 'maskedNumber' as cartao,
       coalesce(cc.centro_custo, nullif(trim(t.centro_custo), '')) as grupo
  from transacoes t
  left join categorias_centro cc on cc.categoria = trim(t.categoria);

comment on column public.vw_transacoes_revisao.grupo is
  'Centro resolvido por categorias_centro, igual ao do relatório. Cai no centro_custo do CS só quando a categoria não está mapeada.';
