import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return json(null, 204);
  }

  // Verifica se já existem usuários — se sim, bloqueia
  const { count } = await supabaseAdmin
    .from('perfis')
    .select('id', { count: 'exact', head: true });

  if ((count ?? 0) > 0) {
    return json({ error: 'Setup já concluído' }, 403);
  }

  const { nome, email, password } = await req.json();
  if (!email || !password) return json({ error: 'email e password são obrigatórios' }, 400);

  // Cria usuário com email confirmado
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome: nome || email.split('@')[0] },
  });

  if (error) return json({ error: error.message }, 400);

  // Marca como admin
  await supabaseAdmin.from('perfis').upsert({
    id: data.user.id,
    nome: nome || email.split('@')[0],
    is_admin: true,
  }, { onConflict: 'id' });

  return json({ ok: true });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
    },
  });
}
