-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Metas e submetas: a árvore que o plano já tinha                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- "Pense no esquema de metas e submetas, talvez."
--
-- Ela disse isso no momento em que eu ia criar uma tabela `plano_fontes_
-- receita` solta, e tinha razão: o painel estava com QUATRO listas planas
-- (dez KPIs, oitenta ações, vinte e quatro ideias, três regras) e nenhuma
-- delas dizia por que a outra existe. O documento, por outro lado, já traz a
-- árvore escrita — ela está na seção 2, em prosa:
--
--     "As três alavancas, em ordem de impacto:
--        1. Receita fora do tráfego: de ~R$ 23 mil para R$ 100 mil/mês
--        2. ROAS de 1,6x para ~2,0x
--        3. Custo fixo com regra"
--
-- E a seção 6 decompõe a primeira em seis fontes, cada uma com alvo próprio
-- em R$/mês. São submetas com número, não texto de apoio.
--
--     R$ 100 mil de lucro líquido/mês até jul/27
--     ├─ 1. Receita fora do tráfego      R$ 100 mil/mês
--     │    ├─ Recorrência                20–25 mil
--     │    ├─ Mini lançamentos           15–25 mil
--     │    ├─ Régua de recompra          15–20 mil
--     │    ├─ Produto físico             15–20 mil
--     │    ├─ Leads próprios                10 mil
--     │    └─ Orgânico e parcerias          10 mil
--     ├─ 2. ROAS de 1,6x para ~2,0x
--     │    ├─ Ofertas refeitas (Saponaria e Workshop)
--     │    ├─ Mais LTV para bancar CAC
--     │    ├─ Pix recuperado
--     │    └─ Cortar o que roda abaixo de 1,35x
--     └─ 3. Custo fixo com regra
--          ├─ Retirada de sócios atrelada à margem
--          └─ Jurídico como projeto com teto
--
-- ── A conta que ninguém tinha conferido ───────────────────────────────────
--
-- Com as seis fontes numa tabela, dá para somar: o piso dá R$ 85 mil e o
-- teto R$ 110 mil. A meta da alavanca é R$ 100 mil, que cai dentro — o plano
-- fecha. Isso vira PROVA aqui, e é o tipo de coisa que só se descobre errada
-- quando alguém soma. Se uma fonte for repactuada para menos e o total
-- deixar de alcançar os R$ 100 mil, a migração seguinte reprova.
--
-- ── Dois números por nó, e por que não é a armadilha 1 ────────────────────
--
-- Um nó pode ter `kpi` e ter `valor_min`/`valor_max` ao mesmo tempo, e isso
-- parece dois campos dizendo o alvo. Não é: são duas perguntas diferentes,
-- e o documento faz as duas sobre o mesmo nó. Da alavanca 1 ele diz "R$ 100
-- mil/mês" (quanto este pedaço entrega) e também "24% da receita em jul/27"
-- (qual indicador mede isso). Reais e porcentagem da receita não se derivam
-- um do outro sem saber a receita total, que é justamente o que varia.
--
-- O alvo RASTREADO continua só em `metas` — `plano_objetivos` nunca guarda
-- data-alvo nem valor por prazo. Quem quer saber "quanto em dez/26" lê
-- `fn_metas_progresso`; aqui só mora a decomposição.
--
-- ── A ligação ação → objetivo é MINHA leitura, e está marcada ─────────────
--
-- As 80 ações não vêm com etiqueta de alavanca. Algumas o documento amarra
-- sozinho ("Pix recuperado" é alavanca 2; "Régua de recompra (seção 5)" é
-- alavanca 1), e essas eu ligo com confiança. As demais eu ligo pelo bloco,
-- que é uma inferência razoável mas é inferência.
--
-- Por isso `plano_acoes.objetivo_id` aceita nulo e a tela mostra quantas
-- ficaram sem dono. Ligação errada é pior que ausente, porque alguém
-- acredita nela — foi o que me fez deixar 21 das 24 ideias do brainstorm sem
-- KPI em `20261012k`.

begin;

create table if not exists public.plano_objetivos (
  id          uuid primary key default gen_random_uuid(),
  parte_de    uuid references public.plano_objetivos(id) on delete cascade,
  chave       text not null unique,
  titulo      text not null,
  descricao   text,
  -- Qual indicador rastreado reflete este no. O alvo POR PRAZO continua em
  -- `metas`: aqui nao ha data nenhuma, so a decomposicao.
  kpi         text references public.metas_kpi(chave),
  -- Quanto o plano atribui a este no, quando atribui. Em R$/mes, e so para
  -- os nos da alavanca 1 — os unicos a que o documento da numero proprio.
  valor_min   numeric,
  valor_max   numeric,
  unidade     text,
  secao       integer references public.plano_secoes(numero),
  ordem       integer not null default 100,
  constraint plano_objetivos_nao_e_parte_de_si check (parte_de is null or parte_de <> id),
  constraint plano_objetivos_faixa_coerente check (valor_min is null or valor_max is null or valor_min <= valor_max),
  constraint plano_objetivos_valor_tem_unidade check ((valor_min is null and valor_max is null) or unidade is not null)
);

comment on table public.plano_objetivos is
  'A arvore de metas e submetas do plano, como a secao 2 a escreve: um '
  'objetivo, tres alavancas, e as submetas de cada uma. NAO guarda alvo por '
  'prazo — isso e de `metas`. Aqui mora so a decomposicao, e e ela que da a '
  'cada uma das 80 acoes um "para que".';

comment on column public.plano_objetivos.valor_min is
  'Quanto o plano atribui a este no em R$/mes, quando atribui. Coexiste com '
  '`kpi` sem conflito: o documento diz da alavanca 1 tanto "R$ 100 mil/mes" '
  'quanto "24% da receita", e um nao se deriva do outro sem a receita total.';

alter table public.plano_objetivos enable row level security;
drop policy if exists plano_objetivos_admin on public.plano_objetivos;
create policy plano_objetivos_admin on public.plano_objetivos
  for all to authenticated using (true) with check (true);

-- ── A raiz e as três alavancas ────────────────────────────────────────────
insert into public.plano_objetivos (chave, parte_de, titulo, descricao, kpi, valor_min, valor_max, unidade, secao, ordem) values
  ('lucro_100k', null,
   'R$ 100 mil de lucro líquido por mês até jul/27',
   'Não gastando mais em tráfego: subindo o ROAS para ~2,0x e construindo R$ 100 mil/mês de receita que não depende de anúncio. Só com tráfego no ROAS de hoje, R$ 100 mil de lucro exigiriam ~R$ 1,1 milhão de receita por mês, que o Meta não entrega sem derrubar o ROAS.',
   'lucro_liquido_mes', null, null, null, 2, 10)
on conflict (chave) do nothing;

insert into public.plano_objetivos (chave, parte_de, titulo, descricao, kpi, valor_min, valor_max, unidade, secao, ordem)
select v.chave, r.id, v.titulo, v.descricao, v.kpi, v.vmin, v.vmax, v.un, v.secao, v.ordem
  from public.plano_objetivos r,
       (values
         ('alavanca_receita_propria',
          'Alavanca 1 — Receita fora do tráfego: de ~R$ 23 mil para R$ 100 mil/mês',
          'A de maior impacto, e a única que também reduz a dependência do Meta. Base de 13,5 mil compradoras, Handify Completo, mini lançamentos, sazonais, produto físico e orgânico. Meta: 24% da receita em jul/27, 35% em dez/27.',
          'receita_fora_trafego_pct', 100000::numeric, 100000::numeric, 'moeda', 6, 10),
         ('alavanca_roas',
          'Alavanca 2 — ROAS de 1,6x para ~2,0x',
          'Não vem de "criativo melhor" sozinho. Cada +0,2 de ROAS vale ~7 pontos de margem: 1,6x dá 13%, 1,8x dá 21%, 2,0x dá 27,5%. O empate é 1,35x, pela fórmula da planilha: margem = 0,84 − 1,13/ROAS.',
          'roas_medio', null::numeric, null::numeric, null, 2, 20),
         ('alavanca_custo_fixo',
          'Alavanca 3 — Custo fixo com regra',
          'O custo fixo de setembro foi ~R$ 39 mil com jurídico, e come toda a sobra. O plano prevê subir para R$ 50 mil até jul/27 por causa de 1–2 pessoas a mais, mas com regra e não por inércia.',
          null, null::numeric, null::numeric, null, 2, 30)
       ) as v(chave, titulo, descricao, kpi, vmin, vmax, un, secao, ordem)
 where r.chave = 'lucro_100k'
on conflict (chave) do nothing;

-- ── As seis fontes da alavanca 1 (seção 6) ────────────────────────────────
insert into public.plano_objetivos (chave, parte_de, titulo, descricao, kpi, valor_min, valor_max, unidade, secao, ordem)
select v.chave, p.id, v.titulo, v.descricao, v.kpi, v.vmin, v.vmax, 'moeda', 6, v.ordem
  from public.plano_objetivos p,
       (values
         ('fonte_recorrencia', 'Recorrência',
          'Handify Completo anual + Workshop/Comunidade mensal. De ~190 assinaturas ativas para 1.000 — e a medição mostrou que a base real eram 90, não 190.',
          'assinaturas_ativas', 20000::numeric, 25000::numeric, 10),
         ('fonte_mini_lancamentos', 'Mini lançamentos',
          'Um por mês para a base, 3–5 dias, produto novo de R$ 37–97.',
          null, 15000::numeric, 25000::numeric, 20),
         ('fonte_regua_recompra', 'Régua de recompra',
          'O pós-venda da seção 5: ~3% das 6 mil clientes ativas comprando ~R$ 97 por mês.',
          'recompra_90d_pct', 15000::numeric, 20000::numeric, 30),
         ('fonte_produto_fisico', 'Produto físico',
          'Kits de insumos com parceiro (seção 7), vendidos para a base e como bump.',
          null, 15000::numeric, 20000::numeric, 40),
         ('fonte_leads_proprios', 'Leads próprios',
          'Ferramentas gratuitas e aula gratuita captando cadastro; conversão por e-mail e WhatsApp.',
          'base_whatsapp_pct', 10000::numeric, 10000::numeric, 50),
         ('fonte_organico_parcerias', 'Orgânico e parcerias',
          'Instagram, TikTok, site, ChatGPT (já traz vendas), cupons de fornecedores, afiliadas.',
          null, 10000::numeric, 10000::numeric, 60)
       ) as v(chave, titulo, descricao, kpi, vmin, vmax, ordem)
 where p.chave = 'alavanca_receita_propria'
on conflict (chave) do nothing;

-- ── As quatro frentes da alavanca 2 ───────────────────────────────────────
insert into public.plano_objetivos (chave, parte_de, titulo, descricao, kpi, secao, ordem)
select v.chave, p.id, v.titulo, v.descricao, v.kpi, 2, v.ordem
  from public.plano_objetivos p,
       (values
         ('roas_ofertas_refeitas', 'Ofertas refeitas (Saponaria e Workshop)',
          'O Saponaria é 56% da receita e o plano manda refazê-lo antes de qualquer produto novo. O Workshop Buquê está em 1,0x com ticket de ~R$ 50 e não paga o CAC.', null, 10),
         ('roas_mais_ltv', 'Mais LTV para bancar CAC',
          'Quanto mais a cliente vale, mais caro se pode pagar por ela. De R$ 94 para R$ 150 até jul/27.', 'ltv_medio', 20),
         ('roas_pix_recuperado', 'Pix recuperado',
          'Em setembro, 511 Pix ficaram pendentes (R$ 53 mil) e 290 cartões foram recusados (R$ 31 mil). A recuperação trouxe R$ 4,8 mil, ~9% do pendente.', 'pix_pendente_recuperado_pct', 30),
         ('roas_cortar_abaixo_135', 'Cortar o que roda abaixo de 1,35x',
          'O empate da fórmula. Saponaria TSL (1,17x) e Escala VSL (1,00x) saem; a verba vai, em degraus de 20–25%, para Guias professoras (1,98x) e Escala Lembrancinha (2,87x).', null, 40)
       ) as v(chave, titulo, descricao, kpi, ordem)
 where p.chave = 'alavanca_roas'
on conflict (chave) do nothing;

-- ── As duas frentes da alavanca 3 ─────────────────────────────────────────
insert into public.plano_objetivos (chave, parte_de, titulo, descricao, secao, ordem)
select v.chave, p.id, v.titulo, v.descricao, 2, v.ordem
  from public.plano_objetivos p,
       (values
         ('fixo_retirada_socios', 'Retirada de sócios atrelada à margem',
          'Já caiu de R$ 13,2 mil para R$ 6–8 mil.', 10),
         ('fixo_juridico_com_teto', 'Jurídico tratado como projeto com teto',
          'Em setembro foram R$ 14,3 mil — o maior item do custo fixo, e tratado como recorrente.', 20)
       ) as v(chave, titulo, descricao, ordem)
 where p.chave = 'alavanca_custo_fixo'
on conflict (chave) do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- A ligação das ações
-- ───────────────────────────────────────────────────────────────────────────
alter table public.plano_acoes
  add column if not exists objetivo_id uuid references public.plano_objetivos(id) on delete set null;

comment on column public.plano_acoes.objetivo_id is
  'A que no da arvore esta acao serve. NULO e permitido e visivel na tela: '
  'ligacao errada e pior que ausente, porque alguem acredita nela.';

create index if not exists plano_acoes_por_objetivo on public.plano_acoes (objetivo_id)
  where objetivo_id is not null;

-- Por bloco, onde o bloco inteiro serve a um no só. E inferencia, mas e a
-- inferencia que o proprio documento sugere ao agrupar assim.
update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where a.objetivo_id is null and o.chave = 'roas_pix_recuperado' and a.bloco = 'recuperacao';

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where a.objetivo_id is null and o.chave = 'fonte_regua_recompra' and a.bloco = 'posvenda';

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where a.objetivo_id is null and o.chave = 'fonte_leads_proprios' and a.bloco = 'captacao';

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where a.objetivo_id is null and o.chave = 'fonte_mini_lancamentos' and a.bloco = 'mini_lancamento';

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where a.objetivo_id is null and o.chave = 'fonte_organico_parcerias' and a.bloco = 'canal';

-- Por titulo, onde o documento amarra sozinho e o bloco nao bastaria.
update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fonte_produto_fisico'
   and a.titulo in ('Degrau 1 do físico: cupom e comissão com os 46 fornecedores',
                    'Verificar se a Payt e o contador comportam produto físico no CNPJ atual',
                    'Degrau 2 do físico: Kit Primeira Fornada',
                    'Degrau 3 do físico: avaliar estoque próprio',
                    'Fornecedores de insumo viram parceiros de co-marketing');

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'roas_ofertas_refeitas'
   and a.titulo in ('Saponaria 2.0 — o curso',
                    'Saponaria 2.0 — a oferta "curso + kit em casa"',
                    'Saponaria 2.0 — nova VSL com ângulo de renda e presente',
                    'Workshop Buquê relançado para o Dia das Mães');

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fonte_organico_parcerias'
   and a.titulo in ('Coprodução com grandes produtoras de artesanato',
                    'Escalar o nicho de especialistas de outros nichos');

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'roas_cortar_abaixo_135'
   and a.titulo = 'Cortar o que está abaixo de 1,35x';

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fonte_recorrencia'
   and a.titulo in ('Handify Completo de volta no ar', 'Black Friday');

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fixo_juridico_com_teto'
   and a.titulo = 'Arrumar o financeiro';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_min   numeric;
  v_max   numeric;
  v_alvo  numeric;
begin
  -- 1. Dezesseis nos: a raiz, tres alavancas, seis fontes, quatro frentes de
  --    ROAS e duas de custo fixo.
  select count(*) into v_n from public.plano_objetivos;
  if v_n <> 16 then v_erros := v_erros || format('%s objetivos, esperava 16. ', v_n); end if;

  select count(*) into v_n from public.plano_objetivos where parte_de is null;
  if v_n <> 1 then v_erros := v_erros || format('%s raizes, esperava 1. ', v_n); end if;

  select count(*) into v_n from public.plano_objetivos o
   join public.plano_objetivos p on p.id = o.parte_de where p.chave = 'lucro_100k';
  if v_n <> 3 then v_erros := v_erros || format('%s alavancas, esperava 3. ', v_n); end if;

  select count(*) into v_n from public.plano_objetivos o
   join public.plano_objetivos p on p.id = o.parte_de where p.chave = 'alavanca_receita_propria';
  if v_n <> 6 then v_erros := v_erros || format('%s fontes de receita, esperava 6. ', v_n); end if;

  -- 2. A CONTA DO PLANO FECHA. As seis fontes somam entre R$ 85 mil e
  --    R$ 110 mil, e a meta da alavanca e R$ 100 mil — tem de cair dentro.
  --    E a unica prova aqui que pode reprovar por culpa do PLANO e nao do
  --    codigo, e e de proposito: se alguem repactuar uma fonte para menos e
  --    o total deixar de alcancar, a tela nao deve seguir prometendo.
  select sum(f.valor_min), sum(f.valor_max), max(p.valor_min)
    into v_min, v_max, v_alvo
    from public.plano_objetivos f
    join public.plano_objetivos p on p.id = f.parte_de
   where p.chave = 'alavanca_receita_propria';

  if v_min is null or v_max is null or v_alvo is null then
    v_erros := v_erros || 'faltou numero nas fontes ou na alavanca. ';
  elsif v_alvo < v_min or v_alvo > v_max then
    v_erros := v_erros || format(
      'as seis fontes somam de %s a %s, e a alavanca promete %s: a conta do plano nao fecha. ',
      v_min, v_max, v_alvo);
  end if;

  -- 3. Todo no com valor tem unidade, e nenhuma faixa esta invertida. As
  --    restricoes ja garantem; a prova pega quem afrouxar depois.
  select count(*) into v_n from public.plano_objetivos
   where (valor_min is not null or valor_max is not null) and unidade is null;
  if v_n > 0 then v_erros := v_erros || format('%s no(s) com valor sem unidade. ', v_n); end if;

  -- 4. Nenhum no em quarto nivel: a arvore do documento tem tres.
  select count(*) into v_n from public.plano_objetivos a
   join public.plano_objetivos b on b.id = a.parte_de
   join public.plano_objetivos c on c.id = b.parte_de
   where c.parte_de is not null;
  if v_n > 0 then v_erros := v_erros || format('%s no(s) em quarto nivel. ', v_n); end if;

  -- 5. Todo kpi citado existe, e nenhum no aponta para indicador de apoio:
  --    submeta se liga a meta, nao a contexto.
  select count(*) into v_n from public.plano_objetivos o
   where o.kpi is not null
     and not exists (select 1 from public.metas_kpi k where k.chave = o.kpi and k.e_meta);
  if v_n > 0 then
    v_erros := v_erros || format('%s objetivo(s) apontam para kpi inexistente ou de apoio. ', v_n);
  end if;

  -- 6. A maioria das acoes achou um dono. Nao exijo todas: ligacao errada e
  --    pior que ausente, e as que sobram aparecem na tela como tal.
  select count(*) into v_n from public.plano_acoes where objetivo_id is not null;
  if v_n < 55 then
    v_erros := v_erros || format('so %s de 80 acoes ligadas a um objetivo; esperava ao menos 55. ', v_n);
  end if;

  -- 7. Toda ligacao aponta para no que existe (a FK garante) E as acoes
  --    ligadas por titulo acharam mesmo o titulo. Se um nome mudar, o UPDATE
  --    casa zero linhas em silencio — e este e o unico jeito de perceber.
  select count(*) into v_n from public.plano_acoes a
   join public.plano_objetivos o on o.id = a.objetivo_id
   where o.chave = 'fonte_produto_fisico';
  if v_n <> 5 then
    v_erros := v_erros || format('%s acoes em produto fisico, esperava 5 (titulos mudaram?). ', v_n);
  end if;
  select count(*) into v_n from public.plano_acoes a
   join public.plano_objetivos o on o.id = a.objetivo_id
   where o.chave = 'roas_ofertas_refeitas';
  if v_n <> 4 then
    v_erros := v_erros || format('%s acoes em ofertas refeitas, esperava 4 (titulos mudaram?). ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % objetivos em 3 niveis; as seis fontes somam de % a % para uma meta de %; % de 80 acoes com dono, % sem.',
    (select count(*) from public.plano_objetivos),
    v_min, v_max, v_alvo,
    (select count(*) from public.plano_acoes where objetivo_id is not null),
    (select count(*) from public.plano_acoes where objetivo_id is null);
end $prova$;

notify pgrst, 'reload schema';
