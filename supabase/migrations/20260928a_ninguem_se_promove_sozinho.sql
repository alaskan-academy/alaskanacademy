-- NINGUÉM SE PROMOVE SOZINHO
--
-- Qualquer pessoa logada no painel podia se tornar administradora. Três fatos
-- medidos em 28/09/2026, antes desta migração:
--
--   1. a política de UPDATE de `perfis` é
--        USING (is_current_user_admin() OR id = auth.uid())
--   2. o `with_check` dela é NULO — e no Postgres, política de UPDATE sem
--      WITH CHECK usa o próprio USING para validar a linha NOVA. Como a linha
--      nova continua tendo `id = auth.uid()`, ela passa.
--   3. o papel `authenticated` tem privilégio de UPDATE nas OITO colunas,
--      `is_admin` e `cargo_id` inclusive.
--
-- Juntando: `update perfis set is_admin = true where id = auth.uid()` era
-- aceito. A RLS dizia QUAIS LINHAS, e ninguém dizia QUAIS COLUNAS.
--
-- ── POR QUE ISTO NÃO PODE ESPERAR A PONTE perfis→editores ──────────────────
--
-- Hoje a escalada é pela metade: dá acesso de administrador, mas não muda
-- pagamento, porque `editores.cargo_id` é uma SEGUNDA CÓPIA que só tela de
-- admin escreve. A duplicação que estamos para consertar é, por acidente, o
-- que limita o estrago.
--
-- No instante em que `perfis.cargo_id` virar fonte única, a mesma brecha passa
-- a valer o multiplicador de comissão (0 a 1,4) e o percentual de liderança
-- (até 20%). Consertar a duplicação SEM fechar isto antes transformaria uma
-- escalada de permissão numa escalada de pagamento.
--
-- ── POR QUE GATILHO, E NÃO POLÍTICA NEM REVOKE ─────────────────────────────
--
-- · `REVOKE UPDATE (is_admin, ...) FROM authenticated` travaria também os
--   ADMINS, que são `authenticated` igual a todo mundo — privilégio de coluna
--   é por PAPEL, e a diferença aqui é por LINHA.
-- · RLS não sabe comparar com o valor ANTIGO: `WITH CHECK` não enxerga OLD,
--   então não consegue dizer "pode salvar, desde que este campo não mude".
-- · Gatilho BEFORE UPDATE vê OLD e NEW. É o único lugar onde a regra cabe.
--
-- Medido antes de escrever: NENHUM fluxo do sistema edita o próprio perfil.
-- As 5 escritas em `perfis` no front estão todas em `PermissoesTab` (tela de
-- admin), e as 3 da edge function `admin-users` usam service role. Então o
-- gatilho não tira nada de ninguém — só fecha o caminho que não era para
-- existir. Por isso ele bloqueia as COLUNAS de privilégio e deixa o resto
-- passar, em vez de tirar `id = auth.uid()` da política: é a mudança menor,
-- e a menor é a que tem menos chance de derrubar algo que eu não vi.

CREATE OR REPLACE FUNCTION public.fn_perfil_nao_se_promove()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  /* Sem JWT é service_role, cron ou migração — a edge function `admin-users`
     desativa gente por aqui (`update perfis set ativo=false`) e precisa passar.
     Quem chega sem token já provou ter a chave do servidor. */
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_current_user_admin() THEN
    RETURN NEW;
  END IF;

  /* Daqui para baixo: pessoa logada, não administradora. Ela pode mexer na
     própria linha (a RLS já garante que é a dela), mas não nos campos que
     decidem o que ela PODE e o que ela RECEBE. */
  IF NEW.is_admin         IS DISTINCT FROM OLD.is_admin
  OR NEW.cargo_id         IS DISTINCT FROM OLD.cargo_id
  OR NEW.setor_id         IS DISTINCT FROM OLD.setor_id
  OR NEW.ativo            IS DISTINCT FROM OLD.ativo
  OR NEW.radar_pode_criar IS DISTINCT FROM OLD.radar_pode_criar THEN
    RAISE EXCEPTION
      'Cargo, setor, acesso e status de administrador só mudam por um administrador, em Configuracoes > Usuarios.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.fn_perfil_nao_se_promove() IS
  'A RLS de perfis diz QUAIS LINHAS a pessoa edita; esta funcao diz QUAIS COLUNAS. Sem ela, um usuario comum fazia `update perfis set is_admin=true` na propria linha. Ver 20260928a.';

DROP TRIGGER IF EXISTS trg_perfil_nao_se_promove ON perfis;
CREATE TRIGGER trg_perfil_nao_se_promove
  BEFORE UPDATE ON perfis
  FOR EACH ROW EXECUTE FUNCTION public.fn_perfil_nao_se_promove();

-- ── AS PROVAS ───────────────────────────────────────────────────────────────
--
-- Não é conferir que o gatilho existe: é TENTAR A ESCALADA, como um usuário
-- comum, e exigir que ela falhe. E, do outro lado, exigir que o que era
-- legítimo continue passando — trava que quebra o uso normal é desligada na
-- primeira segunda-feira.
DO $prova$
DECLARE
  v_nao_admin uuid;
  v_admin     uuid;
  v_passou    boolean;
  v_antes     boolean;
BEGIN
  SELECT id INTO v_nao_admin FROM perfis WHERE NOT is_admin AND ativo LIMIT 1;
  SELECT id INTO v_admin     FROM perfis WHERE is_admin     AND ativo LIMIT 1;
  IF v_nao_admin IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'faltou um perfil admin ou um nao-admin para provar contra';
  END IF;

  SELECT is_admin INTO v_antes FROM perfis WHERE id = v_nao_admin;

  -- 1. A ESCALADA. Como o não-admin, virar admin precisa FALHAR.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_nao_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  v_passou := false;
  BEGIN
    UPDATE perfis SET is_admin = true WHERE id = v_nao_admin;
    v_passou := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_passou := false;
  END;
  EXECUTE 'reset role';
  IF v_passou THEN
    RAISE EXCEPTION 'A BRECHA CONTINUA ABERTA: o nao-admin virou admin sozinho';
  END IF;

  -- 2. O mesmo pelo cargo, que é por onde o dinheiro entraria depois da ponte.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_nao_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  v_passou := false;
  BEGIN
    UPDATE perfis SET cargo_id = (SELECT id FROM cargos ORDER BY multiplicador DESC LIMIT 1)
     WHERE id = v_nao_admin;
    v_passou := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_passou := false;
  END;
  EXECUTE 'reset role';
  IF v_passou THEN
    RAISE EXCEPTION 'o nao-admin se deu o cargo de maior multiplicador';
  END IF;

  -- 3. E o que era legítimo continua passando: mexer no próprio nome.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_nao_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  v_passou := true;
  BEGIN
    UPDATE perfis SET nome = nome WHERE id = v_nao_admin;
  EXCEPTION WHEN OTHERS THEN
    v_passou := false;
  END;
  EXECUTE 'reset role';
  IF NOT v_passou THEN
    RAISE EXCEPTION 'a trava pegou demais: o nao-admin nao consegue mais salvar a propria linha';
  END IF;

  -- 4. O administrador continua administrando.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  v_passou := true;
  BEGIN
    UPDATE perfis SET cargo_id = cargo_id, is_admin = is_admin WHERE id = v_nao_admin;
  EXCEPTION WHEN OTHERS THEN
    v_passou := false;
  END;
  EXECUTE 'reset role';
  IF NOT v_passou THEN
    RAISE EXCEPTION 'a trava pegou o ADMIN — PermissoesTab pararia de funcionar';
  END IF;

  -- 5. Sem JWT (service_role) continua passando: é por aqui que a edge
  --    function `admin-users` desativa uma pessoa.
  PERFORM set_config('request.jwt.claims', '', true);
  v_passou := true;
  BEGIN
    UPDATE perfis SET ativo = ativo WHERE id = v_nao_admin;
  EXCEPTION WHEN OTHERS THEN
    v_passou := false;
  END;
  IF NOT v_passou THEN
    RAISE EXCEPTION 'a trava pegou o service_role — a edge function admin-users quebraria';
  END IF;

  -- 6. E nada mudou de verdade no caminho: o retrato bate com o de antes.
  IF (SELECT is_admin FROM perfis WHERE id = v_nao_admin) IS DISTINCT FROM v_antes THEN
    RAISE EXCEPTION 'as provas deixaram residuo: is_admin mudou';
  END IF;

  RAISE NOTICE 'escalada fechada · nome livre · admin e service_role intactos';
END
$prova$;

NOTIFY pgrst, 'reload schema';
