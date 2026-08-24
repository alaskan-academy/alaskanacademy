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
  if (!res.ok) throw new Error(`CS auth failed [${res.status}]: ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token as string;
}

async function fetchBanking(token: string, startDate: string, endDate: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let nextPageStartKey: string | undefined;
  do {
    const params = new URLSearchParams({ startDate, endDate, limit: '50', sorting: 'transactionDate:ASC' });
    if (nextPageStartKey) params.set('nextPageStartKey', nextPageStartKey);
    const res = await fetch(`${CS_BASE_URL}/statements/v1/banking?${params}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'alaskan-dashboard/1.0' },
    });
    if (!res.ok) throw new Error(`CS banking error [${res.status}]: ${await res.text()}`);
    const data = await res.json() as { transactions?: unknown[]; nextPageStartKey?: string };
    all.push(...(data.transactions ?? []));
    nextPageStartKey = data.nextPageStartKey;
  } while (nextPageStartKey);
  return all;
}

async function fetchCardWindow(token: string, startDate: string, endDate: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let nextPageStartKey: string | undefined;
  do {
    const params = new URLSearchParams({ startDate, endDate, limit: '50', sorting: 'transactionDate:ASC' });
    if (nextPageStartKey) params.set('nextPageStartKey', nextPageStartKey);
    const res = await fetch(`${CS_BASE_URL}/statements/v1/credit-card?${params}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'alaskan-dashboard/1.0' },
    });
    if (!res.ok) throw new Error(`CS card error [${res.status}]: ${await res.text()}`);
    const data = await res.json();
    const txList = Array.isArray(data) ? data :
                   Array.isArray(data?.transactions) ? data.transactions :
                   Array.isArray(data?.items) ? data.items :
                   Array.isArray(data?.data) ? data.data : [];
    all.push(...txList);
    nextPageStartKey = data?.nextPageStartKey ?? data?.next_page_start_key ?? undefined;
  } while (nextPageStartKey);
  return all;
}

// CS card API rejects ranges > ~30 days — fetches month by month
async function fetchCard(token: string, startDate: string, endDate: string): Promise<unknown[]> {
  const all: unknown[] = [];
  const end    = new Date(endDate);
  let cursor   = new Date(startDate);
  while (cursor <= end) {
    const windowEnd = new Date(cursor);
    windowEnd.setMonth(windowEnd.getMonth() + 1);
    windowEnd.setDate(windowEnd.getDate() - 1);
    if (windowEnd > end) windowEnd.setTime(end.getTime());
    const s = cursor.toISOString().slice(0, 10);
    const e = windowEnd.toISOString().slice(0, 10);
    const rows = await fetchCardWindow(token, s, e);
    all.push(...rows);
    cursor = new Date(windowEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return all;
}

function buildDescricaoBanking(t: Record<string, unknown>): string {
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

function buildValorBanking(t: Record<string, unknown>): number {
  const raw = t['brlAmount'] ?? t['amount'] ?? 0;
  return typeof raw === 'number' ? raw : Number(raw);
}

function isDebitBanking(tx: Record<string, unknown>): boolean {
  if (tx['isDebit'] === true)  return true;
  if (tx['isDebit'] === false) return false;
  const tipo     = tx['transactionType'] as Record<string, unknown> | undefined;
  const txDesc   = String(tx['description'] ?? '').toLowerCase();
  const tipoDesc = String(tipo?.['description'] ?? tipo?.['name'] ?? '').toLowerCase();
  const combined = `${txDesc} ${tipoDesc}`;
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

async function upsertBatch(rows: Record<string, unknown>[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('transacoes')
      .upsert(chunk, { onConflict: 'referencia_externa', ignoreDuplicates: true });
    if (error) throw new Error(`DB upsert error: ${error.message}`);
  }
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
    const token = await getAccessToken();

    // ── 1. Conta corrente
    const rawBanking = await fetchBanking(token, startDate, endDate);
    const bankingRows = rawBanking
      .filter((t) => {
        const tx = t as Record<string, unknown>;
        if (tx['status'] !== 2) return false;
        const desc = String(tx['description'] ?? '').toLowerCase();
        const name = String(tx['sourceDestinationName'] ?? tx['counterpartName'] ?? '').toLowerCase();
        const tipoDesc = String((tx['transactionType'] as Record<string, unknown> | undefined)?.['description'] ?? '').toLowerCase();
        const combined = `${desc} ${name} ${tipoDesc}`;
        if (combined.includes('deposito de limite') || combined.includes('resgate de limite')) return false;
        if (combined.includes('limite cartao') || combined.includes('limite cartão')) return false;
        if (name === 'conta simples solucoes de pagamentos ltda') return false;
        return true;
      })
      .map((t) => {
        const tx = t as Record<string, unknown>;
        const raw = buildValorBanking(tx);
        return {
          referencia_externa: String(tx['id']),
          data: String(tx['transactionDate'] ?? '').slice(0, 10),
          descricao: buildDescricaoBanking(tx),
          valor: isDebitBanking(tx) ? -Math.abs(raw) : Math.abs(raw),
          status_revisao: 'pendente',
          fonte: 'conta_simples',
          // A resposta inteira, não só os campos que a tela usa hoje. Se a
          // Conta Simples devolver link de comprovante, ele está aqui — antes
          // era descartado todo dia sem ninguém saber o que se perdia. Mesmo
          // princípio de `vendas_payt.payload_raw`, que hoje de manhã foi o
          // que permitiu reprocessar venda à mão em vez de perdê-la.
          payload_raw: tx,
        };
      });

    // ── 2. Cartão corporativo (janelas mensais)
    const rawCard = await fetchCard(token, startDate, endDate);
    const cardRows = rawCard
      .filter((t) => {
        const tx = t as Record<string, unknown>;
        if (String(tx['type'] ?? '') === 'LIMIT') return false;
        return true;
      })
      .map((t) => {
        const tx = t as Record<string, unknown>;
        const amountBrl = Number(tx['amountBrl'] ?? tx['amount'] ?? tx['brlAmount'] ?? 0);
        const isCashOut = String(tx['operation'] ?? '') === 'CASH_OUT';
        const merchant  = String(tx['merchant'] ?? tx['description'] ?? tx['name'] ?? '').trim() || 'Cartão CS';
        return {
          referencia_externa: `card_${String(tx['id'])}`,
          data: String(tx['transactionDate'] ?? tx['date'] ?? '').slice(0, 10),
          descricao: merchant,
          valor: isCashOut ? -Math.abs(amountBrl) : Math.abs(amountBrl),
          status_revisao: 'pendente',
          fonte: 'conta_simples_cartao',
          payload_raw: tx,
        };
      });

    // ── 3. Upsert em chunks de 100
    if (bankingRows.length > 0) await upsertBatch(bankingRows as Record<string, unknown>[]);
    if (cardRows.length > 0)    await upsertBatch(cardRows    as Record<string, unknown>[]);

    // ── 4. Auto-categorização via regras_categoria
    const { data: categorized, error: catError } = await supabase.rpc('aplicar_regras_categoria');
    if (catError) console.warn('[cs-sync] Auto-categorização falhou:', catError.message);

    console.log(`[cs-sync] OK: ${bankingRows.length} banking, ${cardRows.length} cartão, ${categorized ?? 0} categorizados`);
    return json({
      ok:          true,
      banking:     { fetched: bankingRows.length },
      card:        { fetched: cardRows.length },
      categorized: categorized ?? 0,
      period:      { startDate, endDate },
    });
  } catch (err) {
    console.error('[cs-sync] Erro:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
