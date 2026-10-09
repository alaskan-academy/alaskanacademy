-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A régua decide, e quem discorda espera                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Aqui a régua de `crivo_versoes` passa a produzir um veredito por card. Três
-- objetos, com responsabilidades separadas de propósito:
--
--   vw_criativo_avaliacao_sugerida   o que a régua PENSA de cada card postado
--   avaliacao_sugerida               o último veredito, materializado
--   fn_avaliar_criativos()           o que ela tem PERMISSÃO de escrever
--
-- A separação entre "pensa" e "pode escrever" é o que faz o aviso funcionar: a
-- view opina sobre TODO card postado, inclusive os 393 julgados por gente e os
-- 3.467 fora do escopo, e a função só grava nos que estão no escopo. É assim que
-- a tela consegue dizer "você validou isto, e a régua discorda" sem a régua
-- mexer em nada.
--
-- ── A ESCADA É LIDA DA TABELA, não escrita aqui ──────────────────────────
--
-- Nenhum número da régua aparece neste arquivo. Nem 15, nem 1,8, nem 1,65, nem
-- 2, nem 80 — e nem os nomes 'Validado' / 'Escalado' / 'Sem dados' / 'Não
-- validado'. Tudo sai de `vw_crivo_vigente` e `vw_crivo_niveis_vigentes`.
--
-- Isso é a terceira armadilha levada a sério: o DRE escondeu R$ 10.065 porque as
-- categorias estavam listadas à mão e uma nova não entrou. Uma régua escrita
-- aqui dentro envelheceria do mesmo jeito, e o dia em que alguém mudasse o nível
-- na tabela o código continuaria decidindo pelo número velho — em silêncio, que
-- é como isto sempre aparece.
--
-- O nível escolhido é "o de maior `ordem` cuja QUALQUER cláusula passa", e as
-- cláusulas são avaliadas em OU. É o que faz caber "margem boa com poucas vendas
-- OU margem pequena com volume maior" sem `if` no código.
--
-- ── Payt decide; Meta é a guarda ─────────────────────────────────────────
--
-- A escada roda duas vezes, nas colunas de cada fonte, e:
--
--   vereditos iguais ................... grava
--   as duas APROVAM em níveis diferentes grava o MENOR
--   qualquer outra divergência ......... NÃO grava, e diz por quê
--
-- O segundo caso existe porque "uma diz Validado e a outra diz Escalado" não é
-- discordância sobre o que importa: as duas dizem que o card é bom. Não gravar
-- nada ali seria jogar na fila um card sobre o qual as fontes concordam, e o
-- lado conservador (o nível menor) é o que não autoriza verba por engano. São 4
-- cards na amostra histórica, e é o que leva o Validado de 7 para 11.
--
-- E a razão de a Payt decidir e o Meta vetar está medida: a Payt SUBESTIMA (só
-- 58-76% das vendas aprovadas carregam `ad_id_meta`) e o Meta INFLA (janela de 7
-- dias credita venda de backend ao anúncio de topo). A razão entre as duas é
-- 1,49x a 1,76x. Os mesmos 60 cards dão −R$ 67.441 de lucro pela Payt e
-- +R$ 126.762 pelo Meta — e nenhuma medição resolveu qual está certa. Enquanto
-- não resolver, o card em que elas discordam vale mais na mão dela que carimbado.
--
-- ── A automação NÃO escreve em criativo_historico ────────────────────────
--
-- Aquela tabela é a única prova de toque humano: foi o que permitiu separar os
-- 393 julgamentos reais dos ~2.340 vindos da carga, em `20261009b`. Enchê-la de
-- linhas de máquina destruiria a prova, e ela também alimenta
-- `fn_desempenho_editores` e a tela "o que eu aprovei". Por isso existe
-- `avaliacao_automatica_log`, que é só da máquina.
--
-- ── Quantos cards isto move HOJE: zero ───────────────────────────────────
--
-- Com o escopo em "só os novos" (`20261009b`), todo card já postado levou selo.
-- Logo não há nenhum card postado dentro do escopo agora, e a prova no fim cobra
-- exatamente isso: a função roda, devolve 0, e nada muda. A régua começa a
-- produzir quando o primeiro dos 326 cards em produção for postado.

begin;

-- ---------------------------------------------------------------------------
-- 1. O veredito materializado
-- ---------------------------------------------------------------------------
create table if not exists public.avaliacao_sugerida (
  producao_id      uuid primary key references public.producoes(id) on delete cascade,
  -- NULO = a régua se recusa a decidir. O motivo diz por quê.
  sugestao         text,
  motivo           text not null,
  crivo_versao_id  uuid not null references public.crivo_versoes(id),
  no_escopo        boolean not null,
  decidido_em      timestamptz not null default now()
);

comment on table public.avaliacao_sugerida is
  'O último veredito da régua por card postado. `sugestao` NULA significa que a '
  'régua se recusou a decidir (as fontes discordam) — o motivo diz qual é a '
  'divergência. Existe para TODO card postado, inclusive fora do escopo: é daqui '
  'que sai o aviso "você validou isto e a régua discorda". Quem pode GRAVAR em '
  'producoes.avaliacao é só fn_avaliar_criativos, e só onde no_escopo.';

-- `sugestao` não leva FK para criativo_campos_opcoes de propósito: o valor vem
-- sempre de `crivo_niveis.nivel` / `nivel_sem_verba` / `nivel_reprovado`, que já
-- têm FK para o vocabulário. Uma segunda FK exigiria repetir a coluna `campo`
-- aqui — dois campos dizendo a mesma coisa, que é a primeira armadilha.

create table if not exists public.avaliacao_automatica_log (
  id           bigserial primary key,
  producao_id  uuid not null references public.producoes(id) on delete cascade,
  de           text,
  para         text,
  motivo       text,
  versao_id    uuid references public.crivo_versoes(id),
  em           timestamptz not null default now()
);

create index if not exists idx_aval_auto_log_card on public.avaliacao_automatica_log (producao_id, em desc);
create index if not exists idx_aval_auto_log_em   on public.avaliacao_automatica_log (em desc);

comment on table public.avaliacao_automatica_log is
  'Append-only, só a máquina escreve. É o desfazer de fn_avaliar_criativos e o '
  'rastro que criativo_historico NÃO deve receber — aquela tabela é a prova de '
  'toque humano, e poluí-la apagaria a distinção que 20261009b estabeleceu.';

alter table public.avaliacao_sugerida         enable row level security;
alter table public.avaliacao_automatica_log   enable row level security;

drop policy if exists avaliacao_sugerida_rw on public.avaliacao_sugerida;
create policy avaliacao_sugerida_rw on public.avaliacao_sugerida
  for all to authenticated using (true) with check (true);

drop policy if exists avaliacao_automatica_log_rw on public.avaliacao_automatica_log;
create policy avaliacao_automatica_log_rw on public.avaliacao_automatica_log
  for all to authenticated using (true) with check (true);

commit;

-- ---------------------------------------------------------------------------
-- 2. A regra
-- ---------------------------------------------------------------------------
-- `tipo = 'criativo'` e `fase = 'postado'` estão escritos AQUI porque
-- `fn_criativos_metricas(p_ini, p_fim)` não filtra nenhum dos dois. Sem isso as
-- 68 VSLs e a 1 aula em 'postado' entrariam na régua e virariam "sem verba" —
-- reescrevendo o julgamento humano que a decisão de 21/09/2026 preservou. A
-- régua é de mídia: ROAS é receita sobre verba, e VSL não gasta verba.
create or replace view public.vw_criativo_avaliacao_sugerida
  with (security_invoker = on) as
with crivo as (
  select * from public.vw_crivo_vigente
),
met as (
  select * from public.fn_criativos_metricas(null, null)
),
base as (
  select p.id                             as producao_id,
         p.avaliacao,
         p.avaliacao_origem,
         -- NULO não é zero: card sem anúncio vinculado não tem linha na RPC.
         -- As duas situações caem no mesmo lado da régua (sem verba), mas o
         -- coalesce tem de ser explícito, senão a comparação devolve NULL e o
         -- card escapa da primeira cláusula para ser reprovado por engano.
         coalesce(m.investimento, 0)      as investimento,
         coalesce(m.vendas, 0)            as vendas,
         coalesce(m.roas, 0)              as roas,
         coalesce(m.vendas_meta, 0)       as vendas_meta,
         coalesce(m.roas_meta, 0)         as roas_meta
    from public.producoes p
    left join met m on m.producao_id = p.id
   where p.fase = 'postado'
     and p.tipo = 'criativo'
),
julgado as (
  select b.*,
         c.id                as crivo_versao_id,
         c.verba_min,
         -- A escada, pela PAYT: o nível de maior `ordem` cuja qualquer
         -- cláusula passa. Nenhum número e nenhum nome escritos aqui.
         case when b.investimento <= c.verba_min then c.nivel_sem_verba
              else coalesce(
                (select n.nivel
                   from public.vw_crivo_niveis_vigentes n
                  where b.vendas >= n.vendas_min
                    and case when n.roas_inclusivo
                             then b.roas >= n.roas_min
                             else b.roas >  n.roas_min end
                  order by n.ordem desc
                  limit 1),
                c.nivel_reprovado)
         end as por_payt,
         -- A mesma escada, pelo META. Idêntica de propósito: a guarda só vale
         -- se as duas fontes forem medidas com a mesma régua.
         case when b.investimento <= c.verba_min then c.nivel_sem_verba
              else coalesce(
                (select n.nivel
                   from public.vw_crivo_niveis_vigentes n
                  where b.vendas_meta >= n.vendas_min
                    and case when n.roas_inclusivo
                             then b.roas_meta >= n.roas_min
                             else b.roas_meta >  n.roas_min end
                  order by n.ordem desc
                  limit 1),
                c.nivel_reprovado)
         end as por_meta
    from base b
   cross join crivo c
),
-- Quais níveis são de APROVAÇÃO sai da tabela, não de uma lista: é o que
-- permite acrescentar um nível amanhã sem tocar nesta view.
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
       -- O escopo da régua, derivado do selo de 20261009b.
       (j.avaliacao_origem is null or j.avaliacao_origem = 'automatico') as no_escopo,
       case
         when j.por_payt = j.por_meta then j.por_payt
         when ap.nivel is not null and am.nivel is not null
           then case when ap.ordem <= am.ordem then j.por_payt else j.por_meta end
         else null
       end as sugestao,
       case
         when j.por_payt = j.por_meta
           then 'as duas fontes chegam ao mesmo veredito'
         when ap.nivel is not null and am.nivel is not null
           then format('as duas aprovam (Payt: %s, Meta: %s) — gravado o menor', j.por_payt, j.por_meta)
         else format('as fontes discordam: Payt diz %s, Meta diz %s', j.por_payt, j.por_meta)
       end as motivo
  from julgado j
  left join aprovados ap on ap.nivel = j.por_payt
  left join aprovados am on am.nivel = j.por_meta;

comment on view public.vw_criativo_avaliacao_sugerida is
  'O que a régua vigente pensa de cada card postado do tipo criativo. Opina '
  'sobre TODOS, inclusive fora do escopo — é daí que sai o aviso "a régua '
  'discorda". `sugestao` nula = as fontes discordam. `no_escopo` diz onde '
  'fn_avaliar_criativos pode gravar. A escada e o vocabulário são lidos de '
  'vw_crivo_niveis_vigentes: nenhum número nem nome de nível está escrito aqui.';

-- ---------------------------------------------------------------------------
-- 3. Quem aplica
-- ---------------------------------------------------------------------------
create or replace function public.fn_avaliar_criativos(p_card uuid default null)
  returns integer
  language plpgsql
  security invoker
  set search_path to 'public'
as $fn$
declare
  v_gravados integer;
begin
  -- O veredito é registrado para todo card, dentro ou fora do escopo.
  insert into public.avaliacao_sugerida
    (producao_id, sugestao, motivo, crivo_versao_id, no_escopo, decidido_em)
  select s.producao_id, s.sugestao, s.motivo, s.crivo_versao_id, s.no_escopo, now()
    from public.vw_criativo_avaliacao_sugerida s
   where p_card is null or s.producao_id = p_card
  on conflict (producao_id) do update
    set sugestao        = excluded.sugestao,
        motivo          = excluded.motivo,
        crivo_versao_id = excluded.crivo_versao_id,
        no_escopo       = excluded.no_escopo,
        decidido_em     = excluded.decidido_em;

  -- E só então o que pode ser gravado.
  with alvo as (
    select s.producao_id, s.sugestao, s.motivo, s.crivo_versao_id,
           p.avaliacao as de
      from public.vw_criativo_avaliacao_sugerida s
      join public.producoes p on p.id = s.producao_id
     where s.sugestao is not null
       and s.no_escopo
       -- A GUARDA, repetida aqui de propósito. A view já filtra, mas é neste
       -- `update` que o estrago aconteceria, e é esta linha que o teste
       -- `a-regua-so-toca-o-que-e-dela` procura. Sem ela, os 393 julgamentos
       -- reais e os 3.467 cards fora do escopo viram alvo.
       and (p.avaliacao_origem is null or p.avaliacao_origem = 'automatico')
       and (p.avaliacao is distinct from s.sugestao
            or p.avaliacao_origem is null)
       and (p_card is null or s.producao_id = p_card)
  ),
  gravado as (
    update public.producoes p
       set avaliacao        = a.sugestao,
           avaliacao_origem = 'automatico'
      from alvo a
     where p.id = a.producao_id
       -- Repetida também no `where` do update: um dia alguém mexe no CTE.
       and (p.avaliacao_origem is null or p.avaliacao_origem = 'automatico')
    returning p.id, a.de, a.sugestao, a.motivo, a.crivo_versao_id
  )
  insert into public.avaliacao_automatica_log (producao_id, de, para, motivo, versao_id)
  select g.id, g.de, g.sugestao, g.motivo, g.crivo_versao_id from gravado g;

  get diagnostics v_gravados = row_count;
  return v_gravados;
end $fn$;

comment on function public.fn_avaliar_criativos(uuid) is
  'Aplica a régua vigente. Grava a sugestão para todo card postado e atualiza '
  'producoes.avaliacao SÓ onde avaliacao_origem é nula ou ''automatico''. Nunca '
  'escreve em criativo_historico (ver o cabeçalho de 20261009c) e nunca toca '
  'status_veiculacao, que é intenção dela. Devolve quantos cards mudaram.';

-- ---------------------------------------------------------------------------
-- 4. O desfazer
-- ---------------------------------------------------------------------------
create or replace function public.fn_desfazer_avaliacao_automatica(p_desde timestamptz)
  returns integer
  language plpgsql
  security invoker
  set search_path to 'public'
as $fn$
declare
  v_n integer;
begin
  -- Em ordem inversa: se o mesmo card foi escrito duas vezes depois de
  -- `p_desde`, o valor que vale é o `de` da escrita mais ANTIGA.
  with primeira as (
    select distinct on (l.producao_id) l.producao_id, l.de
      from public.avaliacao_automatica_log l
     where l.em >= p_desde
     order by l.producao_id, l.em asc
  ),
  voltado as (
    update public.producoes p
       set avaliacao = f.de,
           -- Volta a ser "a régua ainda não olhou", não 'humano': desfazer não
           -- inventa julgamento humano onde não houve.
           avaliacao_origem = case when f.de is null then null else 'automatico' end
      from primeira f
     where p.id = f.producao_id
       and p.avaliacao_origem = 'automatico'
    returning p.id
  )
  select count(*) into v_n from voltado;
  return v_n;
end $fn$;

comment on function public.fn_desfazer_avaliacao_automatica(timestamptz) is
  'Desfaz as escritas automáticas a partir de um instante, lendo '
  'avaliacao_automatica_log. Só mexe em card que ainda está ''automatico'' — o '
  'que ela confirmou depois fica.';

revoke all on function public.fn_avaliar_criativos(uuid) from anon;
revoke all on function public.fn_desfazer_avaliacao_automatica(timestamptz) from anon;
grant execute on function public.fn_avaliar_criativos(uuid) to authenticated;
grant execute on function public.fn_desfazer_avaliacao_automatica(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros   text := '';
  v_antes   jsonb;
  v_depois  jsonb;
  v_gravou  integer;
  v_n       integer;
  v_total   integer;
begin
  -- Retrato de antes: a distribuição de `avaliacao` e de `avaliacao_origem`.
  select jsonb_build_object(
           'aval',   (select jsonb_object_agg(coalesce(avaliacao,'(nulo)'), c)
                        from (select avaliacao, count(*) c from public.producoes group by 1) x),
           'origem', (select jsonb_object_agg(coalesce(avaliacao_origem,'(nulo)'), c)
                        from (select avaliacao_origem, count(*) c from public.producoes group by 1) y))
    into v_antes;

  -- A régua roda de verdade.
  v_gravou := public.fn_avaliar_criativos();

  -- 1. HOJE ela não pode muder nada: todo card postado levou selo em
  --    20261009b, então o escopo está vazio. Se isto vier diferente de zero,
  --    o selo não pegou e a régua está mexendo na base antiga — o oposto do
  --    que foi pedido.
  if v_gravou <> 0 then
    v_erros := v_erros || format(
      'fn_avaliar_criativos gravou %s cards, e deveria gravar 0: nenhum card postado esta no escopo. ', v_gravou);
  end if;

  -- 2. E nada mudou mesmo — conferido pelo retrato, não pelo retorno.
  select jsonb_build_object(
           'aval',   (select jsonb_object_agg(coalesce(avaliacao,'(nulo)'), c)
                        from (select avaliacao, count(*) c from public.producoes group by 1) x),
           'origem', (select jsonb_object_agg(coalesce(avaliacao_origem,'(nulo)'), c)
                        from (select avaliacao_origem, count(*) c from public.producoes group by 1) y))
    into v_depois;
  if v_antes <> v_depois then
    v_erros := v_erros || format('a distribuicao mudou. antes=%s depois=%s. ', v_antes, v_depois);
  end if;

  -- 3. Nenhuma linha de máquina em criativo_historico.
  select count(*) into v_n from public.criativo_historico
   where campo_alterado = 'avaliacao' and criado_em > now() - interval '1 minute';
  if v_n <> 0 then
    v_erros := v_erros || format('a regua escreveu %s linha(s) em criativo_historico. ', v_n);
  end if;

  -- 4. O log está vazio, porque nada foi gravado.
  select count(*) into v_n from public.avaliacao_automatica_log;
  if v_n <> 0 then
    v_erros := v_erros || format('avaliacao_automatica_log tem %s linha(s) e nada foi gravado. ', v_n);
  end if;

  -- 5. Mas a SUGESTÃO existe para todo card postado do tipo criativo: é dela
  --    que vive o aviso "a regua discorda" sobre os 393 julgados por gente.
  select count(*) into v_total from public.producoes
   where fase = 'postado' and tipo = 'criativo';
  select count(*) into v_n from public.avaliacao_sugerida;
  if v_n <> v_total then
    v_erros := v_erros || format('avaliacao_sugerida tem %s linhas, esperava %s (todo criativo postado). ', v_n, v_total);
  end if;

  -- 6. Nenhuma sugestao esta fora do vocabulario.
  select count(*) into v_n from public.avaliacao_sugerida s
   where s.sugestao is not null
     and not exists (select 1 from public.criativo_campos_opcoes o
                      where o.campo = 'avaliacao' and o.valor = s.sugestao);
  if v_n <> 0 then
    v_erros := v_erros || format('%s sugestao(oes) fora de criativo_campos_opcoes. ', v_n);
  end if;

  -- 7. Nenhuma VSL nem aula entrou: `fn_criativos_metricas` nao filtra tipo, e
  --    sem o filtro na view as 68 VSLs viriam com "sem verba", reescrevendo
  --    julgamento humano.
  select count(*) into v_n from public.avaliacao_sugerida s
   join public.producoes p on p.id = s.producao_id
  where p.tipo <> 'criativo';
  if v_n <> 0 then
    v_erros := v_erros || format('%s card(s) que nao sao criativo entraram na regua. ', v_n);
  end if;

  -- 8. Quem nao tem sugestao tem motivo dizendo qual e a divergencia.
  select count(*) into v_n from public.avaliacao_sugerida
   where sugestao is null and motivo not like '%discordam%';
  if v_n <> 0 then
    v_erros := v_erros || format('%s card(s) sem sugestao e sem motivo de divergencia. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.avaliacao_sugerida where sugestao is null;
  raise notice 'PROVA OK: a regua rodou, gravou 0 (escopo vazio, como esperado), e nada mudou. % sugestoes registradas, % delas sem veredito por divergencia entre as fontes.',
    v_total, v_n;
end $prova$;

notify pgrst, 'reload schema';
