-- A tela dizia "Acesso restrito ao setor de Copy e administradores", e a
-- restrição existia só nela.
--
-- As quatro tabelas eram `USING (true)` para qualquer autenticado: 620 hooks,
-- 122 ofertas, 35 swipes e a rotina do time, tudo legível e GRAVÁVEL pela API
-- por quem a tela barrava. São quatro pessoas hoje.
--
-- Isso é pior do que não dizer nada. Uma tela que promete restrição e não
-- entrega ensina a confiar no aviso errado — e alguém escreve ali algo que só
-- escreveria por confiar nele.
--
-- Conferido assumindo cada identidade, e não só lendo a política:
--   Jaqueline (Editor, não-admin)   hooks 0 · ofertas 0 · swipes 0 · rotina 0
--   Lucas (setor Copy)              hooks 620 · swipes 35

CREATE OR REPLACE FUNCTION public.fn_e_copy_ou_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.perfis p
      left join public.setores s on s.id = p.setor_id
     where p.id = auth.uid()
       and (coalesce(p.is_admin, false) or s.nome = 'Copy')
  );
$function$;

COMMENT ON FUNCTION public.fn_e_copy_ou_admin() IS
  'A mesma regra que CopywritersPage aplica na tela: setor Copy ou admin. Existe para a promessa da tela valer tambem na API.';

-- Uma política só por tabela: aqui não há "o seu" e "o dos outros" — o acervo
-- é do time de Copy inteiro. Quem entra, entra todo; quem não entra, não lê
-- nem escreve.

DROP POLICY IF EXISTS copy_rotina_all_authenticated ON public.copy_rotina_cards;
CREATE POLICY copy_rotina_cards_copy ON public.copy_rotina_cards
  FOR ALL TO authenticated
  USING (fn_e_copy_ou_admin()) WITH CHECK (fn_e_copy_ou_admin());

DROP POLICY IF EXISTS copytrack_offers_auth ON public.copytrack_offers;
CREATE POLICY copytrack_offers_copy ON public.copytrack_offers
  FOR ALL TO authenticated
  USING (fn_e_copy_ou_admin()) WITH CHECK (fn_e_copy_ou_admin());

DROP POLICY IF EXISTS copytrack_hooks_auth ON public.copytrack_hooks;
CREATE POLICY copytrack_hooks_copy ON public.copytrack_hooks
  FOR ALL TO authenticated
  USING (fn_e_copy_ou_admin()) WITH CHECK (fn_e_copy_ou_admin());

DROP POLICY IF EXISTS copytrack_ad_swipe_auth ON public.copytrack_ad_swipe;
CREATE POLICY copytrack_ad_swipe_copy ON public.copytrack_ad_swipe
  FOR ALL TO authenticated
  USING (fn_e_copy_ou_admin()) WITH CHECK (fn_e_copy_ou_admin());

-- ── E a coluna morta ────────────────────────────────────────────────────────
-- `is_archived` existia na tabela e no tipo do TypeScript, com ZERO linhas
-- true, nunca lida nem escrita em lugar nenhum. Dizia a mesma coisa que
-- `status = 'descartada'`, que é usado de verdade.
--
-- É a primeira armadilha do CLAUDE.md esperando a hora: no dia em que alguém
-- ligasse o arquivamento, teríamos ofertas descartadas não-arquivadas e
-- arquivadas não-descartadas, sem ninguém saber qual manda.
ALTER TABLE public.copytrack_offers DROP COLUMN is_archived;
