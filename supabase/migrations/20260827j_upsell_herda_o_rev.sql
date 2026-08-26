-- O upsell passa a pertencer ao REV da venda que o gerou.
--
-- Até agora: 400 upsells aprovados, ZERO com funil_id. E não era descuido de
-- cadastro — o webhook do Payt não manda `link.url` no upsell, e
-- `fn_funil_da_venda` casa exatamente por URL. Cadastrar o checkout do upsell
-- na tela de Funis não resolveria nada: não há URL na venda para casar com ele.
--
-- O que existe é o `cart_id`, o mesmo carrinho da compra original. O Payt
-- começou a mandá-lo em agosto/2026 e desde então está em 60 de 60 upsells.
-- Então o upsell não se resolve sozinho: ele HERDA o REV da venda-mãe.
--
-- Dois gatilhos, e não um, porque a ordem de chegada não é garantida:
--   * o upsell pode chegar depois da mãe — resolve na hora (BEFORE);
--   * a mãe pode ganhar o funil_id depois, quando o checkout dela for
--     vinculado — aí o upsell precisa ser avisado (AFTER).
-- Um gatilho só deixaria metade dos casos para trás em silêncio, que é
-- exatamente a armadilha do retrato único sem gatilho já registrada no
-- CLAUDE.md.
--
-- Antes de agosto não há cart_id nenhum: aqueles 340 upsells ficam sem REV
-- para sempre, e não há o que inventar. O backfill amarrou 73.

create or replace function public.fn_funil_do_upsell(p_cart_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.funil_id
  from public.vendas v
  where v.cart_id = p_cart_id
    and not coalesce(v.is_upsell, false)
    and v.funil_id is not null
  order by v.data_venda
  limit 1;
$$;

comment on function public.fn_funil_do_upsell(text) is
  'O REV da venda-mãe do upsell, achado pelo carrinho. O upsell não tem URL de '
  'checkout no webhook -- o carrinho é o único elo que existe.';

-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_venda_resolve_funil()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_url text;
  v_adotou boolean := false;
begin
  -- Upsell primeiro: ele nunca tem link_url, e sairia pelo return abaixo sem
  -- nunca ganhar um REV.
  if coalesce(new.is_upsell, false) then
    if new.funil_id is null and new.cart_id is not null then
      new.funil_id := public.fn_funil_do_upsell(new.cart_id);
    end if;
    return new;
  end if;

  if new.link_url is null then
    return new;
  end if;

  v_url := split_part(new.link_url, '?', 1);

  if not exists (
    select 1 from public.funil_checkouts
    where url = v_url and titulo is not distinct from new.link_titulo
  ) then
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A mãe ganhou REV depois do upsell ter chegado: avisa o filho.
create or replace function public.fn_propagar_funil_ao_upsell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só a venda-mãe propaga, e só quando ela de fato passou a ter um REV. Sem
  -- estas duas guardas o gatilho se chamaria de volta em cadeia.
  if coalesce(new.is_upsell, false) or new.funil_id is null or new.cart_id is null then
    return null;
  end if;

  update public.vendas u
     set funil_id = new.funil_id
   where u.cart_id = new.cart_id
     and coalesce(u.is_upsell, false)
     and u.funil_id is distinct from new.funil_id
     and u.funil_id is null;

  return null;
end;
$$;

drop trigger if exists trg_propagar_funil_ao_upsell on public.vendas;
create trigger trg_propagar_funil_ao_upsell
after insert or update of funil_id on public.vendas
for each row execute function public.fn_propagar_funil_ao_upsell();

-- ─────────────────────────────────────────────────────────────────────────────
-- Carga inicial. Preenche o passado; quem mantém o presente são os gatilhos.
create or replace function public.fn_backfill_funil_dos_upsells()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.vendas u
     set funil_id = m.funil_id
    from public.vendas m
   where coalesce(u.is_upsell, false)
     and u.cart_id is not null
     and m.cart_id = u.cart_id
     and not coalesce(m.is_upsell, false)
     and m.funil_id is not null
     and u.funil_id is distinct from m.funil_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

create index if not exists idx_vendas_cart_upsell
  on public.vendas (cart_id) where cart_id is not null;

revoke execute on function public.fn_funil_do_upsell(text) from public, anon;
revoke execute on function public.fn_backfill_funil_dos_upsells() from public, anon;
grant execute on function public.fn_backfill_funil_dos_upsells() to authenticated, service_role;

select public.fn_backfill_funil_dos_upsells();

-- ─────────────────────────────────────────────────────────────────────────────
-- O "Fim da Lead" da planilha precisa de um segundo que o VTurb não tem.
--
-- Play Rate, 1 minuto, Pitch e Final da VSL saem todos da API: o pitch o próprio
-- VTurb marca (`pitch_time`), o resto sai da curva de retenção. O fim da lead
-- não — é uma marca editorial do roteiro, só quem escreveu a VSL sabe onde a
-- abertura termina e a promessa começa.
--
-- Por isso é um campo por VSL, e não por análise: o roteiro não muda a cada
-- quinzena. Preenchido uma vez, a rodada lê sozinha para sempre. Enquanto
-- estiver vazio a tela mostra tracinho e diz onde preencher, em vez de fingir
-- um número.

alter table public.vsls add column if not exists lead_fim_seg integer;

comment on column public.vsls.lead_fim_seg is
  'Segundo em que a lead (abertura) termina. Marca editorial do roteiro: o '
  'VTurb não sabe disso, só quem escreveu a VSL.';
