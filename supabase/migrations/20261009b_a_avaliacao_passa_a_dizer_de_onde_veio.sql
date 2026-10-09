-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A avaliação passa a dizer de onde veio                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `producoes.avaliacao` é um texto sem procedência: olhando o campo não há como
-- saber se alguém decidiu aquilo ou se veio de uma importação. E medido, a
-- maioria veio de importação:
--
--   · 2.735 cards em `postado` têm valor em `avaliacao`;
--   · `criativo_historico` tem 583 alterações de `avaliacao`, tocando 393 cards.
--
-- Ou seja ~2.340 valores nunca passaram pela tela. O preço disso é visível: 133
-- cards marcados "Validado" **nunca rodaram um anúncio** — não têm uma linha em
-- `producao_ads`, não gastaram um centavo — e entram na esteira do Copy como
-- pedido de variação. É a quarta armadilha: a carga inicial preencheu o passado
-- e nada mantinha o presente.
--
-- ── Três valores, e o terceiro é o que viabiliza a automação ──────────────
--
--   'humano'          alguém decidiu — tem registro em criativo_historico
--   'automatico'      a régua decidiu, e ninguém revisou ainda
--   'fora_do_escopo'  a régua não opina sobre este card
--
-- Sem o terceiro nome a automação não nasce: ou os ~2.340 da carga contam como
-- humanos (e a régua nunca os corrige) ou contam como automáticos (e some a
-- diferença entre "a máquina decidiu agora" e "veio da importação").
--
-- Isto NÃO é a primeira armadilha. `avaliacao` e `avaliacao_origem` respondem
-- perguntas diferentes — "qual é o valor" e "quem o pôs" —, do mesmo jeito que
-- `producao_ads.origem` e que `transacoes.categoria` + `categoria_origem` +
-- `status_revisao`, os dois já em produção. A proteção contra a armadilha não é
-- ter um campo só: é ter UM ESCRITOR SÓ por campo, e isso é testado.
--
-- ── O ESCOPO: "só os novos", e por que não é uma data ────────────────────
--
-- A régua foi decidida em 09/10/2026 para valer **só em cards novos** — nada do
-- que já existe é tocado. Isso poderia ser uma data de corte, e é melhor como
-- selo, por duas razões: a fila "a revisar" não enche com milhares de cards
-- antigos, e a tela pode dizer POR QUE um card antigo não tem sugestão, em vez
-- de parecer um buraco.
--
-- O escopo da régua passa a ser, literalmente: `avaliacao_origem IS NULL OR
-- = 'automatico'`.
--
-- E a linha de corte não é "existe hoje" — é **já viveu**:
--
--   · `postado` e `arquivado` (3.860 cards) → já tiveram sua chance: SELO
--   · as outras fases (326 cards, 107 criativos) → vão ser postados nas
--     próximas semanas e são NOVOS para a avaliação: ficam NULOS
--
-- Marcar os 326 como fora do escopo seria excluir justamente os primeiros cards
-- que a régua deveria atender — e eles não têm como se reapresentar, porque um
-- card só entra em `postado` uma vez.
--
-- Nenhum valor de `avaliacao` muda nesta migração. Só procedência.

begin;

alter table public.producoes
  add column if not exists avaliacao_origem text;

alter table public.producoes
  drop constraint if exists producoes_avaliacao_origem_check;
alter table public.producoes
  add constraint producoes_avaliacao_origem_check
  check (avaliacao_origem is null
         or avaliacao_origem in ('humano', 'automatico', 'fora_do_escopo'));

comment on column public.producoes.avaliacao_origem is
  'Quem pôs o valor que está em `avaliacao`. NULO = a régua ainda não olhou '
  '(card novo, à espera de verba). ''humano'' = alguém decidiu, e a régua NUNCA '
  'sobrescreve. ''automatico'' = a régua decidiu e ninguém revisou — é a fila "a '
  'revisar". ''fora_do_escopo'' = card que já estava postado ou arquivado quando '
  'a régua estreou (09/10/2026), e sobre o qual ela não opina. '
  'O escopo da régua é: IS NULL OR = ''automatico''.';

-- Parcial: a fila "a revisar" é o que a tela consulta, e são poucas linhas
-- dentro de 4.186. Índice cheio custaria o mesmo e serviria menos.
create index if not exists idx_producoes_avaliacao_a_revisar
  on public.producoes (avaliacao_origem)
  where avaliacao_origem is null or avaliacao_origem = 'automatico';

-- ---------------------------------------------------------------------------
-- Backfill — uso único, pela única evidência que existe
-- ---------------------------------------------------------------------------
-- `criativo_historico` é a ÚNICA prova de que alguém tocou a avaliação, e é por
-- isso que a automação nunca escreve nela (ver 20261009c): encher aquela tabela
-- de linhas de máquina destruiria a prova que este backfill usa, e ela também é
-- lida por `fn_desempenho_editores` e pela tela "o que eu aprovei".
--
-- Atenção ao `campo_alterado NULL`: há 60 linhas assim em criativo_historico.
-- O `=` já as descarta (NULL nunca iguala), e isso é deliberado — uma linha que
-- não diz qual campo mudou não é prova de que a avaliação mudou.
update public.producoes p
   set avaliacao_origem = 'humano'
 where p.fase in ('postado', 'arquivado')
   and p.avaliacao_origem is null
   and exists (select 1 from public.criativo_historico h
                where h.criativo_id = p.id
                  and h.campo_alterado = 'avaliacao');

update public.producoes p
   set avaliacao_origem = 'fora_do_escopo'
 where p.fase in ('postado', 'arquivado')
   and p.avaliacao_origem is null;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros     text := '';
  v_humano    integer;
  v_fora      integer;
  v_nulo      integer;
  v_auto      integer;
  v_com_valor integer;
  v_n         integer;
begin
  select count(*) filter (where avaliacao_origem = 'humano'),
         count(*) filter (where avaliacao_origem = 'fora_do_escopo'),
         count(*) filter (where avaliacao_origem = 'automatico'),
         count(*) filter (where avaliacao_origem is null),
         count(avaliacao)
    into v_humano, v_fora, v_auto, v_nulo, v_com_valor
    from public.producoes;

  -- 1. A FAIXA do 'humano'. Se vier 2.700, o `campo_alterado` mudou de nome e o
  --    backfill carimbou a carga inteira como julgamento dela — que é
  --    exactamente o erro que este selo existe para impedir.
  if v_humano < 300 or v_humano > 500 then
    v_erros := v_erros || format(
      'humano deu %s, esperava entre 300 e 500 (medido: 393). Conferir campo_alterado em criativo_historico. ', v_humano);
  end if;

  -- 2. Ninguém nasceu 'automatico': a régua não rodou ainda.
  if v_auto <> 0 then
    v_erros := v_erros || format('ja existem %s cards automatico, e nada deveria ter rodado. ', v_auto);
  end if;

  -- 3. Todo card ja postado ou arquivado tem selo. Um sem selo entraria no
  --    escopo da regua e seria reavaliado — o oposto de "so os novos".
  select count(*) into v_n from public.producoes
   where fase in ('postado', 'arquivado') and avaliacao_origem is null;
  if v_n <> 0 then
    v_erros := v_erros || format('%s cards postados/arquivados ficaram sem selo. ', v_n);
  end if;

  -- 4. E todo card que AINDA NAO foi postado continua nulo: eles sao os
  --    primeiros que a regua vai atender, e carimba-los os excluiria para
  --    sempre (um card entra em `postado` uma vez).
  select count(*) into v_n from public.producoes
   where fase not in ('postado', 'arquivado') and avaliacao_origem is not null;
  if v_n <> 0 then
    v_erros := v_erros || format('%s cards em producao receberam selo, e nao deveriam. ', v_n);
  end if;

  -- 5. NENHUM valor de avaliacao mudou. O backfill toca so a procedencia.
  if v_com_valor <> 3212 then
    v_erros := v_erros || format(
      'cards com avaliacao preenchida deu %s, esperava 3212 (2.735 postados + 477 arquivados). ', v_com_valor);
  end if;

  -- 6. Quem tem selo 'humano' tem mesmo registro no historico. Redundante com
  --    o `where` do update, e barato: acusa se alguem rodar o backfill ao
  --    contrario no futuro.
  select count(*) into v_n from public.producoes p
   where p.avaliacao_origem = 'humano'
     and not exists (select 1 from public.criativo_historico h
                      where h.criativo_id = p.id and h.campo_alterado = 'avaliacao');
  if v_n <> 0 then
    v_erros := v_erros || format('%s cards marcados humano sem registro no historico. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % humano (julgamento real), % fora do escopo (carga), % a espera da regua (ainda nao postados), 0 automatico. Nenhum valor de avaliacao mudou (% preenchidos).',
    v_humano, v_fora, v_nulo, v_com_valor;
end $prova$;

notify pgrst, 'reload schema';
