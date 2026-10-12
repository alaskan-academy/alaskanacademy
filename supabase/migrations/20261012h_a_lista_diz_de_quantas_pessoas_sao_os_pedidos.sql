-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A lista diz de quantas PESSOAS são os pedidos                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Com a importação de 12/10 (`20261012g`) o CPF passou de 32,8% para 93,6% da
-- base. Isso permite, pela primeira vez, contar PESSOA em vez de linha de
-- cliente — a mesma aluna que comprou com dois e-mails virava duas.
--
-- Medido antes de escrever: 10.518 compradores pela chave de hoje, 10.455 por
-- CPF. São 63 pessoas duplicadas, 0,6%. É pouco, e é o número honesto — a
-- hipótese de que "muitas alunas compram com e-mails diferentes" não se
-- confirma no tamanho que a frase sugere. A recompra sobe de 11,52% para
-- 11,89% e o LTV médio de R$ 94,43 para R$ 95,00.
--
-- ── Por que uma FUNÇÃO, e não uma view ──────────────────────────────────
--
-- Esta é a parte que não é óbvia e que decidiu o desenho inteiro.
--
-- `20261012d` revogou o SELECT da coluna `cpf` **do papel Postgres
-- `authenticated`** — não é RLS, é privilégio de coluna. E o CLAUDE.md obriga
-- toda view nova a nascer `with (security_invoker = on)`, com um teste que lê
-- as migrações para garantir (`src/test/view-nova-nao-fura-a-rls.test.ts`).
--
-- View `security_invoker` roda com os direitos de QUEM CONSULTA. Logo, uma
-- view que tocasse `clientes.cpf` devolveria `permission denied for column
-- cpf` para TODO usuário do painel — **inclusive o admin**, porque
-- `is_current_user_admin()` é checagem de perfil da aplicação e não concede
-- privilégio de coluna. Não existe view legal que conte por CPF. A saída de
-- desligar o invoker é pior: foi exatamente o que `20260925a` fechou em 40
-- views, depois de `vw_clientes_listagem` devolver nome, e-mail e telefone de
-- 12.590 pessoas para `anon`.
--
-- Então: função `SECURITY DEFINER`, no mesmo molde de `fn_cpf_do_cliente`. Ela
-- lê o CPF por dentro e devolve **um número**. O documento não atravessa a
-- fronteira.
--
-- ── Por que ela recebe uma LISTA DE IDS, e não os filtros ───────────────
--
-- O caminho preguiçoso seria dar a `fn_pessoas_distintas` os mesmos
-- parâmetros de período, contas, empresa e status, e deixá-la filtrar
-- sozinha. Isso seria a **primeira armadilha** do CLAUDE.md em estado puro:
-- duas definições do mesmo recorte, que divergem no dia em que alguém mexer
-- numa só — e ninguém na tela saberia qual das duas está certa.
--
-- Em vez disso ela recebe os `cliente_id` que a `fn_vendas_lista` JÁ filtrou.
-- Existe um recorte só, no lugar de sempre, e o ajudante nem sabe que
-- período é.
--
-- ── O que ela expõe, dito na cara ───────────────────────────────────────
--
-- Quem puder chamá-la com dois ids e ler "1" aprende que aquelas duas contas
-- são a mesma pessoa. Isso é um vazamento de RELAÇÃO, e é aceito de propósito:
-- quem está logado já lê nome, e-mail e telefone das duas linhas, que é muito
-- mais do que "são a mesma". O que NÃO sai em hipótese alguma é o documento.
--
-- ── Quem fica sem CPF conta como si mesmo ───────────────────────────────
--
-- `count(distinct cpf)` ignora NULL, e isso faria os 867 clientes sem CPF
-- SUMIREM da conta em vez de contarem. O `coalesce` para `'id:' || id` faz
-- cada desconhecido valer por uma pessoa. Se duas dessas forem a mesma, a
-- conta erra para MAIS — e errar para mais, aqui, é o lado certo de errar:
-- nunca diz que há menos gente do que há.

begin;

-- Retrato de antes, para a prova comparar contra ele e não contra número
-- escrito à mão.
drop table if exists _antes_pessoas;
create temp table _antes_pessoas as
select (select count(*) from public.vendas)                     as vendas,
       (select count(distinct cliente_id) from public.vendas
         where status = 'aprovada')                              as compradores_por_linha;

-- ── O ajudante ───────────────────────────────────────────────────────────
create or replace function public.fn_pessoas_distintas(p_clientes uuid[])
 returns bigint
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- Uma pessoa é um CPF. Quem não tem CPF é uma pessoa também, contada pela
  -- propria linha — nunca somem da conta por serem desconhecidos.
  select count(distinct coalesce(nullif(btrim(c.cpf), ''), 'id:' || c.id::text))
    from clientes c
   where c.id = any(p_clientes);
$function$;

comment on function public.fn_pessoas_distintas(uuid[]) is
  'Quantas PESSOAS sao estes clientes, agrupando por CPF. SECURITY DEFINER '
  'porque clientes.cpf tem o SELECT revogado de authenticated (20261012d) e '
  'nenhuma view security_invoker conseguiria ler a coluna. Devolve so a '
  'contagem: o documento nao sai daqui. Recebe os ids JA filtrados por quem '
  'chama, para nao existir um segundo lugar definindo o mesmo recorte.';

-- ── A tranca, e a lição que a prova desta migração deu ───────────────────
--
-- Fechar isto exige revogar de PUBLIC **e** de `anon`, nominalmente. Os dois,
-- porque são dois caminhos independentes:
--   • `anon` é membro de PUBLIC, então um `=X/postgres` solto já basta para
--     ele executar — revogar só de `anon` não adianta;
--   • e o Supabase, por `ALTER DEFAULT PRIVILEGES`, concede `anon=X` NOMINAL
--     a toda função nova de `public` — então revogar só de PUBLIC também não
--     adianta.
--
-- A primeira versão desta migração revogou só de PUBLIC, e a prova reprovou
-- com `anon consegue executar fn_pessoas_distintas`. É o mesmo erro de ACL
-- que `20261012d` descobriu na COLUNA (grant de tabela cobrindo o revoke de
-- coluna), agora na função — e descoberto do mesmo jeito, por uma prova que
-- conferiu em vez de confiar.
revoke all on function public.fn_pessoas_distintas(uuid[]) from public, anon;
grant execute on function public.fn_pessoas_distintas(uuid[]) to authenticated, service_role;

-- ── E o conserto da mesma falha em `fn_cpf_do_cliente` ───────────────────
--
-- Achado ao conferir a ACL desta migração: `20261012d` escreveu
-- `revoke execute on function public.fn_cpf_do_cliente(uuid) from anon`, e
-- isso NÃO teve efeito — a ACL ficou `=X/postgres` (PUBLIC intacto) e
-- `has_function_privilege('anon', ...)` devolvia true.
--
-- O estrago real era pequeno, e vale dizer por quê: a função confere
-- `is_current_user_admin()` ANTES de ler qualquer coisa, então `anon` chamando
-- recebia exceção, nunca um CPF. A porta de dentro segurou. Mas a tranca de
-- fora, que a migração achava ter fechado, estava aberta — e uma defesa que
-- se acredita existir e não existe é pior que uma que se sabe não ter.
revoke all on function public.fn_cpf_do_cliente(uuid) from public, anon;
grant execute on function public.fn_cpf_do_cliente(uuid) to authenticated, service_role;

-- ── A lista passa a dizer de quantas pessoas ─────────────────────────────
-- Definicao reemitida inteira a partir de pg_get_functiondef: as unicas
-- mudancas sao `v.cliente_id` em `todas` e `'pessoas'` no resumo.
CREATE OR REPLACE FUNCTION public.fn_vendas_lista(
  p_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_fim timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_contas uuid[] DEFAULT NULL::uuid[],
  p_status text DEFAULT NULL::text,
  p_busca text DEFAULT NULL::text,
  p_pagina integer DEFAULT 0,
  p_tamanho integer DEFAULT 50,
  p_empresa uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  WITH termo AS (SELECT nullif(btrim(coalesce(p_busca, '')), '') AS t),
  -- O período e as contas, sem status e sem busca: é a base do percentual.
  todas AS (
    SELECT v.id, v.pedido_id, v.data_venda,
           v.cliente_id,
           v.produto::text        AS produto,
           v.produto_nome,
           /* Liquido, como o resto do painel: sem juros e sem coproducao.
              Ver 20260905d e 20261006o. */
           coalesce(v.valor_sem_juros, v.valor_total)
             - coalesce(v.valor_coproducao, 0) AS valor_total,
           v.status::text         AS status,
           v.meio_pagamento::text AS meio_pagamento,
           v.utm_source, v.utm_placement,
           coalesce(v.is_upsell, false) AS is_upsell,
           c.nome AS cliente_nome, c.email AS cliente_email, c.telefone AS cliente_telefone
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.pedido_id NOT LIKE 'TEST%'
       AND v.pedido_id NOT LIKE 'LC-%'
       AND (p_inicio IS NULL OR v.data_venda >= p_inicio)
       AND (p_fim    IS NULL OR v.data_venda <= p_fim)
       AND (p_contas IS NULL OR cardinality(p_contas) = 0
            OR v.ad_account_id = ANY(p_contas))
       AND (p_empresa IS NULL OR v.empresa_id = p_empresa)
  ),
  filtradas AS (
    SELECT todas.* FROM todas CROSS JOIN termo
     WHERE (p_status IS NULL OR p_status = 'todos' OR todas.status = p_status)
       AND (termo.t IS NULL
            OR todas.pedido_id ILIKE '%' || termo.t || '%'
            OR coalesce(todas.cliente_email, '') ILIKE '%' || termo.t || '%'
            OR public.unaccent(coalesce(todas.cliente_nome, ''))
                 ILIKE public.unaccent('%' || termo.t || '%')
            OR public.unaccent(coalesce(todas.produto_nome, ''))
                 ILIKE public.unaccent('%' || termo.t || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtradas),
    'resumo', jsonb_build_object(
      'quantidade',   (SELECT count(*) FROM filtradas),
      'valor',        coalesce((SELECT sum(valor_total) FROM filtradas), 0),
      'base_periodo', (SELECT count(*) FROM todas),
      /* De quantas PESSOAS sao estes pedidos. Vai nos `cliente_id` que esta
         mesma consulta acabou de filtrar — nao ha segundo recorte. */
      'pessoas',      public.fn_pessoas_distintas(
                        array(SELECT DISTINCT cliente_id FROM filtradas
                               WHERE cliente_id IS NOT NULL))
    ),
    'linhas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', id, 'pedido_id', pedido_id, 'data_venda', data_venda,
               'produto', produto, 'produto_nome', produto_nome,
               'valor_total', valor_total, 'status', status,
               'meio_pagamento', meio_pagamento,
               'utm_source', utm_source, 'utm_placement', utm_placement,
               'is_upsell', is_upsell,
               'clientes', jsonb_build_object(
                 'nome', cliente_nome, 'email', cliente_email, 'telefone', cliente_telefone)
             ) ORDER BY data_venda DESC)
        FROM (SELECT * FROM filtradas
               ORDER BY data_venda DESC
              OFFSET greatest(coalesce(p_pagina, 0), 0) * greatest(coalesce(p_tamanho, 50), 1)
               LIMIT greatest(coalesce(p_tamanho, 50), 1)) pagina
    ), '[]'::jsonb)
  );
$function$;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     bigint;
  v_m     bigint;
  v_j     jsonb;
begin
  -- 1. O ajudante e DEFINER com search_path fixo. Sem o search_path, uma
  --    funcao definer e um buraco: quem chama escolhe de qual schema vem
  --    `clientes`.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'fn_pessoas_distintas'
                    and p.prosecdef
                    and p.proconfig::text like '%search_path%') then
    v_erros := v_erros || 'fn_pessoas_distintas nao e security definer com search_path. ';
  end if;

  -- 2. Ela devolve NUMERO, nao texto. Se um dia alguem a fizer devolver o CPF
  --    "so para depurar", este caso reprova antes de chegar em producao.
  if (select pg_catalog.format_type(p.prorettype, null)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'fn_pessoas_distintas') <> 'bigint' then
    v_erros := v_erros || 'fn_pessoas_distintas deixou de devolver bigint. ';
  end if;

  -- 3. `anon` NAO executa. Este caso ja reprovou a primeira versao desta
  --    migracao, que revogou so de PUBLIC e esqueceu o grant nominal que o
  --    Supabase da a anon por default privileges.
  if has_function_privilege('anon', 'public.fn_pessoas_distintas(uuid[])', 'EXECUTE') then
    v_erros := v_erros || 'anon consegue executar fn_pessoas_distintas. ';
  end if;
  -- ... e `authenticated` executa, senao a lista quebra para todo mundo.
  if not has_function_privilege('authenticated', 'public.fn_pessoas_distintas(uuid[])', 'EXECUTE') then
    v_erros := v_erros || 'authenticated NAO executa fn_pessoas_distintas: /vendas quebraria. ';
  end if;

  -- 3b. A MESMA tranca em fn_cpf_do_cliente, que 20261012d achou ter fechado
  --     e nao fechou. Se este caso falhar de novo, a unica porta para o CPF
  --     voltou a aceitar chamada anonima.
  if has_function_privilege('anon', 'public.fn_cpf_do_cliente(uuid)', 'EXECUTE') then
    v_erros := v_erros || 'anon ainda executa fn_cpf_do_cliente. ';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_cpf_do_cliente(uuid)', 'EXECUTE') then
    v_erros := v_erros || 'authenticated perdeu fn_cpf_do_cliente: o admin nao le mais CPF. ';
  end if;

  -- 4. A FECHADURA de 20261012d continua de pe depois de tudo isto.
  if has_column_privilege('authenticated', 'public.clientes', 'cpf', 'SELECT') then
    v_erros := v_erros || 'authenticated voltou a ler a coluna cpf. ';
  end if;
  if has_column_privilege('anon', 'public.clientes', 'cpf', 'SELECT') then
    v_erros := v_erros || 'anon voltou a ler a coluna cpf. ';
  end if;

  -- 5. A conta esta certa: por pessoa tem de dar MENOS que por linha de
  --    cliente, e a diferenca e justamente a duplicata que o CPF revelou.
  select public.fn_pessoas_distintas(
           array(select distinct cliente_id from public.vendas
                  where status = 'aprovada' and cliente_id is not null))
    into v_n;
  v_m := (select compradores_por_linha from _antes_pessoas);
  if v_n > v_m then
    v_erros := v_erros || format('por pessoa (%s) deu MAIS que por linha (%s). ', v_n, v_m);
  end if;
  if v_m - v_n < 20 or v_m - v_n > 400 then
    v_erros := v_erros || format(
      'a deduplicacao colapsou %s linhas; eram 63 em 12/10. Fora da faixa 20..400 '
      'alguem mexeu no CPF em massa. ', v_m - v_n);
  end if;

  -- 6. Ninguem que nao tem CPF sumiu da conta. Com `count(distinct cpf)` puro
  --    os 867 sem documento desapareceriam; este caso e o que pega isso.
  select public.fn_pessoas_distintas(array(select id from public.clientes where cpf is null))
    into v_n;
  select count(*) into v_m from public.clientes where cpf is null;
  if v_n <> v_m then
    v_erros := v_erros || format(
      'os %s clientes sem CPF viraram %s pessoas: o coalesce para id quebrou. ', v_m, v_n);
  end if;

  -- 7. A lista nao quebrou e passou a devolver `pessoas`, que nunca pode ser
  --    maior que a quantidade de pedidos.
  select public.fn_vendas_lista(null, null, null, 'aprovada', null, 0, 1, null) into v_j;
  if v_j -> 'resumo' ->> 'pessoas' is null then
    v_erros := v_erros || 'fn_vendas_lista nao devolveu resumo.pessoas. ';
  elsif (v_j -> 'resumo' ->> 'pessoas')::bigint > (v_j -> 'resumo' ->> 'quantidade')::bigint then
    v_erros := v_erros || 'resumo.pessoas ficou MAIOR que resumo.quantidade. ';
  end if;
  if jsonb_array_length(v_j -> 'linhas') <> 1 then
    v_erros := v_erros || 'fn_vendas_lista parou de paginar. ';
  end if;
  if v_j -> 'linhas' -> 0 -> 'clientes' ->> 'nome' is null
     and (v_j -> 'linhas' -> 0 -> 'clientes') is null then
    v_erros := v_erros || 'fn_vendas_lista parou de devolver o objeto clientes. ';
  end if;

  -- 8. Nenhuma venda foi criada nem apagada: isto le, nao escreve.
  select count(*) into v_n from public.vendas;
  if v_n <> (select vendas from _antes_pessoas) then
    v_erros := v_erros || 'a contagem de vendas mudou. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: fn_pessoas_distintas e definer, devolve bigint, nega anon, '
               'nao reabriu o cpf, conta quem nao tem CPF, e a lista agora diz de '
               'quantas pessoas sao os pedidos.';
end $prova$;

drop table if exists _antes_pessoas;

notify pgrst, 'reload schema';
