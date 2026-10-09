-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Reprovar exige investimento, volume e ROAS JUNTOS                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Definido por ela em 10/10/2026, olhando a tela: "tem que analisar
-- investimento, volume de venda e ROAS para esta decisão".
--
-- Cada uma das três sozinha mente. ROAS com 2 vendas é ruído. Volume sem ROAS
-- ignora se dá lucro. Verba sozinha não diz nada sobre resultado. O ramo final
-- da régua usava só a ausência das outras — "tudo que não valida, reprova" — e
-- isso é mais duro do que ela definiu ("se zero vendas ou abaixo de 1,6
-- cortamos").
--
-- ── Os dois cards que mostraram o defeito ────────────────────────────────
--
--   AD 092 H04 V01   R$ 141,32   4 vendas   ROAS 3,38   -> dizia "Não validado"
--   AD 083 H06 V02   R$ 136,72   2 vendas   ROAS 1,46   -> dizia "Não validado"
--
-- Os dois postados em 06/10, três dias de vida. Ela marcou "Sem dados" nos
-- dois, à mão, e estava certa nos dois. O primeiro paga mais de duas vezes o
-- empate e era chamado de reprovado; o segundo está abaixo do empate mas com
-- R$ 137 de verba, que não é evidência de nada.
--
-- ── A peça que faltava: QUANTAS CHANCES A VERBA COMPROU ──────────────────
--
-- No empate, uma venda pode custar no máximo `AOV / empate`. Logo:
--
--     chances = investimento / (AOV_do_projeto / empate)
--
-- Um card só pode ser julgado se a verba dele comprava pelo menos tantas
-- chances quanto o MENOR corte de vendas da régua exige — hoje 5. Abaixo
-- disso, a ausência de resultado não é notícia sobre o criativo: é falta de
-- oportunidade.
--
-- Nos dois cards acima: AOV do projeto R$ 102,86, custo máximo por venda
-- R$ 65,94, e R$ 137 compram **2,1 chances**. Precisariam de ~R$ 330. Os dois
-- viram "Sem dados" — concordando com ela.
--
-- ── Por que AOV do PROJETO, e não CPA ────────────────────────────────────
--
-- Medido, o CPA varia de R$ 48 (Workshop Buquê) a R$ 122 (Saponária): uma
-- mediana global trataria os dois como iguais, e Saponária precisa do dobro de
-- verba para a mesma chance.
--
-- Mas CPA é péssimo denominador, e o dado mostra por quê: "Desafios na Sala de
-- Aula" tem CPA de R$ 928,55 — porque vendeu 2 vezes em R$ 1.857. Usar CPA
-- daria a um projeto que vende mal um denominador gigante, "chances" perto de
-- zero, e NADA seria reprovado lá. Exatamente ao contrário do que deveria.
--
-- AOV é preço de produto, não desempenho. Ele não piora quando o projeto vai
-- mal, e é por isso que ele serve de régua para julgar o projeto.
--
-- ── E o piso de chances é DERIVADO ───────────────────────────────────────
--
-- `chances_min` não é parâmetro novo: é `min(vendas_min)` dos níveis vigentes.
-- "A verba tinha de comprar pelo menos o que o nível mais fácil exige." Mexer
-- na régua move o piso junto, sem ninguém lembrar de mexer nos dois.
--
-- `verba_min` (os R$ 80, um ticket) continua na tabela e continua valendo como
-- piso absoluto. Na prática ele nunca morde — 5 chances custam mais que um
-- ticket em qualquer projeto —, mas ele é a regra que ela escreveu e some
-- junto se alguém zerar o crivo.
--
-- ── O quarto desfecho: teve chance, dá lucro, não alcança a régua ────────
--
-- São 10 cards, ROAS médio 1,64 — acima do empate de 1,56 e abaixo do 1,65 que
-- o Validado pede. Não são "Sem dados" (têm 20,8 vendas de média) e não são de
-- cortar (dão lucro). A régua NÃO DECIDE: devolve nulo com o motivo, e eles vão
-- para a fila dela — o mesmo tratamento dos cards em que as fontes discordam,
-- pela mesma razão (carimbar um palpite ali é pior que perguntar).
--
-- ── O efeito, medido ─────────────────────────────────────────────────────
--
--   antes   314 reprovados, dos quais 23 davam lucro (R$ 22.780 de receita)
--   agora   123 reprovados, ROAS médio 0,85 com 26 vendas de média — evidência
--           de sobra — carregando R$ 324.333 de verba
--
-- Os reprovados caem à metade e passam a ser perdedores de verdade.

begin;

create or replace view public.vw_criativo_avaliacao_sugerida
  with (security_invoker = on) as
with crivo as (
  select * from public.vw_crivo_vigente
),
-- O menor corte de vendas da régua: quantas chances a verba precisa ter
-- comprado para o card ser julgável. Derivado, nunca digitado.
piso as (
  select min(n.vendas_min) as chances_min from public.vw_crivo_niveis_vigentes n
),
met as (
  select * from public.fn_criativos_metricas(null, null)
),
base as (
  select p.id                        as producao_id,
         p.projeto_id,
         p.avaliacao,
         p.avaliacao_origem,
         coalesce(m.investimento, 0) as investimento,
         coalesce(m.vendas, 0)       as vendas,
         coalesce(m.roas, 0)         as roas,
         coalesce(m.receita, 0)      as receita,
         coalesce(m.vendas_meta, 0)  as vendas_meta,
         coalesce(m.roas_meta, 0)    as roas_meta
    from public.producoes p
    left join met m on m.producao_id = p.id
   where p.fase = 'postado'
     and p.tipo = 'criativo'
),
-- O ticket de cada projeto, do que ele realmente vendeu. Preço de produto,
-- não desempenho: não piora quando o projeto vai mal.
aov_projeto as (
  select b.projeto_id, sum(b.receita) / nullif(sum(b.vendas), 0) as aov
    from base b where b.vendas > 0 group by b.projeto_id
),
aov_geral as (
  select sum(b.receita) / nullif(sum(b.vendas), 0) as aov from base b where b.vendas > 0
),
chance as (
  select b.*,
         coalesce(ap.aov, ag.aov) as aov_ref,
         -- No empate, uma venda pode custar no máximo AOV/empate.
         case when coalesce(ap.aov, ag.aov) is null or c.empate = 0 then null
              else b.investimento / (coalesce(ap.aov, ag.aov) / c.empate) end as chances
    from base b
    left join aov_projeto ap on ap.projeto_id = b.projeto_id
   cross join aov_geral ag
   cross join crivo c
),
julgado as (
  select ch.*,
         c.id        as crivo_versao_id,
         c.empate,
         c.verba_min,
         p.chances_min,
         -- Teve chance de verdade? Precisa passar do ticket E ter comprado
         -- pelo menos o menor corte de vendas da régua.
         (ch.investimento > c.verba_min
          and ch.chances is not null
          and ch.chances >= p.chances_min) as teve_chance,
         -- A escada pela PAYT. Nulo = a régua não decide.
         case
           when not (ch.investimento > c.verba_min
                     and ch.chances is not null
                     and ch.chances >= p.chances_min) then c.nivel_sem_verba
           else coalesce(
             (select n.nivel from public.vw_crivo_niveis_vigentes n
               where ch.vendas >= n.vendas_min
                 and case when n.roas_inclusivo then ch.roas >= n.roas_min
                          else ch.roas > n.roas_min end
               order by n.ordem desc limit 1),
             case when ch.roas < c.empate then c.nivel_reprovado else null end)
         end as por_payt,
         -- A mesma escada pelo META.
         case
           when not (ch.investimento > c.verba_min
                     and ch.chances is not null
                     and ch.chances >= p.chances_min) then c.nivel_sem_verba
           else coalesce(
             (select n.nivel from public.vw_crivo_niveis_vigentes n
               where ch.vendas_meta >= n.vendas_min
                 and case when n.roas_inclusivo then ch.roas_meta >= n.roas_min
                          else ch.roas_meta > n.roas_min end
               order by n.ordem desc limit 1),
             case when ch.roas_meta < c.empate then c.nivel_reprovado else null end)
         end as por_meta
    from chance ch cross join crivo c cross join piso p
),
aprovados as (
  select distinct nivel, ordem from public.vw_crivo_niveis_vigentes
)
select j.producao_id,
       j.avaliacao,
       j.avaliacao_origem,
       j.crivo_versao_id,
       j.investimento,
       j.vendas,
       j.roas,
       j.vendas_meta,
       j.roas_meta,
       j.por_payt,
       j.por_meta,
       (j.avaliacao_origem is null or j.avaliacao_origem = 'automatico') as no_escopo,
       case
         when j.por_payt is null or j.por_meta is null then null
         when j.por_payt = j.por_meta then j.por_payt
         when ap.nivel is not null and am.nivel is not null
           then case when ap.ordem <= am.ordem then j.por_payt else j.por_meta end
         else null
       end as sugestao,
       case
         when j.por_payt is null and j.por_meta is null
           then 'acima do empate e abaixo da régua: dá lucro, mas não alcança nenhum nível'
         when j.por_payt is null or j.por_meta is null
           then 'uma das fontes fica entre o empate e a régua — as fontes discordam do veredito'
         when j.por_payt = j.por_meta
           then 'as duas fontes chegam ao mesmo veredito'
         when ap.nivel is not null and am.nivel is not null
           then format('as duas aprovam (Payt: %s, Meta: %s) — gravado o menor', j.por_payt, j.por_meta)
         else format('as fontes discordam: Payt diz %s, Meta diz %s', j.por_payt, j.por_meta)
       end as motivo,
       /* As duas colunas novas vão no FIM, e não ao lado de `investimento`
          onde pertenceriam por assunto: `create or replace view` não insere
          coluna no meio da lista — ele recusa a instrução inteira. Trocar a
          ordem exigiria `drop view`, que derrubaria `avaliacao_sugerida` e as
          telas junto. */
       round(j.chances, 2) as chances,
       j.teve_chance
  from julgado j
  left join aprovados ap on ap.nivel = j.por_payt
  left join aprovados am on am.nivel = j.por_meta;

comment on view public.vw_criativo_avaliacao_sugerida is
  'O que a régua vigente pensa de cada card postado do tipo criativo. Reprovar '
  'exige as TRÊS coisas: verba que comprou chances suficientes (investimento / '
  '(AOV do projeto / empate) >= menor vendas_min da régua), volume e ROAS. '
  'Card que não teve chance é "sem verba", não reprovado. Card acima do empate '
  'que não alcança nenhum nível devolve NULO: a régua não decide e manda para a '
  'fila. Opina sobre todos, inclusive fora do escopo — é daí que sai o aviso '
  '"a régua discorda". Nenhum número nem nome de nível está escrito aqui.';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_def   text;
  v_n     integer;
  v_r     record;
begin
  v_def := pg_get_viewdef('public.vw_criativo_avaliacao_sugerida'::regclass, true);

  -- 1. Continua sem número e sem nome de nível escrito.
  for v_r in select unnest(array['Validado','Escalado','Não validado','Sem dados']) as nivel loop
    if v_def like '%''' || v_r.nivel || '''%' then
      v_erros := v_erros || format('a view cita o nivel %L. ', v_r.nivel);
    end if;
  end loop;
  if v_def ~ 'vendas[a-z_]*\s*>=\s*\d' then
    v_erros := v_erros || 'apareceu limiar de vendas escrito na view. ';
  end if;

  -- 2. O piso de chances e DERIVADO do menor corte da regua, nao digitado.
  if v_def not like '%min(%vendas_min)%' then
    v_erros := v_erros || 'o piso de chances deixou de derivar do menor vendas_min. ';
  end if;

  -- 3. As tres dimensoes aparecem na decisao de reprovar.
  if v_def not like '%chances%' then
    v_erros := v_erros || 'a view nao calcula chances (dimensao investimento). ';
  end if;
  if v_def not like '%empate%' then
    v_erros := v_erros || 'a view nao compara com o empate (dimensao ROAS). ';
  end if;

  -- 4. OS DOIS CARDS QUE ORIGINARAM ISTO. E a prova que importa: a regra nova
  --    tem de concordar com o julgamento humano nos dois, e eles sao casos
  --    OPOSTOS (um acima do empate, outro abaixo).
  for v_r in
    select s.producao_id, p.nome, s.sugestao, s.chances, s.roas
      from public.vw_criativo_avaliacao_sugerida s
      join public.producoes p on p.id = s.producao_id
     where p.nome in ('AD 092 H04 V01', 'AD 083 H06 V02')
       and s.investimento > 0
  loop
    if v_r.sugestao is distinct from 'Sem dados' then
      v_erros := v_erros || format(
        '%s deveria ser "Sem dados" (comprou %s chances, ROAS %s) e a regua diz %L. ',
        v_r.nome, v_r.chances, v_r.roas, v_r.sugestao);
    end if;
  end loop;

  -- 5. Nenhum card reprovado esta acima do empate. E a regra dela, literal:
  --    "se zero vendas ou abaixo de 1,6 cortamos".
  select count(*) into v_n
    from public.vw_criativo_avaliacao_sugerida s, public.vw_crivo_vigente c
   where s.sugestao = c.nivel_reprovado and s.roas >= c.empate;
  if v_n > 0 then
    v_erros := v_erros || format('%s card(s) reprovados estando acima do empate. ', v_n);
  end if;

  -- 6. Nenhum card reprovado sem ter tido chance.
  select count(*) into v_n
    from public.vw_criativo_avaliacao_sugerida s, public.vw_crivo_vigente c
   where s.sugestao = c.nivel_reprovado and not s.teve_chance;
  if v_n > 0 then
    v_erros := v_erros || format('%s card(s) reprovados sem terem tido chance. ', v_n);
  end if;

  -- 7. A soma fecha com o universo.
  select count(*) into v_n from public.producoes where fase='postado' and tipo='criativo';
  if (select count(*) from public.vw_criativo_avaliacao_sugerida) <> v_n then
    v_erros := v_erros || 'a view deixou de cobrir todo criativo postado. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.vw_criativo_avaliacao_sugerida s, public.vw_crivo_vigente c
   where s.sugestao = c.nivel_reprovado;
  raise notice 'PROVA OK: reprovar agora exige verba, volume e ROAS juntos. % reprovados (eram 314), nenhum acima do empate e nenhum sem ter tido chance. Os dois cards de 06/10 viram "Sem dados", como ela marcou.', v_n;
end $prova$;

notify pgrst, 'reload schema';
