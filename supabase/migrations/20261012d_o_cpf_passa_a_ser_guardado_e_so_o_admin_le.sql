-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O CPF passa a ser guardado, e só o admin lê                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Decidido por ela em 12/10/2026: o CPF fica **em `clientes`**, não numa tabela
-- à parte, **cru** (sem hash, como a própria Payt guarda), e a proteção vem de
-- a tabela ser de verdade restrita no Supabase.
--
-- ── Por que isso precisava existir ──────────────────────────────────────
--
-- `fn_resolver_cliente` casa cliente **por e-mail** e insere com e-mail, nome e
-- telefone. O CPF nunca foi lido: o `payt-webhook` pega `customer.name` e
-- `customer.email` e ignora `customer.doc`. Resultado medido:
--
--   clientes ............................ 13.650
--   com `cpf_hash` (importação antiga) ... 2.388  (17,5%)
--   criados desde ago/2026 com CPF ....... 0      de 10.161
--
-- E o dado CHEGA. Nos 11.899 corpos crus de `payt_webhook_raw`, a chave `doc`
-- existe em 100% e está preenchida em todo status que representa uma compra
-- de verdade:
--
--   paid 3.628 (100%) · waiting_payment 3.311 (100%) · canceled 1.361 (100%)
--   expired 856 (100%) · refund_requested 65 (100%) · chargeback 2 (100%)
--   lost_cart 2.676 .... 4%   <- carrinho abandonado, ninguém preencheu nada
--
-- Ou seja: toda pessoa que chega ao checkout informa o CPF, e o painel jogava
-- fora. Ela apontou isso ("toda aluna é obrigada a pôr CPF para comprar") e
-- estava certa — o meu primeiro número, 78,4%, estava diluído pelos carrinhos
-- abandonados.
--
-- ── A proteção é na COLUNA, não na tabela ───────────────────────────────
--
-- `clientes` tinha política `authenticated` com condição `true`: qualquer
-- pessoa logada lia todas as linhas, inclusive editor e copywriter.
--
-- Trancar a tabela inteira para admin seria exagero e cobraria depois — nome e
-- e-mail são dados de trabalho. O que se revoga aqui é o SELECT **da coluna
-- `cpf`**, de `authenticated` e de `anon`. O PostgREST respeita privilégio de
-- coluna: pedir `cpf` pela API passa a dar erro de permissão, para qualquer
-- usuário do app, admin incluído.
--
-- Quem precisa ler o CPF lê por `fn_cpf_do_cliente`, que é SECURITY DEFINER e
-- confere `is_current_user_admin()`. Uma porta, com fechadura, auditável.
--
-- Isso só é seguro de fazer porque NADA lê `clientes` hoje: zero ocorrências de
-- `from('clientes')` no `src/`, e zero views que a referenciam. Conferido antes
-- de mexer — é a verificação que o CLAUDE.md da raiz exige antes de mudar
-- acesso.
--
-- ── Sem UNIQUE, de propósito ────────────────────────────────────────────
--
-- Duas linhas de cliente com o mesmo CPF são exatamente o que ela quer
-- ENCONTRAR — a mesma aluna comprando com e-mails diferentes. Um UNIQUE aqui
-- recusaria o backfill e esconderia o problema em vez de mostrá-lo. A coluna
-- nasce livre, e a duplicidade vira número na tela.
--
-- A `cpf_hash` antiga fica onde está, e MORTA. São 8 hex — 32 bits — com
-- UNIQUE: com 13.650 clientes a chance de duas pessoas colidirem já é ~2%, e
-- uma colisão recusaria o cadastro de um cliente real. Nada escreve nela hoje.
-- Testei doze algoritmos contra os 62 pares verificáveis (md5, sha1, sha224,
-- sha256, hashtext, com e sem pontuação, fatias diferentes): nenhum casou. Veio
-- da importação original com sal ou método que não está no repositório, e por
-- isso não dá para continuá-la — tentar seria criar duas gerações de hash na
-- mesma coluna UNIQUE.
--
-- ── O que este backfill alcança, e o que não alcança ────────────────────
--
-- `payt_webhook_raw` não vai longe o bastante no tempo: só **4.089 dos 13.650**
-- clientes (30%) têm um `doc` recuperável por aqui. Os outros 70% vêm da
-- exportação da Payt, que ela vai providenciar — e aí entra por outro arquivo.
--
-- Por isso LTV e recompra **continuam na chave atual** (cliente por e-mail) até
-- a cobertura justificar a troca. Deduplicar sobre 30% seria pior que não
-- deduplicar: trocaria um número impreciso por um número errado.

begin;

-- Quantos eram ANTES. `clientes` e tabela viva — ela ganhou uma linha entre
-- duas consultas minhas hoje —, entao a prova compara contra o retrato e nao
-- contra um numero escrito a mao, que falharia sozinho no proximo cliente.
drop table if exists _antes_clientes;
create temp table _antes_clientes as
select count(*) as linhas from public.clientes;

alter table public.clientes
  add column if not exists cpf text;

comment on column public.clientes.cpf is
  'CPF em digitos, sem pontuacao e SEM hash — decidido em 12/10/2026, porque a '
  'propria Payt o guarda assim e o painel so precisa dele para saber que duas '
  'linhas sao a mesma pessoa. O SELECT desta coluna e REVOGADO de authenticated '
  'e anon: quem precisa ler usa fn_cpf_do_cliente, que confere admin. Sem '
  'UNIQUE de proposito — CPF repetido e o que se quer encontrar, nao o que se '
  'quer recusar.';

-- ── A fechadura ──────────────────────────────────────────────────────────
--
-- A primeira tentativa desta migracao fez `revoke select (cpf) ... from
-- authenticated` e a prova reprovou: o privilegio continuava la. O motivo e
-- que `authenticated` tem `SELECT` na TABELA inteira, e revoke de coluna nao
-- desfaz grant de tabela — o grant largo cobre toda coluna, inclusive as que
-- nascerem depois.
--
-- O jeito certo e tirar o SELECT da tabela e devolver coluna a coluna, menos a
-- do CPF. A lista e montada do `information_schema` em vez de escrita a mao:
-- escrever as colunas aqui seria lista fixa envelhecendo em silencio.
--
-- Efeito colateral que e desejado: coluna NOVA em `clientes` nasce sem SELECT
-- para `authenticated` ate alguem conceder. Falha fechada e barulhenta —
-- quem adicionar a coluna recebe erro de permissao na hora — em vez de falha
-- aberta e silenciosa, que e o que acontece hoje.
revoke select on public.clientes from authenticated;
revoke select on public.clientes from anon;

do $fechadura$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clientes'
     and column_name <> 'cpf';
  execute format('grant select (%s) on public.clientes to authenticated', v_cols);
end $fechadura$;

-- `anon` nao volta a ler nada: a RLS ja o bloqueia (nao ha politica para ele),
-- e o grant largo era so uma porta a mais sem fechadura atras.

create or replace function public.fn_cpf_do_cliente(p_cliente_id uuid)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_cpf text;
begin
  -- A unica porta para o CPF. SECURITY DEFINER para poder ler a coluna
  -- revogada, e por isso a conferencia de admin vem ANTES de qualquer leitura.
  if not public.is_current_user_admin() then
    raise exception 'Sem permissao para ler CPF.' using errcode = '42501';
  end if;

  select cpf into v_cpf from public.clientes where id = p_cliente_id;
  return v_cpf;
end;
$function$;

comment on function public.fn_cpf_do_cliente(uuid) is
  'A unica porta para o CPF de um cliente. SECURITY DEFINER porque a coluna tem '
  'o SELECT revogado de authenticated; a conferencia de admin vem antes da '
  'leitura, nao depois.';

revoke execute on function public.fn_cpf_do_cliente(uuid) from anon;

-- ── O passado que da para recuperar ──────────────────────────────────────
-- Casando por e-mail, que e a chave que `fn_resolver_cliente` ja usa. O
-- `min()` escolhe de forma estavel quando a mesma pessoa aparece em varios
-- webhooks — e so ha um CPF por e-mail na pratica.
with doc_por_email as (
  select lower(trim(body->'customer'->>'email')) as email,
         min(regexp_replace(body->'customer'->>'doc', '\D', '', 'g')) as cpf
    from public.payt_webhook_raw
   where nullif(body->'customer'->>'doc', '') is not null
     and nullif(body->'customer'->>'email', '') is not null
   group by 1
)
update public.clientes c
   set cpf = d.cpf, atualizado_em = now()
  from doc_por_email d
 where lower(trim(c.email)) = d.email
   and c.cpf is null
   and d.cpf <> ''
   and length(d.cpf) between 11 and 14;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
begin
  -- 1. A coluna existe.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='clientes'
                    and column_name='cpf') then
    v_erros := v_erros || 'a coluna cpf nao ficou em clientes. ';
  end if;

  -- 2. A FECHADURA. Se este caso falhar, o CPF esta exposto a qualquer pessoa
  --    logada, e e o unico motivo pelo qual guardar cru e aceitavel.
  if has_column_privilege('authenticated', 'public.clientes', 'cpf', 'SELECT') then
    v_erros := v_erros || 'authenticated AINDA le a coluna cpf. ';
  end if;
  if has_column_privilege('anon', 'public.clientes', 'cpf', 'SELECT') then
    v_erros := v_erros || 'anon AINDA le a coluna cpf. ';
  end if;

  -- 3. E o resto da tabela continua legivel: a protecao e da coluna, nao da
  --    tabela. Se isto falhar, eu tranquei mais do que devia.
  if not has_column_privilege('authenticated', 'public.clientes', 'email', 'SELECT') then
    v_erros := v_erros || 'authenticated perdeu o acesso ao email: tranquei demais. ';
  end if;

  -- 4. A porta existe e nega quem nao e admin. Chamo como estou (service_role,
  --    que nao e admin pela tabela de perfis) e espero o erro.
  begin
    perform public.fn_cpf_do_cliente((select id from public.clientes limit 1));
    v_erros := v_erros || 'fn_cpf_do_cliente devolveu CPF sem conferir admin. ';
  exception
    when insufficient_privilege then null;  -- era o esperado
    when others then null;                  -- sem admin logado no contexto da migracao
  end;

  -- 5. O backfill pegou o que dava. Medido antes: 4.089 alcancaveis.
  select count(*) into v_n from public.clientes where cpf is not null;
  if v_n < 3900 then
    v_erros := v_erros || format('so %s clientes ficaram com CPF, esperava ~4.089. ', v_n);
  end if;

  -- 6. E so digito entrou. CPF com pontuacao nao casa com a exportacao da Payt
  --    depois, e o erro so apareceria la na frente.
  select count(*) into v_n from public.clientes
   where cpf is not null and cpf !~ '^[0-9]{11,14}$';
  if v_n > 0 then
    v_erros := v_erros || format('%s CPF(s) gravados fora do formato de digitos. ', v_n);
  end if;

  -- 7. Nenhum cliente foi criado nem apagado: isto preenche coluna, nao mexe em
  --    gente. Contra o retrato, nao contra numero escrito a mao.
  select count(*) into v_n from public.clientes;
  if v_n <> (select linhas from _antes_clientes) then
    v_erros := v_erros || format('clientes tem %s linhas, o retrato dizia %s. ',
                                 v_n, (select linhas from _antes_clientes));
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(*) into v_n from public.clientes where cpf is not null;
  raise notice 'PROVA OK: % clientes com CPF, so digitos, coluna revogada de authenticated e anon, e o resto da tabela intacto.', v_n;
end $prova$;

notify pgrst, 'reload schema';
