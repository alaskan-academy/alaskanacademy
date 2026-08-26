-- Dá para cadastrar o checkout ANTES da primeira venda, colando a URL.
--
-- Até aqui um checkout só existia depois de vender: a fila nasce das vendas. Ao
-- lançar um REV novo, ele ficava sem checkout no cadastro até a primeira compra
-- entrar — e nesse intervalo a atribuição das primeiras vendas dependia de
-- alguém lembrar de voltar lá.
--
-- O obstáculo era o casamento. Ele exige URL **e** título iguais, e o título só
-- existe no webhook:
--
--     cadastrado:  (payt.site/ABC, sem título)
--     venda chega: (payt.site/ABC, "Workshop Rev3")   → não bate
--
-- POR QUE NÃO CASAR SÓ POR URL: porque os dados mostram que uma URL serve REVs
-- diferentes ao longo do tempo. `payt.site/qZCw56M` foi "Rev1" (21/05–21/06),
-- depois "Revisão", depois "Rev5". Casar por URL faria uma linha engolir os três.
--
-- A regra segura: a URL vale como chave SÓ ENQUANTO a linha não tem título. A
-- primeira venda adota o pré-cadastro e preenche o título; dali em diante o
-- casamento volta a ser exato, e uma troca de REV na mesma URL cria uma linha
-- nova como sempre criou.

create or replace function public.fn_venda_resolve_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_adotou boolean := false;
begin
  if new.link_url is null then
    return new;
  end if;

  v_url := split_part(new.link_url, '?', 1);

  if not exists (
    select 1 from public.funil_checkouts
    where url = v_url and titulo is not distinct from new.link_titulo
  ) then
    -- Adota um pré-cadastro, se houver: preenche o título e preserva o REV que
    -- ela já tinha escolhido. Só pode existir um, porque a constraint trata
    -- nulos como iguais.
    update public.funil_checkouts
       set titulo = new.link_titulo
     where url = v_url and titulo is null;

    get diagnostics v_adotou = row_count;

    if not v_adotou then
      insert into public.funil_checkouts (url, titulo)
      values (v_url, new.link_titulo)
      on conflict on constraint uq_funil_checkouts do nothing;
    end if;
  end if;

  if new.funil_id is null then
    new.funil_id := public.fn_funil_da_venda(new.link_url, new.link_titulo);
  end if;

  return new;
end;
$$;

comment on function public.fn_venda_resolve_funil() is
  'Registra o checkout da venda e resolve o REV. Se houver pré-cadastro da mesma '
  'URL sem título, adota-o em vez de criar linha nova — é o que permite cadastrar '
  'o checkout antes da primeira venda sem perder o REV já escolhido.';
