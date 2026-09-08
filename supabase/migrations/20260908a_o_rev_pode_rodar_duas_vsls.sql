-- O REV PODE RODAR DUAS VSLs
--
-- Num teste A/B o VTurb alterna dois players na MESMA pagina. Enquanto o teste
-- corre, "qual VSL roda neste REV" tem duas respostas — e `funis.vsl_id`, no
-- singular, so guardava uma. O efeito pratico: metade do teste ficava invisivel
-- em Analises, que e justamente onde se decide qual das duas fica.
--
-- POR QUE TABELA DE LIGACAO, E NAO UM ARRAY
--
-- `vsl_id` tinha `REFERENCES vsls(id)`, e array nao aceita chave estrangeira.
-- Trocar por `text[]` ganharia N e perderia a garantia de que o id existe — o
-- painel passaria a poder apontar para uma VSL que sumiu, sem nada reclamando.
--
-- Alem disso o projeto ja tem o padrao: `funil_subofertas` e `funil_checkouts`
-- resolvem o mesmo "um REV, varios X" com tabela propria. Seguir o que ja
-- existe custa menos que inventar a terceira forma de dizer a mesma coisa.
--
-- E NAO FICAM OS DOIS CAMPOS
--
-- `funis.vsl_id` SAI. Manter o singular ao lado da lista seria a armadilha 1 do
-- CLAUDE.md pela sexta vez — a mesma que ja escondeu 4 REVs com `ativo` x
-- `status`, e que `testes_funis` ainda carrega com `funil_id` x `funil_ids`.
-- Quem precisa de "a VSL principal" le a de menor `ordem`, derivada, nunca um
-- segundo campo editavel.
--
-- Consumidores atualizados junto: `vw_mapa_revs` (que expunha `vsl_id`, `vsl` e
-- `vsl_duracao`) e `fn_backfill_funil_dos_testes` (que ligava teste a REV pelo
-- singular e agora casa com QUALQUER uma das VSLs do REV — o que era o defeito
-- de origem: um teste de duas VSLs so podia se ligar por uma delas).

create table if not exists funil_vsls (
  funil_id uuid    not null references funis(id) on delete cascade,
  vsl_id   text    not null references vsls(id)  on delete cascade,
  -- A ordem decide quem e "A" e quem e "B" na comparacao de Analises. Sem ela
  -- os dois lados trocariam de lugar entre uma leitura e outra, e a diferenca
  -- em pontos percentuais mudaria de sinal sozinha.
  ordem    smallint not null default 1,
  criado_em timestamptz not null default now(),
  primary key (funil_id, vsl_id)
);

create index if not exists idx_funil_vsls_funil on funil_vsls (funil_id);

alter table funil_vsls enable row level security;

drop policy if exists funil_vsls_tudo on funil_vsls;
create policy funil_vsls_tudo on funil_vsls
  for all to authenticated using (true) with check (true);

-- Carga inicial: o que o singular ja apontava. O gatilho nao existe porque nao
-- ha o que espelhar — daqui em diante quem escreve e a tela, direto na tabela.
insert into funil_vsls (funil_id, vsl_id, ordem)
select f.id, f.vsl_id, 1
  from funis f
 where f.vsl_id is not null
on conflict (funil_id, vsl_id) do nothing;

-- A view depende da coluna, entao sai e volta.
drop view if exists vw_mapa_revs;

alter table funis drop column if exists vsl_id;

create view vw_mapa_revs as
 SELECT f.id,
    f.nome AS rev,
    f.status,
    f.metodo,
    f.url_page,
    p.id AS projeto_id,
    p.nome AS projeto,
    v.vsl_id,
    v.vsl,
    v.vsl_duracao,
    d.dominios,
    c.checkouts,
    COALESCE(vd.vendas, 0::bigint) AS vendas,
    vd.ultima_venda,
    unaccent(lower(concat_ws(' '::text, f.nome, p.nome, v.vsl, f.url_page, f.metodo, array_to_string(d.dominios, ' '::text), array_to_string(c.checkouts, ' '::text)))) AS busca,
    c.preco,
    c.checkout_url,
    -- Novas, no fim: a lista inteira e quantas sao. `vsl_id` acima continua
    -- existindo e e a PRIMEIRA — derivada daqui, nao um campo a parte.
    COALESCE(v.vsl_ids, '{}'::text[]) AS vsl_ids,
    COALESCE(v.vsl_qtd, 0) AS vsl_qtd
   FROM funis f
     LEFT JOIN ofertas_editores p ON p.id = f.projeto_id
     LEFT JOIN LATERAL ( SELECT (array_agg(s.id ORDER BY s.ordem, s.nome))[1]          AS vsl_id,
            string_agg(s.nome, ' · ' ORDER BY s.ordem, s.nome)                          AS vsl,
            (array_agg(s.duracao_seg ORDER BY s.ordem, s.nome))[1]                      AS vsl_duracao,
            array_agg(s.id ORDER BY s.ordem, s.nome)                                    AS vsl_ids,
            count(*)::int                                                               AS vsl_qtd
           FROM ( SELECT vs.id, vs.nome, vs.duracao_seg, fv.ordem
                    FROM funil_vsls fv
                    JOIN vsls vs ON vs.id = fv.vsl_id
                   WHERE fv.funil_id = f.id) s) v ON true
     LEFT JOIN LATERAL ( SELECT array_agg(dm.nome ORDER BY dm.nome) AS dominios
           FROM dominios dm
          WHERE f.id::text = ANY (COALESCE(NULLIF(dm.funil_ids, '{}'::text[]), ARRAY[dm.funil_id::text]))) d ON true
     LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT x.titulo) FILTER (WHERE x.titulo IS NOT NULL) AS checkouts,
            (array_agg(COALESCE(x.preco_praticado, x.preco) ORDER BY x.vendas DESC NULLS LAST))[1] AS preco,
            (array_agg(x.url ORDER BY x.vendas DESC NULLS LAST))[1] AS checkout_url
           FROM vw_checkouts_a_confirmar x
          WHERE x.funil_id = f.id) c ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS vendas,
            max(ve.data_venda)::date AS ultima_venda
           FROM vendas ve
          WHERE ve.funil_id = f.id AND ve.status = 'aprovada'::status_venda) vd ON true;

comment on view vw_mapa_revs is
  'Um REV por linha. `vsl` traz os nomes das VSLs juntos por " · " e `vsl_id` e '
  'a PRIMEIRA (por ordem) — as duas derivam de `funil_vsls`, que e a fonte. '
  '`vsl_ids` e a lista inteira e `vsl_qtd` diz quantas: num teste A/B sao duas.';

-- Liga teste do VTurb ao REV por QUALQUER uma das VSLs dele.
--
-- Era este o defeito de origem. Um teste tem dois players; o REV tinha um
-- `vsl_id`. Se a pessoa escolhesse o lado B, o teste nao se ligava — e a tela
-- dizia "0 ligados a um REV" sem explicar que a culpa era do singular.
create or replace function public.fn_backfill_funil_dos_testes()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n integer;
begin
  update public.testes_funis t
     set funil_id  = fv.funil_id,
         funil_ids = array[fv.funil_id::text]
    from public.funil_vsls fv
   where t.vturb_comparison_id is not null
     and t.funil_id is null
     and fv.vsl_id in (
       select jsonb_array_elements(t.metricas_vturb->'lados')->>'player_id'
     );
  get diagnostics n = row_count;
  return n;
end;
$function$;
