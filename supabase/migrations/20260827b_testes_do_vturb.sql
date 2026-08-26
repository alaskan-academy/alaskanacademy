-- Os testes A/B do VTurb entram em `testes_funis`.
--
-- Eram descoberta e não integração: eu tinha provado que a API traz os dois
-- lados com números, e parado aí.
--
-- O que isso resolve: 10 dos 13 testes concluídos estão sem vencedor. Não é
-- desleixo — é que preencher o resultado exigia abrir o VTurb, achar o teste,
-- copiar os números e voltar. Com os números aparecendo sozinhos, julgar vira
-- uma decisão de dois segundos.
--
-- CORREÇÃO ao que eu disse antes: afirmei que "o VTurb sabe quem ganhou". Não
-- sabe. Ele sabe os NÚMEROS; veredito ninguém deu — os 4 testes de lá estão
-- todos com `finished_at` nulo. Por isso o vencedor continua sendo escolha
-- dela, e o que a sincronização traz é o trabalho braçal.

alter table public.testes_funis
  add column if not exists vturb_comparison_id text,
  add column if not exists metricas_vturb jsonb;

-- Chave do lado de lá: sincronizar duas vezes atualiza em vez de duplicar.
create unique index if not exists uq_testes_vturb
  on public.testes_funis (vturb_comparison_id)
  where vturb_comparison_id is not null;

comment on column public.testes_funis.vturb_comparison_id is
  'Id do comparison group no VTurb. Presente só nos testes que vieram de lá.';

comment on column public.testes_funis.metricas_vturb is
  'Retrato dos números dos dois lados no momento da sincronização: views, '
  'plays, conversões e faturamento por player. Guardado como retrato, e não '
  'recalculado ao abrir, pelo mesmo motivo das análises — a leitura escrita '
  'precisa continuar fazendo sentido ao lado dos números que a motivaram.';

-- O CHECK exigia funil para todo teste que não fosse de anúncio.
--
-- Um teste vindo do VTurb sabe qual VSL está comparando, mas só saberá o REV
-- quando alguém tiver ligado aquela VSL a um REV. Exigir o funil na entrada
-- obrigaria a inventá-lo ou a descartar o teste — e descartar é pior, porque o
-- teste existe e está rodando de verdade.
--
-- Mesmo padrão de `funil_checkouts`: entra sem vínculo, ganha o vínculo depois.
alter table public.testes_funis
  drop constraint if exists testes_funis_funil_required_non_ad;

alter table public.testes_funis
  add constraint testes_funis_funil_required_non_ad
  check (tipo = 'ad' or funil_id is not null or vturb_comparison_id is not null);

-- ────────────────────────────────────────────────────────────────────────────
-- Resolver o REV de um teste do VTurb pela VSL que ele compara.
--
-- Caminho: player do VTurb → `vsls.id` → `funis.vsl_id`. Enquanto nenhum REV
-- tiver VSL escolhida, isto não resolve nada — e é assim mesmo. É a mesma
-- espera dos checkouts: o vínculo aparece quando alguém o declara.

create or replace function public.fn_backfill_funil_dos_testes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.testes_funis t
     set funil_id  = f.id,
         funil_ids = array[f.id::text]
    from public.funis f
   where t.vturb_comparison_id is not null
     and t.funil_id is null
     and f.vsl_id is not null
     -- `metricas_vturb` guarda os player_ids dos dois lados. Basta um deles
     -- rodar num REV para o teste pertencer àquele REV.
     and f.vsl_id in (
       select jsonb_array_elements(t.metricas_vturb->'lados')->>'player_id'
     );
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.fn_backfill_funil_dos_testes() is
  'Liga testes vindos do VTurb ao REV, pela VSL que eles comparam. Não resolve '
  'nada enquanto nenhum REV tiver VSL escolhida — estado normal, não erro.';

revoke execute on function public.fn_backfill_funil_dos_testes() from public, anon;
grant execute on function public.fn_backfill_funil_dos_testes() to authenticated, service_role;
