import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CS_SYNC_SECRET = Deno.env.get('CS_SYNC_SECRET')!;

/**
 * Uma conta bancária por empresa, e o NOME do segredo diz de quem ela é.
 *
 *   CS_API_KEY / CS_API_SECRET                → alaskan (os que já existiam)
 *   CS_API_KEY_<SLUG> / CS_API_SECRET_<SLUG>  → o `slug` correspondente
 *
 * Mesmo padrão das chaves da Payt. Empresa nova é um par de segredos novo, sem
 * tocar em código — o contrário da lista escrita à mão que envelhece calada.
 *
 * POR QUE ISSO IMPORTA MAIS AQUI DO QUE PARECE
 *
 * `transacoes` carrega `empresa_id` carimbado, e o extrato bancário é o ÚNICO
 * lugar que sabe de quem é a transação: não há projeto, funil nem conta de
 * anúncio para derivar. Se esta função gravasse sem carimbo, toda madrugada
 * nasceriam transações sem dono — e elas apareceriam nas duas empresas ou em
 * nenhuma, conforme o filtro.
 */
interface ContaCS {
  slug: string;
  key: string;
  secret: string;
}

const PREFIXO_KEY = 'CS_API_KEY_';

function contasConfiguradas(): ContaCS[] {
  const achadas: ContaCS[] = [];

  /* A dupla histórica é lida DIRETO, e não pela varredura: se `toObject()`
     falhasse, a lista viria vazia e o sync não faria nada em silêncio. */
  const k = Deno.env.get('CS_API_KEY');
  const s = Deno.env.get('CS_API_SECRET');
  if (k && s) achadas.push({ slug: 'alaskan', key: k, secret: s });

  try {
    for (const nome of Object.keys(Deno.env.toObject())) {
      if (!nome.startsWith(PREFIXO_KEY)) continue;
      const sufixo = nome.slice(PREFIXO_KEY.length);
      const chave  = Deno.env.get(nome);
      const segredo = Deno.env.get('CS_API_SECRET_' + sufixo);
      if (chave && segredo) {
        achadas.push({ slug: sufixo.toLowerCase(), key: chave, secret: segredo });
      } else {
        /* Meia credencial é pior que nenhuma: some sem erro. */
        console.error('[cs-sync] ' + nome + ' existe mas CS_API_SECRET_' + sufixo + ' não — conta ignorada');
      }
    }
  } catch (e) {
    console.error('[cs-sync] não consegui varrer os segredos:', e);
  }

  return achadas;
}

const CS_BASE_URL = 'https://api.contasimples.com';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function getAccessToken(conta: ContaCS): Promise<string> {
  const basic = btoa(`${conta.key}:${conta.secret}`);
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
      /* A chave e (fonte, referencia_externa), e nao a referencia sozinha: o id
         externo so e unico DENTRO do banco que o emitiu. Com contas do Inter e
         do C6 entrando, um id numerico coincidente com um da Conta Simples faria
         o `ignoreDuplicates` descartar a transacao em silencio — sem erro, sem
         linha, e o DRE fechando com um numero plausivel. Ver 20260901j. */
      .upsert(chunk, { onConflict: 'fonte,referencia_externa', ignoreDuplicates: true });
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

  const contas = contasConfiguradas();
  if (contas.length === 0) {
    return json({
      erro: 'nenhuma conta da Conta Simples configurada',
      comoResolver: 'Cadastre CS_API_KEY e CS_API_SECRET nas Edge Functions. '
        + 'Uma empresa a mais e um par a mais: CS_API_KEY_<SLUG> e CS_API_SECRET_<SLUG>, '
        + 'com o mesmo <slug> da tabela `empresas`.',
    }, 503);
  }

  /* slug → id da empresa. Uma consulta para todas as contas: a lista tem duas
     linhas e vai ter três. */
  const { data: linhasEmpresa } = await supabase.from('empresas').select('id,slug');
  const idPorSlug = new Map(
    (linhasEmpresa ?? []).map((e: Record<string, unknown>) => [String(e.slug), String(e.id)]),
  );

  const porConta: Record<string, unknown>[] = [];
  const paraGravar: { ref: string; payload: unknown }[] = [];
  let totalBanking = 0;
  let totalCard = 0;

  try {
  for (const conta of contas) {
   try {
    /*
      Sem empresa cadastrada para este slug a transação entra SEM dono, e
      aparece em `vw_dinheiro_sem_empresa`. Recusar o extrato inteiro por
      causa de um cadastro faltando seria perder movimento bancário — que é
      justamente o que não se recupera depois.
    */
    const empresaId = idPorSlug.get(conta.slug) ?? null;
    if (!empresaId) {
      console.error('[cs-sync] sem empresa com slug "' + conta.slug + '" — transações entram sem dono');
    }

    /*
      A referência da conta histórica NÃO muda de formato.

      Ela é PARTE da chave de deduplicação (`onConflict: fonte,referencia_externa`), e
      prefixá-la agora faria as 1.238 linhas da Alaskan serem reimportadas
      como novas. Conta nova ganha o prefixo, porque o id da Conta Simples só
      é garantidamente único DENTRO de uma conta.
    */
    const ref = (bruto: string) => conta.slug === 'alaskan' ? bruto : conta.slug + '_' + bruto;

    const token = await getAccessToken(conta);

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
          referencia_externa: ref(String(tx['id'])),
          empresa_id: empresaId,
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
          referencia_externa: ref('card_' + String(tx['id'])),
          empresa_id: empresaId,
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

    totalBanking += bankingRows.length;
    totalCard    += cardRows.length;

    /*
      O estado da conta fica REGISTRADO, e não só no retorno desta chamada.

      Credencial recusada não produz dado velho — produz dado NENHUM, e
      ausência não dispara alarme de defasagem. Foi assim que o 401 da Aeliss
      ficou invisível para o painel de saúde, que só olhava a idade do que
      existe. `cs_sync_estado` é o espelho de `meta_sync_estado`, e é dele que
      `vw_ingest_health` tira a resposta para "a credencial funciona?".
    */
    await supabase.from('cs_sync_estado').upsert({
      slug: conta.slug,
      empresa_id: empresaId,
      ultimo_sucesso: new Date().toISOString(),
      mensagem_erro: null,
      linhas_ultima_execucao: bankingRows.length + cardRows.length,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'slug' });
    porConta.push({
      conta: conta.slug,
      empresa: empresaId ? conta.slug : null,
      banking: bankingRows.length,
      card: cardRows.length,
      ...(empresaId ? {} : { aviso: 'sem empresa cadastrada para este slug' }),
    });

    // ── 3b. Payload nas linhas que já existiam
    // O upsert acima usa `ignoreDuplicates`, que é o que protege
    // `status_revisao` de voltar para "pendente" em transação já revisada. O
    // efeito colateral é que linha antiga nunca recebia `payload_raw`: depois
    // do primeiro sync, 1.120 transações tinham payload em exatamente uma.
    // Esta passada escreve só aquela coluna.
    paraGravar.push(...[...bankingRows, ...cardRows].map(r => ({
      ref:     r.referencia_externa,
      payload: r.payload_raw,
    })));
   } catch (e) {
    /* Uma conta com problema não pode impedir a outra de sincronizar — mesmo
       princípio do catch por conta no sync da Meta. */
    console.error('[cs-sync] conta ' + conta.slug + ':', e);
    /* `ultimo_sucesso` fica FORA deste upsert: sobrescrevê-lo apagaria a
       memória de quando a conta funcionou pela última vez, que é o que separa
       "quebrou agora" de "nunca funcionou". */
    await supabase.from('cs_sync_estado').upsert({
      slug: conta.slug,
      empresa_id: idPorSlug.get(conta.slug) ?? null,
      ultimo_erro: new Date().toISOString(),
      mensagem_erro: String(e),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'slug' });
    porConta.push({ conta: conta.slug, erro: String(e) });
   }
  }

    let payloadsGravados = 0;
    for (let i = 0; i < paraGravar.length; i += 200) {
      const { data, error } = await supabase.rpc('fn_gravar_payloads', {
        p_linhas: paraGravar.slice(i, i + 200),
      });
      if (error) console.warn('[cs-sync] payload_raw falhou:', error.message);
      else payloadsGravados += Number(data ?? 0);
    }

    // ── 4. Auto-categorização via regras_categoria
    const { data: categorized, error: catError } = await supabase.rpc('aplicar_regras_categoria');
    if (catError) console.warn('[cs-sync] Auto-categorização falhou:', catError.message);

    console.log('[cs-sync] OK: ' + contas.length + ' conta(s), ' + totalBanking + ' banking, '
      + totalCard + ' cartão, ' + (categorized ?? 0) + ' categorizados, ' + payloadsGravados + ' payloads');
    return json({
      ok:          true,
      contas:      porConta,
      banking:     { fetched: totalBanking },
      card:        { fetched: totalCard },
      categorized: categorized ?? 0,
      payloads:    payloadsGravados,
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
