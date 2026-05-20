import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors(), status: 204 });
  }

  // Verifica token do chamador
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return ok({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return ok({ error: 'Unauthorized' });

  // Verifica se é admin
  const { data: perfil } = await supabaseAdmin
    .from('perfis')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!perfil?.is_admin) return ok({ error: 'Sem permissão de administrador' });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return ok({ error: 'JSON inválido' });
  }

  const { action } = body;

  if (action === 'create') {
    const { email, password, nome } = body;
    if (!email || !password) return ok({ error: 'Email e senha são obrigatórios' });
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome: nome || email.split('@')[0] },
    });
    if (error) return ok({ error: error.message });
    await supabaseAdmin.from('perfis').upsert({
      id: data.user.id,
      nome: nome || email.split('@')[0],
      is_admin: false,
    }, { onConflict: 'id' });
    return ok({ user: { id: data.user.id, email: data.user.email } });
  }

  if (action === 'delete') {
    const { userId } = body;
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return ok({ error: error.message });
    return ok({ ok: true });
  }

  if (action === 'update_password') {
    const { userId, password } = body;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (error) return ok({ error: error.message });
    return ok({ ok: true });
  }

  return ok({ error: 'Ação desconhecida' });
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
