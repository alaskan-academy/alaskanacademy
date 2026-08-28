import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * A porta das funcoes que rodam com service role.
 *
 * As duas funcoes de sync do Sheets nasceram sem porta nenhuma: rodavam com
 * `SUPABASE_SERVICE_ROLE_KEY`, chamavam `auth.admin.listUsers()` e escreviam o
 * e-mail de TODOS os usuarios numa planilha -- e nao perguntavam quem estava
 * chamando. O botao so aparecia para admin, mas isso e a tela, nao a funcao:
 * qualquer usuario logado fazia o POST na mao.
 *
 * Aqui e nao copiado dentro de cada funcao porque guarda de permissao repetida
 * e a primeira armadilha do CLAUDE.md: a terceira copia esquece um caso.
 *
 * Devolve `null` quando pode seguir, ou a `Response` pronta para devolver.
 */
export async function somenteAdmin(
  req: Request,
  cors: Record<string, string>,
): Promise<Response | null> {
  const nega = (motivo: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: motivo }), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });

  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return nega("Sem credencial.", 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return nega("Credencial invalida.", 401);

  const { data: perfil } = await admin
    .from("perfis").select("is_admin").eq("id", user.id).single();

  if (!perfil?.is_admin) return nega("Esta exportacao e restrita a administradores.", 403);

  return null;
}
