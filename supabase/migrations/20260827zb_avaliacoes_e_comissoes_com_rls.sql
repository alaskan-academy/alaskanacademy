-- A privacidade das avaliações vivia na TELA, não no banco.
--
-- `avaliacoes_mensais` e `editor_comissoes` tinham SELECT e ALL com
-- `USING (true)` para qualquer autenticado. O AvaliacoesTab busca
-- `.select('*')` sem filtro e SÓ ENTÃO esconde as linhas dos outros no
-- navegador — quem abrisse o DevTools lia o feedback e o bônus de todo mundo,
-- e as políticas sendo FOR ALL, podia também escrever.
--
-- São 14 avaliações, 6 com feedback escrito, com bônus e multiplicador. As NFs
-- já estavam certas desde antes; estas duas ficaram para trás.
--
-- A regra é a que ela escolheu, e é a que a tela já tentava aplicar:
--   editor      → só a sua
--   head/líder  → o time, mas não edita a própria
--   admin       → tudo
--
-- Conferido assumindo cada identidade (`set local role authenticated` +
-- `request.jwt.claims`), e não só lendo a política:
--
--   Jaqueline (Pleno)      7 avaliações, 1 editor    · editar: 0 linhas
--   Jessica M. (Head)     14 avaliações, 2 editores  · editar a do time: 7
--                                                    · editar a própria: 0
--   Jessica G. (admin)    14 avaliações              · tudo

CREATE OR REPLACE FUNCTION public.fn_meu_editor_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id from public.editores e
   where e.usuario_id = auth.uid()
   limit 1;
$function$;

-- Lê `cargos.pode_aprovar`, e não o NOME do cargo.
--
-- O projeto tinha duas definições de "head/líder" para a mesma ideia: Produção
-- e Criativos Meta usam a flag; o AvaliacoesTab comparava o nome com
-- 'head'/'lider'. Elas já discordam — "Gerente Criativo" tem
-- `pode_aprovar = true` e não casa com nenhum dos dois nomes. Hoje ninguém tem
-- esse cargo, então não mudava nada; no dia em que tivesse, a pessoa aprovaria
-- criativo numa tela e não veria avaliação na outra.
--
-- A flag ganha porque é explícita. Comparar nome quebra em silêncio quando
-- alguém renomear um cargo — e renomear parece inofensivo.
CREATE OR REPLACE FUNCTION public.fn_ve_o_time()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.perfis p
      left join public.cargos c on c.id = p.cargo_id
     where p.id = auth.uid()
       and (coalesce(p.is_admin, false) or coalesce(c.pode_aprovar, false))
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_sou_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select p.is_admin from public.perfis p where p.id = auth.uid()), false);
$function$;

DROP POLICY IF EXISTS authenticated_read  ON public.avaliacoes_mensais;
DROP POLICY IF EXISTS authenticated_write ON public.avaliacoes_mensais;

CREATE POLICY avaliacoes_mensais_leitura ON public.avaliacoes_mensais
  FOR SELECT TO authenticated
  USING (fn_ve_o_time() OR editor_id = fn_meu_editor_id());

-- Líder não mexe na própria avaliação — a mesma regra que a tela já aplicava
-- em `canEditRow`, agora onde ela vale de fato.
CREATE POLICY avaliacoes_mensais_insercao ON public.avaliacoes_mensais
  FOR INSERT TO authenticated
  WITH CHECK (fn_sou_admin() OR (fn_ve_o_time() AND editor_id IS DISTINCT FROM fn_meu_editor_id()));

CREATE POLICY avaliacoes_mensais_edicao ON public.avaliacoes_mensais
  FOR UPDATE TO authenticated
  USING      (fn_sou_admin() OR (fn_ve_o_time() AND editor_id IS DISTINCT FROM fn_meu_editor_id()))
  WITH CHECK (fn_sou_admin() OR (fn_ve_o_time() AND editor_id IS DISTINCT FROM fn_meu_editor_id()));

CREATE POLICY avaliacoes_mensais_remocao ON public.avaliacoes_mensais
  FOR DELETE TO authenticated
  USING (fn_sou_admin() OR (fn_ve_o_time() AND editor_id IS DISTINCT FROM fn_meu_editor_id()));

-- Ler segue a mesma regra. Escrever é só de admin: comissão é folha de
-- pagamento, e nenhuma tela do dashboard escreve nesta tabela hoje — abrir
-- para líder seria dar uma permissão que ninguém pediu e ninguém usa.
DROP POLICY IF EXISTS authenticated_read  ON public.editor_comissoes;
DROP POLICY IF EXISTS authenticated_write ON public.editor_comissoes;

CREATE POLICY editor_comissoes_leitura ON public.editor_comissoes
  FOR SELECT TO authenticated
  USING (fn_ve_o_time() OR editor_id = fn_meu_editor_id());

CREATE POLICY editor_comissoes_escrita ON public.editor_comissoes
  FOR ALL TO authenticated
  USING (fn_sou_admin())
  WITH CHECK (fn_sou_admin());
