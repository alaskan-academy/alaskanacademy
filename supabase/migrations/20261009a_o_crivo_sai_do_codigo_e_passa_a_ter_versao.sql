-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O crivo sai do código e passa a ter versão                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A régua que separa "Validado" de "Não validado" mora hoje numa constante do
-- React — `CRIVO` em `src/features/criativos/components/AvaliacaoView.tsx:141` —
-- junto de cinco parágrafos explicando de onde veio cada número. Ela nunca foi
-- aplicada: é um número que a pessoa lê na tela e reproduz à mão em 3.004 cards.
--
-- Para a régua passar a decidir sozinha, ela precisa estar no banco. E ao mover,
-- duas coisas que valem mais que a mudança em si:
--
-- 1. **A PROSA VEM COM OS NÚMEROS, na mesma linha imutável.** Hoje o empate
--    aparece em `CRIVO.empate = '1,6'` no TSX, em `roas_7 < 1.6` em
--    `20260924b:125`, e em texto corrido em `MetaAdsPage.tsx:306` — três cópias,
--    e já existe um teste (`o-empate-e-um-so`) só para impedir que divirjam. Com
--    número e justificativa na mesma linha versionada, divergir deixa de ser
--    possível.
--
-- 2. **A VERSÃO ANTIGA NÃO É APAGADA.** A tabela nasce com DUAS linhas: a régua
--    medida em 06/09/2026 sobre 782 ADs, e a decidida em 09/10/2026. Três
--    motivos: a medição dos 782 não se perde; a tabela nasce provando que o
--    versionamento funciona de verdade (e não é um retrato que ninguém atualiza
--    — quarta armadilha); e daqui a dois meses dá para perguntar qual das duas
--    acertou mais.
--
-- ── `medido_em` é ANULÁVEL, e isso é o ponto ──────────────────────────────
--
-- A v1 foi medida. A v2 foi DECIDIDA. Chamar as duas de "medida" seria mentir na
-- tela, e inventar uma data de medição para a v2 seria pior: alguém leria aquilo
-- como procedência. Nulo em `medido_em` quer dizer "esta régua foi escolhida, não
-- apurada" — e a tela mostra isso como tal.
--
-- Mais: DUAS das cinco afirmações da prosa antiga foram remedidas em 09/10/2026
-- e **não reproduzem**:
--   · "quem passou em 2,5 rendeu 1,64 depois" → dá 1,21 e 0,91 por dois caminhos
--     independentes, e exigir 2,5 é PIOR que 1,8 (sobrevivência 16,7% vs 21,6%);
--   · "com 4 vendas acerta 71%, com 6 acerta 86%" → a dispersão do ROAS em 5 e
--     em 6 vendas é a mesma (0,61), e a primeira queda real é de 6 para 8.
-- A v1 guarda a prosa como ela era, porque é documento histórico. A v2 registra
-- a refutação. Apagar seria perder a informação mais cara que a medição produziu.
--
-- ── Por que `clausula`, e por que `roas_inclusivo` ────────────────────────
--
-- A régua nova define Validado como DUAS condições alternativas:
--   (10 vendas e ROAS >= 1,65)  ou  (5 vendas e ROAS > 2)
-- Uma linha por nível não expressa isso. Com `clausula`, um nível é uma lista de
-- condições em OU — que também é mais fiel ao que a regra diz: uma CURVA DE
-- TROCA entre volume e retorno, onde menos vendas exigem margem maior.
--
-- E os operadores são deliberadamente mistos: `>= 1,65` na cláusula de volume,
-- `> 2` na de poucas vendas, `> 1,8` no Escalado. Guardar só o número perderia a
-- diferença, e um teste comparando tela com função acusaria divergência que não
-- existe — ou deixaria passar uma que existe.
--
-- ── `verba_min` na tabela, não no código ─────────────────────────────────
--
-- O piso de R$ 80 é "um ticket do produto": medido, o ticket mediano é R$ 83,60
-- (médio R$ 89,84; p10–p90 de R$ 47 a R$ 136 sobre 5.949 vendas desde 01/07).
-- Ele responde QUANDO CORTAR, não quando validar — gastou um ticket e não vendeu
-- nada, morreu. Piso escrito à mão é a terceira armadilha, e este muda junto com
-- o ticket.
--
-- ── A margem é DERIVADA, e por isso não é coluna ─────────────────────────
--
-- `margem(R) = k · (1/empate − 1/R)`, com `k = 1 + imposto_meta_ads_pct/100`.
-- Confere: com empate 1,56 e k 1,14, ROAS 1,8 dá 9,7% e ROAS 2,0 dá 16,1%.
-- Guardar a margem como número a congelaria; derivando, ela se recalcula sozinha
-- quando a alíquota mudar — que é exatamente o que acabou de acontecer com o
-- Simples (9% → 6,9359%, `20261008i`), levando o empate de 1,6 para 1,56.
--
-- Nada lê estas tabelas ainda. A migração é aditiva e não muda nenhum valor de
-- `producoes.avaliacao`.

begin;

-- ---------------------------------------------------------------------------
-- 1. crivo_versoes — uma linha por régua, imutável
-- ---------------------------------------------------------------------------
create table if not exists public.crivo_versoes (
  id                 uuid primary key default gen_random_uuid(),
  campo              text not null default 'avaliacao',
  vigente_de         date not null,
  -- NULO = decidida, não medida. Ver o cabeçalho.
  medido_em          date,
  -- O break-even: o ROAS em que o anúncio empata. NÃO é nível de validação.
  empate             numeric(5,2) not null check (empate > 0),
  -- Piso de verba para o card ser julgável ("um ticket do produto").
  verba_min          numeric(10,2) not null check (verba_min >= 0),
  base_ads           integer,
  base_investimento  numeric(12,2),
  base_ini           date,
  base_fim           date,
  nivel_sem_verba    text not null,
  nivel_reprovado    text not null,
  justificativa      text[] not null check (cardinality(justificativa) > 0),
  criado_em          timestamptz not null default now(),

  constraint crivo_versoes_campo_vigencia_key unique (campo, vigente_de),
  -- Existe só para a FK composta de `crivo_niveis` abaixo poder amarrar o campo.
  constraint crivo_versoes_id_campo_key unique (id, campo),
  -- O vocabulário é da TABELA, não do código: régua não pode falar de um nível
  -- que `criativo_campos_opcoes` não tem. É a cura da raiz do bug do "Escalado",
  -- que existe em 19 cards e falta em cinco listas fixas do front.
  constraint crivo_versoes_sem_verba_fkey foreign key (campo, nivel_sem_verba)
    references public.criativo_campos_opcoes (campo, valor),
  constraint crivo_versoes_reprovado_fkey foreign key (campo, nivel_reprovado)
    references public.criativo_campos_opcoes (campo, valor)
);

comment on table public.crivo_versoes is
  'A régua de avaliação de criativo, versionada. Uma linha por régua, imutável: '
  'prosa e números juntos para não poderem divergir. `medido_em` nulo significa '
  'régua DECIDIDA, não apurada. `empate` é break-even e NÃO é nível de validação '
  '— `vw_ad_morrendo` depende dele. A margem de cada nível é derivada, nunca '
  'guardada: margem(R) = (1 + imposto_meta/100) * (1/empate - 1/R). '
  'Próximo passo previsto: derivar `empate` de fn_aliquota_simples + taxa Payt + '
  'custo fixo, em vez de ser digitado.';

-- ---------------------------------------------------------------------------
-- 2. crivo_niveis — as cláusulas de cada nível, em OU
-- ---------------------------------------------------------------------------
create table if not exists public.crivo_niveis (
  versao_id       uuid not null references public.crivo_versoes(id) on delete cascade,
  campo           text not null default 'avaliacao',
  nivel           text not null,
  -- 1, 2, …: o nível passa se QUALQUER cláusula passar.
  clausula        integer not null check (clausula >= 1),
  vendas_min      integer not null check (vendas_min >= 0),
  roas_min        numeric(5,2) not null check (roas_min > 0),
  -- true = `>=`, false = `>`. A régua mistura os dois de propósito.
  roas_inclusivo  boolean not null default true,
  -- Ordem de teste da escada: o MAIOR primeiro (Escalado antes de Validado).
  ordem           integer not null,
  significa       text not null,

  primary key (versao_id, nivel, clausula),
  -- Amarra `campo` ao da versão: dois campos dizendo a mesma coisa divergem
  -- (primeira armadilha), então aqui o banco impede em vez de confiar.
  constraint crivo_niveis_versao_campo_fkey foreign key (versao_id, campo)
    references public.crivo_versoes (id, campo),
  constraint crivo_niveis_nivel_fkey foreign key (campo, nivel)
    references public.criativo_campos_opcoes (campo, valor)
);

create index if not exists idx_crivo_niveis_versao on public.crivo_niveis (versao_id, ordem);

comment on table public.crivo_niveis is
  'As cláusulas de cada nível da régua, avaliadas em OU: o nível passa se '
  'QUALQUER uma passar. É assim que "margem boa com poucas vendas OU margem '
  'pequena com volume maior" cabe na tabela — uma curva de troca, não um ponto. '
  '`ordem` é a ordem de teste da escada, do nível mais alto para o mais baixo.';

-- ---------------------------------------------------------------------------
-- 3. RLS — leitura para quem está logado, escrita idem (ferramenta interna)
-- ---------------------------------------------------------------------------
alter table public.crivo_versoes enable row level security;
alter table public.crivo_niveis  enable row level security;

drop policy if exists crivo_versoes_rw on public.crivo_versoes;
create policy crivo_versoes_rw on public.crivo_versoes
  for all to authenticated using (true) with check (true);

drop policy if exists crivo_niveis_rw on public.crivo_niveis;
create policy crivo_niveis_rw on public.crivo_niveis
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. As duas views do que está vigente
-- ---------------------------------------------------------------------------
-- `security_invoker = on` escrito NA PRÓPRIA INSTRUÇÃO, não num `alter` à
-- parte: `create or replace view` REDEFINE as reloptions, e um replace futuro
-- que omita a opção APAGA o invoker em silêncio. Foi o que derrubou `vw_alertas`
-- e `vw_rev_tendencia` em 04/10/2026.
create or replace view public.vw_crivo_vigente
  with (security_invoker = on) as
select distinct on (v.campo)
       v.id,
       v.campo,
       v.vigente_de,
       v.medido_em,
       v.empate,
       v.verba_min,
       v.base_ads,
       v.base_investimento,
       v.base_ini,
       v.base_fim,
       v.nivel_sem_verba,
       v.nivel_reprovado,
       v.justificativa,
       -- O multiplicador da mídia (1,14 hoje), lido da configuração e não
       -- escrito aqui: é com ele que a tela calcula a margem de cada nível.
       1 + coalesce(public.fn_config('imposto_meta_ads_pct', null::uuid), 0) / 100 as fator_midia
  from public.crivo_versoes v
 where v.vigente_de <= current_date
 order by v.campo, v.vigente_de desc;

comment on view public.vw_crivo_vigente is
  'A régua em vigor hoje, uma linha por campo. `fator_midia` sai de '
  'fn_config(imposto_meta_ads_pct) para a tela derivar a margem sem número '
  'escrito no código.';

create or replace view public.vw_crivo_niveis_vigentes
  with (security_invoker = on) as
select n.versao_id,
       n.campo,
       n.nivel,
       n.clausula,
       n.vendas_min,
       n.roas_min,
       n.roas_inclusivo,
       n.ordem,
       n.significa,
       -- margem(R) = fator * (1/empate - 1/R). Derivada, nunca guardada.
       round(v.fator_midia * (1 / v.empate - 1 / n.roas_min), 4) as margem
  from public.vw_crivo_vigente v
  join public.crivo_niveis n on n.versao_id = v.id and n.campo = v.campo;

comment on view public.vw_crivo_niveis_vigentes is
  'As cláusulas da régua vigente, com a margem sobre a receita DERIVADA do '
  'empate. Avaliadas em OU dentro de cada nível; `ordem` desc é a ordem de teste.';

-- ---------------------------------------------------------------------------
-- 5. Semente: as DUAS versões
-- ---------------------------------------------------------------------------
do $$
declare
  v1 uuid;
  v2 uuid;
begin
  -- ── v1: a régua MEDIDA, 06/09/2026 ───────────────────────────────────────
  -- Prosa preservada literalmente de `TabelaDoCrivo` (AvaliacaoView.tsx:185-209).
  -- Guardada como documento histórico, inclusive as duas afirmações que a
  -- remedição de 09/10 refutou — apagá-las perderia a informação.
  insert into public.crivo_versoes (
    campo, vigente_de, medido_em, empate, verba_min,
    base_ads, base_investimento, base_ini, base_fim,
    nivel_sem_verba, nivel_reprovado, justificativa)
  values (
    'avaliacao', '2026-09-06', '2026-09-06', 1.60, 0,
    782, 242143.00, '2026-06-01', '2026-09-04',
    'Sem dados', 'Não validado',
    array[
      'Vendas e ROAS da **Payt**, nunca do Meta — a janela de 7 dias do Meta credita venda de backend ao anúncio de topo.',
      'ROAS 1,6 é o empate real: taxa da Payt 6,1% + reembolso 1,7% + Simples 9% + 14% de imposto sobre a mídia + R$ 25.000/mês de custo fixo. Sem o custo fixo daria 1,37, e aí validar seria validar no zero.',
      '2,5 para escalar porque escalar derruba o ROAS para ~63% do que era no teste — 80% dos ADs caem. Medido: quem passou em 2,5 rendeu 1,64 depois; quem passou em 2,0 rendeu 1,60 e em 1,6 rendeu 1,49, os dois abaixo do empate.',
      '6 e 10 vendas são sobre confiança: com 4 vendas a decisão acerta 71%, com 6 acerta 86%, e a dispersão do ROAS só fecha em 10 (desvio cai de 1,54 para 0,32). ROAS alto com 3 vendas é sorte.',
      'Medido em 06/09/2026 sobre 782 ADs e R$ 242.143 de mídia (01/06 a 04/09). Se a taxa da Payt, o Simples ou o custo fixo mudarem, o 1,6 muda junto.'
    ])
  on conflict (campo, vigente_de) do nothing
  returning id into v1;

  if v1 is not null then
    insert into public.crivo_niveis
      (versao_id, campo, nivel, clausula, vendas_min, roas_min, roas_inclusivo, ordem, significa)
    values
      (v1, 'avaliacao', 'Escalado', 1, 10, 2.50, true, 2, 'aguenta verba — pode aumentar o orçamento'),
      (v1, 'avaliacao', 'Validado', 1,  6, 1.60, true, 1, 'se paga — mantém no ar e pede variação');
  end if;

  -- ── v2: a régua DECIDIDA, 09/10/2026 ─────────────────────────────────────
  -- `medido_em` NULO de propósito. A prosa diz o que foi decidido, o que foi
  -- medido, e o que foi medido E REFUTADO.
  insert into public.crivo_versoes (
    campo, vigente_de, medido_em, empate, verba_min,
    base_ads, base_investimento, base_ini, base_fim,
    nivel_sem_verba, nivel_reprovado, justificativa)
  values (
    'avaliacao', '2026-10-09', null, 1.56, 80.00,
    null, null, null, null,
    'Sem dados', 'Não validado',
    array[
      'Validado tem **duas cláusulas, em OU**: margem boa com poucas vendas (5 vendas e ROAS acima de 2 — 16,1% sobre a receita), ou margem pequena com volume maior (10 vendas e ROAS a partir de 1,65 — 4,0%). Nenhuma das duas é zero, que é o que o empate seria.',
      'O **empate é 1,56**, não 1,6: recalculado com o Simples em 6,9359% (medido por vw_aliquota_simples_mes) contra os 9% do cálculo de setembro. A régua antiga validava praticamente NO empate; esta valida acima dele.',
      'O piso de **R$ 80 é um ticket do produto** — ticket mediano medido em R$ 83,60 (médio R$ 89,84; p10–p90 de R$ 47 a R$ 136, sobre 5.949 vendas desde 01/07). Ele responde quando CORTAR, não quando validar: gastou um ticket e não vendeu nada, morreu. Medido: 180 dos 199 cards entre R$ 80 e R$ 348 são reprovados por essa regra com razão (83 não venderam nada, 97 venderam no vermelho).',
      'Escalado exige **ROAS acima de 1,8 além das 15 vendas**, e o piso não é decorativo: sem ele, 60 cards receberiam nota máxima somando −R$ 67.441 de lucro, 26 deles no vermelho, e 55 dos 60 reprovariam no teste do próprio Validado. Com o piso, a escada fica monotônica.',
      'Duas afirmações da régua anterior foram **remedidas em 09/10/2026 e não se confirmaram**: "quem passou em 2,5 rendeu 1,64 depois" dá 1,21 e 0,91 por dois caminhos independentes, e exigir 2,5 é pior que 1,8 (sobrevivência 16,7% contra 21,6%); e "com 6 vendas acerta 86%" não se sustenta — a dispersão do ROAS em 5 e em 6 vendas é a mesma (0,61), e a primeira queda real é de 6 para 8.',
      'Esta régua foi **decidida, não medida** — por isso `medido_em` está vazio. Ela vale só para cards postados a partir da estreia, e só se prova depois de uns dois meses de cards novos (100 a 185 criativos/mês, dos quais 50 a 100 passam do piso).'
    ])
  on conflict (campo, vigente_de) do nothing
  returning id into v2;

  if v2 is not null then
    insert into public.crivo_niveis
      (versao_id, campo, nivel, clausula, vendas_min, roas_min, roas_inclusivo, ordem, significa)
    values
      -- Escalado: 15 vendas e ROAS ESTRITAMENTE acima de 1,8.
      (v2, 'avaliacao', 'Escalado', 1, 15, 1.80, false, 2, 'aguenta verba — pode aumentar o orçamento'),
      -- Validado, cláusula 1: volume maior, margem pequena (4,0%).
      (v2, 'avaliacao', 'Validado', 1, 10, 1.65, true,  1, 'se paga — mantém no ar e pede variação'),
      -- Validado, cláusula 2: poucas vendas, margem boa (16,1%).
      (v2, 'avaliacao', 'Validado', 2,  5, 2.00, false, 1, 'se paga — mantém no ar e pede variação');
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $$
declare
  v_erros text := '';
  v_vig   record;
  v_esc   numeric;
  v_val   numeric;
  v_n     integer;
begin
  -- 1. Existe exatamente UMA régua vigente, e é a v2.
  select count(*) into v_n from public.vw_crivo_vigente;
  if v_n <> 1 then
    v_erros := v_erros || format('vw_crivo_vigente devolveu %s linhas, esperava 1. ', v_n);
  end if;

  select * into v_vig from public.vw_crivo_vigente;
  if v_vig.vigente_de <> '2026-10-09' then
    v_erros := v_erros || format('a vigente é de %s, esperava 2026-10-09. ', v_vig.vigente_de);
  end if;
  if v_vig.empate <> 1.56 then
    v_erros := v_erros || format('o empate vigente é %s, esperava 1.56. ', v_vig.empate);
  end if;
  if v_vig.verba_min <> 80 then
    v_erros := v_erros || format('o piso de verba é %s, esperava 80. ', v_vig.verba_min);
  end if;

  -- 2. A v2 foi DECIDIDA: `medido_em` tem de estar vazio. Se alguém preencher
  --    uma data aqui, a tela passa a apresentar escolha como apuração.
  if v_vig.medido_em is not null then
    v_erros := v_erros || 'a régua vigente tem medido_em preenchido, mas ela foi decidida e não medida. ';
  end if;

  -- 3. As DUAS versões existem. A v1 é o documento histórico da medição dos
  --    782 ADs; perdê-la é perder a única régua que foi apurada de verdade.
  select count(*) into v_n from public.crivo_versoes;
  if v_n <> 2 then
    v_erros := v_erros || format('crivo_versoes tem %s linhas, esperava 2 (a medida e a decidida). ', v_n);
  end if;

  -- 4. O Validado da vigente tem DUAS cláusulas — é a curva de troca.
  select count(*) into v_n
    from public.vw_crivo_niveis_vigentes where nivel = 'Validado';
  if v_n <> 2 then
    v_erros := v_erros || format('o Validado vigente tem %s cláusula(s), esperava 2. ', v_n);
  end if;

  -- 5. A ESCADA É MONOTÔNICA: o piso de ROAS do nível mais alto não pode ser
  --    menor que o do nível de baixo. Sem isto, 60 cards / R$ 294.286 de verba
  --    recebem nota máxima reprovando no teste da nota do meio, e 26 deles
  --    estão no vermelho. É o defeito mais caro que esta tabela pode ter.
  select min(roas_min) into v_esc from public.vw_crivo_niveis_vigentes where nivel = 'Escalado';
  select min(roas_min) into v_val from public.vw_crivo_niveis_vigentes where nivel = 'Validado';
  if v_esc is null or v_val is null then
    v_erros := v_erros || 'falta Escalado ou Validado na régua vigente. ';
  elsif v_esc < v_val then
    v_erros := v_erros || format('escada NÃO monotônica: Escalado pede ROAS %s e Validado pede %s. ', v_esc, v_val);
  end if;

  -- 6. Toda cláusula tem margem POSITIVA. "Sempre com margem" é a regra que a
  --    define; uma cláusula no empate ou abaixo dele validaria no zero.
  select count(*) into v_n from public.vw_crivo_niveis_vigentes where margem <= 0;
  if v_n > 0 then
    v_erros := v_erros || format('%s cláusula(s) da régua vigente têm margem <= 0. ', v_n);
  end if;

  -- 7. A margem derivada bate com a conta à mão: ROAS 1,8 com empate 1,56 e
  --    fator 1,14 tem de dar 9,74%. Se `fator_midia` deixar de vir da
  --    configuração, este número muda e a prova acusa.
  select margem into v_val from public.vw_crivo_niveis_vigentes
   where nivel = 'Escalado' and clausula = 1;
  if v_val is null or abs(v_val - 0.0974) > 0.001 then
    v_erros := v_erros || format('a margem do Escalado deu %s, esperava ~0,0974. ', v_val);
  end if;

  -- 8. A justificativa da vigente CITA o próprio empate. Trava barata contra
  --    prosa que descreve uma régua que já mudou.
  if not exists (
    select 1 from public.vw_crivo_vigente v, unnest(v.justificativa) as p
     where p like '%1,56%'
  ) then
    v_erros := v_erros || 'a justificativa da régua vigente não cita o empate de 1,56. ';
  end if;

  -- 9. Nenhum nível fala de valor que o vocabulário não tem. A FK garante, mas
  --    uma contagem explícita documenta a intenção.
  select count(*) into v_n
    from public.crivo_niveis n
   where not exists (select 1 from public.criativo_campos_opcoes o
                      where o.campo = n.campo and o.valor = n.nivel);
  if v_n > 0 then
    v_erros := v_erros || format('%s nível(is) fora de criativo_campos_opcoes. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: duas réguas na tabela (a medida de 06/09 e a decidida de 09/10), a vigente com empate 1,56, piso R$ 80, Validado em duas cláusulas, escada monotônica (Escalado 1,80 >= Validado 1,65) e margem derivada de 9,74%% no Escalado.';
end $$;

notify pgrst, 'reload schema';
