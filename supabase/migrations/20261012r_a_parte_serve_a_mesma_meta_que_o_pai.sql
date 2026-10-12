-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A parte serve à mesma meta que o pai                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A migração anterior ligou 62 das 80 ações à árvore, e a conferência achou
-- uma incoerência que eu mesma criei: duas ações-pai ficaram SEM objetivo
-- enquanto as partes delas tinham um.
--
--     Turbinar a recuperação que já existe   (sem objetivo)
--       ├─ Sequência depois do link           → Pix recuperado
--       ├─ Mensagem do link com preço         → Pix recuperado
--       └─ Bump abandonado: curso por R$ 67   → Pix recuperado
--
--     Lina (IA) fora do horário              (sem objetivo)
--       └─ Tag de motivo no reembolso         → Pix recuperado
--
-- Isso não é só feio: uma parte não pode servir a uma meta que o todo não
-- serve. A tela mostraria "Pix recuperado: 4 ações" e, no bloco de ganhos
-- rápidos, as mesmas quatro penduradas num pai que não aparece em meta
-- nenhuma. Quem cruzasse os dois números acharia que uma das telas mente.
--
-- O conserto é o pai herdar das partes quando ele não tem e elas concordam —
-- essa direção, e não o contrário, porque a ligação das partes veio do bloco
-- `recuperacao` inteiro, que é a leitura mais informada das duas.
--
-- A regra vira PROVA: nenhuma parte pode ter objetivo diferente do pai.
--
-- ── E mais doze ações acharam dono ────────────────────────────────────────
--
-- Reler as dezoito que sobraram mostrou que a maioria tinha dono óbvio e eu
-- é que havia ligado só por bloco. As que o documento amarra sozinho:
--
--   · quatro são recuperação de Pix com outro nome (cartão recusado, fim de
--     semana, lembrete do dia do pagamento, confiança antes do Pix)
--   · "Não religar o Crossell em massa" o plano manda fazer "dentro da régua
--     da seção 5", que é a régua de recompra, escrito com essas palavras
--   · "Telefone obrigatório" o plano justifica com "todo o plano de pós-venda
--     depende disso", e o indicador dele é base_whatsapp — leads próprios
--   · "UTM em todos os links próprios" o plano fecha com "sem isso não dá
--     para medir o que este plano promete": é a medição da alavanca 1
--   · o Natal e a última chamada são mini lançamentos, e a seção 6 lista o
--     de novembro como tal, por escrito
--   · a lista VIP da Black Friday existe para vender o Completo anual, que
--     é recorrência
--
-- ── As quatro que continuam sem dono, de propósito ────────────────────────
--
-- "Regularizar a conta de anúncio Saponaria", "Checkout com total claro",
-- "Natal no tráfego frio" e "Cortar tráfego frio e virar para janeiro".
--
-- Cada uma dá para argumentar em duas direções, e nenhuma o documento amarra.
-- Ficam nulas e aparecem na tela como "sem objetivo": ligação errada é pior
-- que ausente, porque alguém acredita nela. Quatro perguntas abertas numa
-- tela valem mais que quatro respostas inventadas.

begin;

-- ── O pai herda das partes quando não tem objetivo e elas concordam ───────
update public.plano_acoes p
   set objetivo_id = concordam.objetivo_id
  from (
    -- `min(uuid)` nao existe no Postgres; o `having` ja garante que o array
    -- tem um elemento so, entao pegar o primeiro e pegar o unico.
    select f.parte_de, (array_agg(distinct f.objetivo_id))[1] as objetivo_id
      from public.plano_acoes f
     where f.parte_de is not null and f.objetivo_id is not null
     group by f.parte_de
    having count(distinct f.objetivo_id) = 1
  ) concordam
 where p.id = concordam.parte_de
   and p.objetivo_id is null;

-- ── As doze que o documento amarra ────────────────────────────────────────
update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'roas_pix_recuperado'
   and a.titulo in ('Cartão recusado vira Pix',
                    'Recuperação também no fim de semana',
                    'Botão "me lembra no dia do pagamento"',
                    'Confiança antes do Pix');

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fonte_regua_recompra'
   and a.titulo in ('Não religar o Crossell em massa',
                    'Bump entregue onde é usado');

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fonte_leads_proprios'
   and a.titulo = 'Telefone obrigatório no checkout e no primeiro acesso';

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'alavanca_receita_propria'
   and a.titulo = 'UTM em todos os links próprios';

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fonte_mini_lancamentos'
   and a.titulo in ('Gravar as 6 aulas de Natal, página TSL e 10 criativos',
                    'Mini lançamento do Natal para a base',
                    '"Ainda dá tempo de produzir para o Natal"');

update public.plano_acoes a set objetivo_id = o.id
  from public.plano_objetivos o
 where o.chave = 'fonte_recorrencia'
   and a.titulo = 'Captação da lista VIP da Black Friday';

-- O pai pode ter ganho objetivo agora; as partes seguem o pai, sempre.
update public.plano_acoes f
   set objetivo_id = p.objetivo_id
  from public.plano_acoes p
 where f.parte_de = p.id
   and f.objetivo_id is distinct from p.objetivo_id;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_lista text;
begin
  -- 1. A REGRA: nenhuma parte serve a uma meta diferente da do pai. Era o
  --    defeito que esta migracao veio corrigir, e e o unico estado que a
  --    arvore nao pode ter sem fazer duas telas se contradizerem.
  select count(*), string_agg(f.titulo, ' · ')
    into v_n, v_lista
    from public.plano_acoes f
    join public.plano_acoes p on p.id = f.parte_de
   where f.objetivo_id is distinct from p.objetivo_id;
  if v_n > 0 then
    v_erros := v_erros || format('%s parte(s) com objetivo diferente do pai: %s. ', v_n, v_lista);
  end if;

  -- 2. Sobraram exatamente as quatro ambiguas, e sao essas quatro. Se o
  --    numero mudar, ou alguem ligou no escuro ou uma acao nova entrou sem
  --    dono — os dois merecem olhar.
  select count(*) into v_n from public.plano_acoes where objetivo_id is null;
  if v_n <> 4 then
    select string_agg(titulo, ' · ') into v_lista
      from public.plano_acoes where objetivo_id is null;
    v_erros := v_erros || format('%s acao(oes) sem objetivo, esperava 4. Sao: %s. ', v_n, v_lista);
  end if;

  select count(*) into v_n from public.plano_acoes
   where objetivo_id is null
     and titulo in ('Regularizar a conta de anúncio "Saponaria"',
                    'Checkout com total claro',
                    'Natal no tráfego frio',
                    'Cortar tráfego frio e virar para janeiro');
  if v_n <> 4 then
    v_erros := v_erros || format('as 4 sem objetivo nao sao as 4 esperadas (achei %s delas). ', v_n);
  end if;

  -- 3. Toda acao ligada aponta para no existente, e nenhuma aponta para a
  --    raiz: acao serve a uma alavanca ou a uma submeta, nunca ao objetivo
  --    inteiro — senao a arvore nao serviria para nada.
  select count(*) into v_n from public.plano_acoes a
   join public.plano_objetivos o on o.id = a.objetivo_id
   where o.parte_de is null;
  if v_n > 0 then
    v_erros := v_erros || format('%s acao(oes) penduradas na raiz. ', v_n);
  end if;

  -- 4. Cada uma das SEIS FONTES da alavanca 1 tem kpi ou acao. Elas sao as
  --    que carregam numero em R$ e somam os R$ 100 mil; uma fonte sem nada
  --    atras seria promessa sem trabalho.
  --
  --    A regra vale so para as seis de proposito. "Retirada de socios
  --    atrelada a margem" fica sem kpi e sem acao, e isso e um FATO do
  --    plano, nao um defeito meu: o documento cita a alavanca e nao a
  --    desdobra em tarefa nenhuma. A tela mostra o vazio; reprovar aqui me
  --    obrigaria a inventar uma acao para calar o teste.
  select count(*), string_agg(o.titulo, ' · ')
    into v_n, v_lista
    from public.plano_objetivos o
    join public.plano_objetivos p on p.id = o.parte_de
   where p.chave = 'alavanca_receita_propria'
     and o.kpi is null
     and not exists (select 1 from public.plano_acoes a where a.objetivo_id = o.id);
  if v_n > 0 then
    v_erros := v_erros || format('%s fonte(s) de receita sem kpi e sem acao: %s. ', v_n, v_lista);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: % de 80 acoes com dono, % sem; nenhuma parte discorda do pai.',
    (select count(*) from public.plano_acoes where objetivo_id is not null),
    (select count(*) from public.plano_acoes where objetivo_id is null);
end $prova$;

notify pgrst, 'reload schema';
