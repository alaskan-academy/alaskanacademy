-- Um centro com categorias dentro nao some por engano.
--
-- Apagar "Funcionarios" deixaria "Departamento Pessoal", "Edicao de Video" e
-- "Freelancer" orfas -- elas cairiam em "(sem centro)" na matriz de custos e
-- R$ 47 mil mudariam de lugar no relatorio sem ninguem pedir.
create or replace function public.fn_centro_em_uso(p_centro text)
returns int
language sql stable as $fn$
  select count(*)::int
    from public.categorias_centro
   where centro_custo = p_centro and ativo;
$fn$;

comment on function public.fn_centro_em_uso(text) is
  'Quantas categorias moram neste centro. Zero = pode apagar.';

grant execute on function public.fn_centro_em_uso(text) to authenticated;

-- Renomear um centro tem de arrastar as categorias dele: elas guardam o nome,
-- nao um id. Sem isto, renomear deixaria todas apontando para um centro que nao
-- existe mais.
create or replace function public.fn_renomear_centro(p_antigo text, p_novo text)
returns int
language plpgsql as $fn$
declare
  n int;
begin
  insert into public.centros_custo (nome, ordem)
  select p_novo, ordem from public.centros_custo where nome = p_antigo
  on conflict (nome) do nothing;

  update public.categorias_centro
     set centro_custo = p_novo
   where centro_custo = p_antigo;
  get diagnostics n = row_count;

  -- O centro tambem vive em `transacoes`, preenchido pelo sync da Conta Simples.
  -- Fica como esta de proposito: ali e registro do que o CS mandou, e o proximo
  -- sync sobrescreveria de volta. A hierarquia do relatorio vem de
  -- `categorias_centro`, que e o que acabou de ser renomeado.
  delete from public.centros_custo where nome = p_antigo;
  return n;
end;
$fn$;

comment on function public.fn_renomear_centro(text, text) is
  'Renomeia o centro arrastando as categorias. Nao toca em transacoes.centro_custo, que e registro do CS.';

grant execute on function public.fn_renomear_centro(text, text) to authenticated;
