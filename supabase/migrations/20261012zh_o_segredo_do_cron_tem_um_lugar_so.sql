-- O segredo do cron tem um lugar so
-- ============================================================================
--
-- A `membros-metricas` nasceu pedindo tres segredos para ela configurar a
-- mao. Dois podiam sair, e vale dizer por que cada um.
--
-- -- MEMBROS_SUPABASE_URL nao era segredo ----------------------------------
--
-- E a URL publica do projeto da Area de Membros: esta no bundle do app dela,
-- no `NEXT_PUBLIC_SUPABASE_URL`, e em toda requisicao que qualquer navegador
-- faz. Guardar no cofre o que ja esta na rua nao protege nada e cria mais um
-- lugar para alguem esquecer de preencher. Virou valor padrao no codigo da
-- funcao, com `MEMBROS_SUPABASE_URL` ainda funcionando como sobreposicao se
-- um dia o projeto mudar.
--
-- -- MEMBROS_SYNC_SECRET existia DUAS vezes --------------------------------
--
-- Este e o mais interessante, porque era a primeira armadilha do CLAUDE.md
-- disfarçada de configuracao: o mesmo segredo no vault (de onde o cron o le)
-- e nos segredos da funcao (contra o que ela compara). Dois campos dizendo a
-- mesma coisa sempre divergem -- e aqui a divergencia seria especialmente
-- chata, porque rotacionar um e esquecer o outro da 401 todo dia as 4h20,
-- sem nada na tela, e a causa nao e obvia nem para quem escreveu.
--
-- Agora ha um lugar so: o vault. A funcao pergunta ao banco qual e o segredo
-- esperado, em vez de carregar uma copia.
--
-- -- Por que uma funcao, e nao ler o vault direto --------------------------
--
-- O schema `vault` nao e exposto pelo PostgREST, entao a Edge Function nao
-- alcanca `vault.decrypted_secrets` nem com a service_role do painel.
--
-- O caminho obvio seria `fn_segredo(p_nome text)`, generico. Nao: quem tiver
-- a service_role do painel passaria a poder ler QUALQUER segredo do cofre
-- pelo nome -- as chaves da Conta Simples, o token da Meta, a da Payt. Uma
-- funcao generica transforma o vazamento de uma chave no vazamento de todas.
--
-- Esta funcao le UM segredo, com o nome escrito nela, e nao aceita parametro.
-- Quem a chamar consegue exatamente o que ela existe para dar.
--
-- E ela e revogada de `authenticated` tambem, nao so de `anon`: o painel
-- inteiro roda como `authenticated`, e nenhuma tela tem motivo para saber o
-- segredo do cron.

create or replace function public.fn_segredo_membros_cron()
returns text
language sql
stable
security definer
set search_path to 'vault', 'public', 'pg_temp'
as $function$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'membros_sync_secret';
$function$;

comment on function public.fn_segredo_membros_cron() is
  'Devolve o segredo compartilhado entre o cron membros-metricas-diario e a Edge Function membros-metricas. Um segredo so, com o nome fixo na funcao: generica, ela transformaria o vazamento da service_role no vazamento do cofre inteiro. So service_role executa. Ver 20261012zh.';

revoke all on function public.fn_segredo_membros_cron() from public, anon, authenticated;
grant execute on function public.fn_segredo_membros_cron() to service_role;

-- -- As provas ---------------------------------------------------------------
do $prova$
declare
  v_segredo text;
  v_quem    text;
begin
  ---------------------------------------------------------------------------
  -- 1. O segredo existe e a funcao o alcanca. Sem isto, a funcao responderia
  --    nulo e a comparacao com o cabecalho passaria a recusar tudo.
  ---------------------------------------------------------------------------
  select fn_segredo_membros_cron() into v_segredo;
  if v_segredo is null or length(v_segredo) < 32 then
    raise exception 'fn_segredo_membros_cron devolveu % -- o vault nao tem membros_sync_secret?',
                    coalesce('algo com ' || length(v_segredo) || ' caracteres', 'nulo');
  end if;

  ---------------------------------------------------------------------------
  -- 2. E o cron manda EXATAMENTE o mesmo valor. Esta e a prova que a
  --    duplicacao anterior nao tinha como ter: as duas pontas lendo a mesma
  --    linha do cofre.
  ---------------------------------------------------------------------------
  if (select decrypted_secret from vault.decrypted_secrets
       where name = 'membros_sync_secret') is distinct from v_segredo then
    raise exception 'o cron e a funcao leriam valores diferentes';
  end if;

  ---------------------------------------------------------------------------
  -- 3. Ninguem alem de service_role executa. `authenticated` inclusive:
  --    e como o painel inteiro roda.
  ---------------------------------------------------------------------------
  foreach v_quem in array array['anon', 'authenticated', 'public'] loop
    if has_function_privilege(v_quem, 'public.fn_segredo_membros_cron()', 'EXECUTE') then
      raise exception '% consegue executar fn_segredo_membros_cron', v_quem;
    end if;
  end loop;

  if not has_function_privilege('service_role', 'public.fn_segredo_membros_cron()', 'EXECUTE') then
    raise exception 'service_role NAO consegue executar; a Edge Function ficaria sem o segredo';
  end if;

  ---------------------------------------------------------------------------
  -- 4. E ela nao vira uma porta para o cofre inteiro: sem parametro, sem
  --    jeito de pedir outro segredo.
  ---------------------------------------------------------------------------
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'fn_segredo_membros_cron'
         and p.pronargs > 0) > 0 then
    raise exception 'a funcao ganhou parametro; generica ela le o cofre inteiro';
  end if;

  raise notice 'o segredo do cron tem um lugar so, e so service_role o alcanca';
end
$prova$;
