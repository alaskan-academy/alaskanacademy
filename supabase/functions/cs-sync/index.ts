import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CS_API_KEY     = Deno.env.get('CS_API_KEY')!;
const CS_API_SECRET  = Deno.env.get('CS_API_SECRET')!;
const CS_SYNC_SECRET = Deno.env.get('CS_SYNC_SECRET')!;

const CS_BASE_URL = 'https://api.contasimples.com';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

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

async function fetchTransactions(token: string, startDate: string, endDate: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let nextPageStartKey: string | undefined;
  do {
    const params = new URLSearchParams({ startDate, endDate, limit: '50', sorting: 'transactionDate:ASC' });
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

// Prefere o nome do beneficiário/comerciante quando disponível
function buildDescricao(t: Record<string, unknown>): string {
  const candidates = [
    t['sourceDestinationName'],
    (t['counterpart'] as Record<string, unknown> | undefined)?.['name'],
    t['counterpartName'],
    t['placeEstablishment'],
    t['description'],
    t['memo'],
    (t['transactionType'] as Record<string, unknown> | undefined)?.['description'],
    (t['transactionType'] as Record<string, unknown> | undefined)?.['name'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return 'Sem descrição';
}

function buildValor(t: Record<string, unknown>): number {
  const raw = t['brlAmount'] ?? t['amount'] ?? 0;
  return typeof raw === 'number' ? raw : Number(raw);
}

// CS retorna brlAmount sempre positivo; o sinal vem do tipo/descrição da transação
function isDebit(tx: Record<string, unknown>): boolean {
  if (tx['isDebit'] === true)  return true;
  if (tx['isDebit'] === false) return false;

  const tipo     = tx['transactionType'] as Record<string, unknown> | undefined;
  const txDesc   = String(tx['description'] ?? '').toLowerCase();
  const tipoDesc = String(tipo?.['description'] ?? tipo?.['name'] ?? '').toLowerCase();
  const combined = `${txDesc} ${tipoDesc}`;

  // "Saque" na CS significa PIX/TED recebido (o remetente sacou da conta dele para a sua)
  // Não usar "saque" como indicador de débito
  return (
    combined.includes('enviado') ||
    combined.includes('pagamento') ||
    combined.includes('resgate') ||
    combined.includes('débito') ||
    combined.includes('debito') ||
    combined.includes('tarifa') ||
    combined.includes('imposto') ||
    combined.includes('ted') ||
    combined.includes('transferência enviada') ||
    combined.includes('transferencia enviada')
  );
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const syncSecret = req.headers.get('x-sync-secret');
  if (!CS_SYNC_SECRET || syncSecret !== CS_SYNC_SECRET) return json({ error: 'Unauthorized' }, 401);

  let body: { startDate?: string; endDate?: string } = {};
  try { body = await req.json(); } catch { /* vazio ok */ }

  const today = new Date();
  const endDate   = body.endDate   ?? today.toISOString().slice(0, 10);
  const start     = new Date(today);
  start.setDate(start.getDate() - 3);
  const startDate = body.startDate ?? start.toISOString().slice(0, 10);

  try {
    const token       = await getAccessToken();
    const raw         = await fetchTransactions(token, startDate, endDate);
    const processadas = raw.filter((t) => {
      const tx = t as Record<string, unknown>;
      if (tx['status'] !== 2) return false;
      // Ignora movimentações internas entre conta e limite do cartão CS
      const desc = String(tx['description'] ?? '').toLowerCase();
      if (desc.startsWith('deposito de limite') || desc.startsWith('resgate de limite')) return false;
      return true;
    });

    if (processadas.length === 0) return json({ ok: true, inserted: 0, period: { startDate, endDate } });

    const rows = processadas.map((t) => {
      const tx         = t as Record<string, unknown>;
      const valorBruto = buildValor(tx);
      return {
        referencia_externa: String(tx['id']),
        data:               String(tx['transactionDate'] ?? '').slice(0, 10),
        descricao:          buildDescricao(tx),
        valor:              isDebit(tx) ? -Math.abs(valorBruto) : Math.abs(valorBruto),
        status_revisao:     'pendente',
        fonte:              'conta_simples',
      };
    });

    const { error } = await supabase
      .from('transacoes')
      .upsert(rows, { onConflict: 'referencia_externa', ignoreDuplicates: true });

    if (error) { console.error('[cs-sync] DB error:', error.message); return json({ error: error.message }, 500); }

    const { count: total } = await supabase
      .from('transacoes')
      .select('id', { count: 'exact', head: true })
      .in('referencia_externa', rows.map(r => r.referencia_externa));

    console.log(`[cs-sync] OK: ${raw.length} buscadas, ${processadas.length} processadas`);
    return json({
      ok:        true,
      fetched:   raw.length,
      processed: processadas.length,
      inserted:  total ?? rows.length,
      period:    { startDate, endDate },
    });
  } catch (err) {
    console.error('[cs-sync] Erro:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
