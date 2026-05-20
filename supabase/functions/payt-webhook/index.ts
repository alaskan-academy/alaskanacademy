import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Chave de integração da Payt — configure em Supabase > Edge Functions > Secrets
const INTEGRATION_KEY = Deno.env.get('PAYT_INTEGRATION_KEY');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Valida chave de integração (se configurada como secret)
  if (INTEGRATION_KEY && body.integration_key !== INTEGRATION_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Ignora pedidos de teste
  if (body.test === true) {
    return json({ ok: true, skipped: 'test order' });
  }

  // Ignora eventos que não são de pedido
  if (body.type !== 'order') {
    return json({ ok: true, skipped: `event type: ${body.type}` });
  }

  const payt_id = body.transaction_id as string;
  if (!payt_id) {
    return json({ error: 'transaction_id ausente' }, 400);
  }

  // Data: usa paid_at quando disponível, senão updated_at
  const rawDate: string =
    body.transaction?.paid_at ||
    body.updated_at ||
    body.started_at ||
    '';
  const data = rawDate.slice(0, 10) || null;

  // Valor: centavos → reais
  const valor = typeof body.transaction?.total_price === 'number'
    ? body.transaction.total_price / 100
    : 0;

  const status: string = body.status ?? 'unknown';

  // Produto principal
  const produto: string | null = body.product?.name ?? null;

  // UTMs — utm_content tem formato "Nome do Ad|ad_id::token"
  const sources = body.link?.sources ?? {};
  const utm_content_raw: string | null = sources.utm_content ?? null;
  const utm_content = utm_content_raw
    ? utm_content_raw.split('|')[0].trim()
    : null;
  // extrai o ad_id do Meta do utm_content (parte após o primeiro "|", antes de "::")
  const utm_ad_id = utm_content_raw?.includes('|')
    ? (utm_content_raw.split('|')[1]?.split('::')[0]?.trim() || null)
    : null;

  const utm_source:   string | null = sources.utm_source   ?? null;
  const utm_medium:   string | null = sources.utm_medium   ?? null;
  const utm_campaign: string | null = sources.utm_campaign ?? null;
  const utm_term:     string | null = sources.utm_term     ?? null;

  const cliente_nome:  string | null = body.customer?.name  ?? null;
  const cliente_email: string | null = body.customer?.email ?? null;

  // Upsert por payt_id — se a Payt reenviar (ex: reembolso), atualiza o status
  const { error } = await supabase.from('vendas_payt').upsert(
    {
      payt_id,
      data,
      valor,
      status,
      produto,
      utm_content,
      utm_ad_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      cliente_nome,
      cliente_email,
      payload_raw: body,
    },
    { onConflict: 'payt_id' },
  );

  if (error) {
    console.error('Erro ao salvar venda:', error.message);
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, payt_id, status, utm_content });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
