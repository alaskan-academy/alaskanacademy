-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O centro "Softwares" solto volta para o catálogo                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Dois nomes para a mesma coisa conviviam como centros de custo distintos.
-- Apareceu ao conferir o CLAUDE.md do Financeiro em 12/10/2026, e medido:
--
--   Softwares ................. 1 lançamento   -131,22   08/09/2026
--   Softwares e Ferramentas . 348 lançamentos  -37.477,71   desde 01/12/2025
--
-- Não é empate: é uma linha digitada torto contra 348. E o catálogo decide o
-- resto — `categorias_centro` conhece **só** `Softwares e Ferramentas`, com 11
-- categorias dentro. `Softwares` não existe lá.
--
-- A categoria da linha solta é `Mídia`, que o catálogo coloca exatamente sob
-- `Softwares e Ferramentas`. Ou seja: a linha já sabia para onde ir.
--
-- ── Por que isso importa e não é cosmética ──────────────────────────────
--
-- Primeira armadilha do CLAUDE.md da raiz: dois campos dizendo a mesma coisa
-- divergem. Aqui o preço é um relatório por centro de custo que mostra
-- "Softwares" com R$ 131 ao lado de "Softwares e Ferramentas" com R$ 37 mil,
-- como se fossem áreas diferentes da operação — e um filtro por centro que
-- esquece R$ 131 dependendo de qual nome a pessoa escolher.
--
-- ── O que esta migração NÃO faz ─────────────────────────────────────────
--
-- Não mexe na categoria, no valor, na data nem na empresa. Só no centro de
-- custo, e só da linha que está fora do catálogo. E não cria restrição nova
-- ligando `transacoes.centro_custo` a `categorias_centro`: isso resolveria o
-- problema de vez, mas é mudança de estrutura com risco próprio, e merece ser
-- decidida à parte em vez de pegar carona num conserto de uma linha.

begin;

-- Retrato de antes: a prova precisa poder dizer que SÓ o centro mudou.
drop table if exists _antes_centro;
create temp table _antes_centro as
select id, to_jsonb(t) - 'centro_custo' as resto
  from public.transacoes t
 where t.centro_custo = 'Softwares';

update public.transacoes
   set centro_custo = 'Softwares e Ferramentas'
 where centro_custo = 'Softwares';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_num   numeric;
begin
  -- 1. Era UMA linha. Se o retrato vier vazio ou com muitas, a premissa da
  --    migração mudou e ela não pode passar calada.
  select count(*) into v_n from _antes_centro;
  if v_n <> 1 then
    v_erros := v_erros || format('o retrato tem %s linha(s), esperava 1. ', v_n);
  end if;

  -- 2. Ninguém mais usa o nome solto.
  select count(*) into v_n from public.transacoes where centro_custo = 'Softwares';
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) seguem em "Softwares". ', v_n);
  end if;

  -- 3. E NADA além do centro mudou na linha tocada — categoria, valor, data,
  --    empresa ficam como estavam.
  select count(*) into v_n
    from _antes_centro a join public.transacoes t on t.id = a.id
   where (to_jsonb(t) - 'centro_custo') is distinct from a.resto;
  if v_n > 0 then
    v_erros := v_erros || 'outra coluna da linha mudou alem do centro de custo. ';
  end if;

  -- 4. O destino recebeu exatamente aquela linha: 348 -> 349, e a soma andou
  --    os -131,22 e nem um centavo a mais.
  select count(*), round(sum(valor), 2) into v_n, v_num
    from public.transacoes where centro_custo = 'Softwares e Ferramentas';
  if v_n <> 349 then
    v_erros := v_erros || format('o destino ficou com %s linhas, esperava 349. ', v_n);
  end if;
  if v_num is distinct from -37608.93 then
    v_erros := v_erros || format('o destino somou %s, esperava -37608.93. ', v_num);
  end if;

  -- 5. O caixa da casa não se mexeu: recategorizar move de prateleira.
  select count(*), round(sum(valor), 2) into v_n, v_num from public.transacoes;
  if v_n <> 1935 then
    v_erros := v_erros || format('transacoes tem %s linhas, tinha 1935. ', v_n);
  end if;
  if v_num is distinct from 29022.43 then
    v_erros := v_erros || format('a soma geral virou %s, era 29022.43. ', v_num);
  end if;

  -- 6. Sobra UM centro órfão, e de propósito: `Funcionários`.
  --
  --    A primeira versão desta prova exigia que NENHUM centro em uso ficasse
  --    fora do catálogo, e ela reprovou a migração — que é exatamente o que
  --    uma prova deve fazer quando a pessoa que a escreveu não olhou direito.
  --    O que ela achou vale mais que o conserto: `Funcionários` carrega 39
  --    lançamentos e -R$ 71.902,06 de pagamento de editor, e o catálogo chama
  --    esse centro de `Departamento Pessoal`.
  --
  --    Não converto junto. `Softwares` é erro de digitação de um nome que
  --    existe; `Funcionários` é um nome inteiro que alguém usou 39 vezes de
  --    propósito, e decidir entre renomear as 39 linhas ou acrescentar o nome
  --    ao catálogo é dela, não minha.
  --
  --    A prova fica cobrando os DOIS de forma nominal: assim ela não some
  --    quando o Funcionários for resolvido, e volta a gritar se um terceiro
  --    nome órfão aparecer.
  select count(*) into v_n from (
    select distinct t.centro_custo
      from public.transacoes t
     where t.centro_custo is not null
       and t.centro_custo <> 'Funcionários'
       and not exists (select 1 from public.categorias_centro c
                        where c.centro_custo = t.centro_custo)) x;
  if v_n > 0 then
    v_erros := v_erros || format('%s centro(s) de custo em uso, alem de Funcionarios, nao existem no catalogo. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: a unica linha em "Softwares" voltou para "Softwares e Ferramentas" (349 linhas, -37.608,93), nada mais mudou nela, o caixa nao se mexeu, e todo centro de custo em uso existe no catalogo.';
end $prova$;

drop table if exists _antes_centro;
