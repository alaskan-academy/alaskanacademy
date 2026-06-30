import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Secrets (nunca em código — configurar em Supabase > Settings > Secrets) ──
const CS_API_KEY     = Deno.env.get('CS_API_KEY')!;
const CS_API_SECRET  = Deno.env.get('CS_API_SECRET')!;
const CS_SYNC_SECRET = Deno.env.get('CS_SYNC_SECRET')!; // segredo para acionar a função

const CS_BASE_URL = 'https://api.contasimples.com';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const basic = btoa(`${CS_API_KEY}:${CS_API_SECRET}`);

  const res = await fetch(`${CS_BASE_URL}/oauth/v1/access-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'alaskan-dashboard/1.0',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CS auth failed [${res.status}]: ${body}`);
  }

  const { access_token } = await res.json();
  return access_token as string;
}

// ─── Fetch transactions (paginado) ─────────────────────────────────────────────

async function fetchTransactions(
  token: string,
  startDate: string,
  endDate: string,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let nextPageStartKey: string | undefined;

  do {
    const params = new URLSearchParams({
      startDate,
      endDate,
      limit: '50',
      sorting: 'transactionDate:ASC',
    });
    if (nextPageStartKey) params.set('nextPageStartKey', nextPageStartKey);

    const res = await fetch(`${CS_BASE_URL}/statements/v1/banking?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'alaskan-dashboard/1.0',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CS API error [${res.status}]: ${body}`);
    }

    const data = await res.json() as { transactions?: unknown[]; nextPageStartKey?: string };
    all.push(...(data.transactions ?? []));
    nextPageStartKey = data.nextPageStartKey;
  } while (nextPageStartKey);

  return all;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Monta a descrição legível da transação
function buildDescricao(t: Record<string, unknown>): string {
  // Tenta campos em ordem de preferência
  const candidates = [
    t['description'],
    t['memo'],
    (t['transactionType'] as Record<string, unknown> | undefined)?.['description'],
    (t['transactionType'] as Record<string, unknown> | undefined)?.['name'],
    (t['counterpart'] as Record<string, unknown> | undefined)?.['name'],
    t['counterpartName'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return 'Sem descrição';
}

// brlAmount: positivo = entrada, negativo = saída (CS já entrega com sinal)
function buildValor(t: Record<string, unknown>): number {
  const raw = t['brlAmount'] ?? t['amount'] ?? 0;
  return typeof raw === 'number' ? raw : Number(raw);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Só aceita POST
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Valida o segredo de invocação — protege contra chamadas não autorizadas
  const syncSecret = req.headers.get('x-sync-secret');
  if (!CS_SYNC_SECRET || syncSecret !== CS_SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: { startDate?: string; endDate?: string } = {};
  try { body = await req.json(); } catch { /* body vazio é ok */ }

  // Janela padrão: últimos 3 dias (cobre fins de semana e sync perdido)
  const today = new Date();
  const endDate   = body.endDate   ?? today.toISOString().slice(0, 10);
  const start     = new Date(today);
  start.setDate(start.getDate() - 3);
  const startDate = body.startDate ?? start.toISOString().slice(0, 10);

  try {
    // 1. Autenticar
    const token = await getAccessToken();

    // 2. Buscar transações
    const raw = await fetchTransactions(token, startDate, endDate);

    // 3. Filtrar: apenas PROCESSADO (status = 2)
    const processadas = raw.filter(
      (t) => (t as Record<string, unknown>)['status'] === 2,
    );

    if (processadas.length === 0) {
      return json({ ok: true, inserted: 0, period: { startDate, endDate } });
    }

    // 4. Mapear para o schema de transacoes
    const rows = processadas.map((t) => {
      const tx = t as Record<string, unknown>;
      const rawDate = String(tx['transactionDate'] ?? '');
      return {
        referencia_externa: String(tx['id']),
        data: rawDate.slice(0, 10),
        descricao: buildDescricao(tx),
        valor: buildValor(tx),
        status_revisao: 'pendente',
        fonte: 'conta_simples',
      };
    });

    // 5. Upsert idempotente — conflito em referencia_externa é ignorado silenciosamente
    const { error, count } = await supabase
      .from('transacoes')
      .upsert(rows, { onConflict: 'referencia_externa', ignoreDuplicates: true })
      .select('id', { count: 'exact' });

    if (error) {
      console.error('[cs-sync] DB error:', error.message);
      return json({ error: error.message }, 500);
    }

    console.log(`[cs-sync] OK: ${count} inseridas, ${processadas.length - (count ?? 0)} já existiam`);
    return json({
      ok: true,
      fetched: raw.length,
      processed: processadas.length,
      inserted: count ?? 0,
      period: { startDate, endDate },
    });

  } catch (err) {
    console.error('[cs-sync] Erro:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
