-- Regras apontando para categoria que não existe mais.
--
-- Ela mandou varrer os fornecedores procurando o padrão do OpenAI: separação
-- feita, categoria criada, lançamentos antigos deixados para trás. A varredura
-- achou três coisas, e uma delas foi eu me corrigindo.
--
-- ── Correção do que escrevi no commit anterior ─────────────────────────────
-- Eu disse que `OPENAI -> Tokens` e `OPENAI *CHATGPT SUBSCR -> IAs`, ambas em
-- confiança 1.00, decidiam "por sorteio". É FALSO. `aplicar_categorizacao` já
-- ordena por `confianca desc, length(padrao) desc` -- o padrão mais longo, ou
-- seja o mais específico, sempre ganha o empate.
--
-- Simulado com as duas em 1.00: a mensalidade recebe IAs, o token recebe
-- Tokens. Sempre recebeu. Baixar a confiança para 0.98 foi inofensivo, mas o
-- motivo que registrei estava errado.
--
-- ── O problema de verdade ──────────────────────────────────────────────────
-- QUATRO regras ativas mandavam para "Edição de Vídeo", categoria que deixou de
-- existir quando ela renomeou para "Editor de Vídeo" pelo campo:
--
--   JAQUELINE COELHO · jaqueline coelho silva · jessica maihato candido
--   bruna leopoldo · 61.781.468 BRUNA LEOPOLDO FERMINO
--
-- É o mesmo estrago que já tinha atingido `categorias_mapa`: renomear no campo
-- não arrasta regra nem mapa junto. E uma regra órfã não avisa -- ela
-- simplesmente grava um nome de categoria que nenhuma tela reconhece.
update public.regras_categoria r
   set categoria = 'Editor de Vídeo'
 where r.ativo
   and r.categoria = 'Edição de Vídeo'
   and not exists (select 1 from public.categorias_centro cc where cc.categoria = r.categoria);

-- A rede, para não depender de alguém desconfiar de novo.
create or replace view public.vw_regras_orfas as
select r.id, r.padrao, r.tipo_match, r.categoria as categoria_inexistente, r.confianca,
       (select count(*) from public.transacoes t
         where t.status_revisao not in ('confirmado','revisado')
           and lower(t.descricao) like '%'||lower(r.padrao)||'%') as pendentes_que_ela_pegaria
  from public.regras_categoria r
  left join public.categorias_centro cc on cc.categoria = r.categoria
 where r.ativo and cc.categoria is null;

comment on view public.vw_regras_orfas is
  'Regras ativas que mandam para uma categoria que não existe mais. Renomear categoria no campo não arrasta as regras junto — isto mostra o estrago.';

grant select on public.vw_regras_orfas to authenticated;
