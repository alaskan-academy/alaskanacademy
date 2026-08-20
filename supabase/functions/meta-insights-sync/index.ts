import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Sincroniza insights da Meta Marketing API.
 *
 * Só lê: o token deve ter apenas `ads_read`. Com esse escopo é impossível esta
 * função pausar anúncio, alterar orçamento ou mexer em campanha, mesmo se tiver bug.
 *
 * Cadência pensada pela janela de atribuição, não por limite de API. O Meta
 * reatribui conversões retroativamente (7 dias de clique), então o dado de hoje
 * ainda se move e o de D-7 já está firme:
 *
 *   modo=hoje    → dia corrente, de hora em hora
 *   modo=recente → D-1 a D-7 uma vez por dia, captura as correções de atribuição
 *   modo=backfill&desde=&ate= → carga histórica
 *   modo=descobrir → só reconcilia a lista de contas
 *
 * Volume: ~31 chamadas por conta por dia. O sync antigo usava intervalo de 60s,
 * o que dava ~14.400.
 */

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TOKEN = Deno.env.get('META_ACCESS_TOKEN');
// A Meta lança versão nova a cada trimestre e aposenta as antigas em ~2 anos.
// Deixar em variável evita ter que editar código para subir.
const API = Deno.env.get('META_API_VERSION') ?? 'v21.0';
const BASE = `https://graph.facebook.com/${API}`;

/** Campos pedidos à API. Pedir só o necessário reduz o custo por chamada. */
const CAMPOS = [
  'date_start',
  'campaign_id', 'campaign_name',
  'adset_id', 'adset_name',
  'ad_id', 'ad_name',
  'spend', 'impressions', 'reach', 'frequency',
  'clicks', 'inline_link_clicks', 'ctr', 'inline_link_click_ctr',
  'cpm', 'cpc', 'cost_per_unique_click',
  'actions', 'action_values',
  'video_play_actions',
  'video_p75_watched_actions',
  'video_p100_watched_actions',
].join(',');

const NIVEL_API: Record<string, string> = {
  campanha: 'campaign',
  adset: 'adset',
  ad: 'ad',
};

type Linha = Record<string, unknown>;

// Permite disparo manual a partir do painel (botão "sincronizar agora"), além do cron.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/** Soma os valores de um array de actions cujo tipo casa com o predicado. */
function somaAcoes(lista: unknown, casa: (tipo: string) => boolean): number {
  if (!Array.isArray(lista)) return 0;
  let total = 0;
  for (const item of lista as Linha[]) {
    const tipo = String(item?.action_type ?? '');
    if (casa(tipo)) total += Number(item?.value ?? 0);
  }
  return total;
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * Chama a Graph API com backoff. O erro 17 (rate limit) e o 613 (throttle) pedem
 * espera; os demais não melhoram com repetição e sobem na hora.
 */
async function buscar(url: string, tentativa = 0): Promise<{ dados: Linha[]; usoPct: number | null }> {
  const resp = await fetch(url);
  const usoHeader = resp.headers.get('x-business-use-case-usage');
  let usoPct: number | null = null;
  if (usoHeader) {
    try {
      const uso = JSON.parse(usoHeader) as Record<string, Array<Record<string, number>>>;
      for (const entradas of Object.values(uso)) {
        for (const e of entradas) {
          usoPct = Math.max(
            usoPct ?? 0,
            e.call_count ?? 0, e.total_cputime ?? 0, e.total_time ?? 0,
          );
        }
      }
    } catch { /* header malformado não deve derrubar o sync */ }
  }

  const corpo = await resp.json();

  if (!resp.ok) {
    const codigo = corpo?.error?.code;
    const recuperavel = codigo === 17 || codigo === 4 || codigo === 613 || resp.status >= 500;
    if (recuperavel && tentativa < 4) {
      const espera = 2 ** tentativa * 5000;
      await new Promise(r => setTimeout(r, espera));
      return buscar(url, tentativa + 1);
    }
    throw new Error(`Meta API ${resp.status} (code ${codigo}): ${corpo?.error?.message ?? 'sem detalhe'}`);
  }

  let dados = (corpo.data ?? []) as Linha[];
  // Paginação: contas grandes retornam várias páginas por dia/nível.
  let proxima = corpo.paging?.next as string | undefined;
  let paginas = 0;
  while (proxima && paginas < 25) {
    const r = await fetch(proxima);
    const c = await r.json();
    if (!r.ok) break;
    dados = dados.concat((c.data ?? []) as Linha[]);
    proxima = c.paging?.next;
    paginas++;
  }

  return { dados, usoPct };
}

/** Descobre as contas do Business e reconcilia com `ad_accounts`. */
async function descobrirContas() {
  const url = `${BASE}/me/adaccounts?fields=account_id,name,account_status,currency&limit=200&access_token=${TOKEN}`;
  const { dados } = await buscar(url);

  const agora = new Date().toISOString();
  const vistos: string[] = [];

  for (const c of dados) {
    const accountId = `act_${c.account_id}`;
    vistos.push(accountId);

    const { data: existente } = await supabase
      .from('ad_accounts')
      .select('id, descoberto_em')
      .eq('account_id', accountId)
      .maybeSingle();

    const campos = {
      account_id: accountId,
      nome: String(c.name ?? accountId),
      status_meta: String(c.account_status ?? ''),
      moeda: String(c.currency ?? ''),
      visto_em: agora,
      atualizado_em: agora,
    };

    if (existente) {
      // Não mexe em `ativo`, `funil_id` nem `produto_payt`: são decisão de quem
      // configurou, não da API.
      await supabase.from('ad_accounts').update(campos).eq('id', existente.id);
    } else {
      await supabase.from('ad_accounts').insert({ ...campos, descoberto_em: agora, ativo: true });
    }
  }

  return { contas_na_api: dados.length, ids: vistos };
}

/** Converte uma linha de insight da API no formato de `metricas_meta`. */
function normalizar(linha: Linha, contaUuid: string, nivel: string): Linha {
  const acoes = linha.actions;
  const valores = linha.action_values;

  const compras = somaAcoes(acoes, t => t.includes('purchase'));
  const receita = somaAcoes(valores, t => t.includes('purchase'));
  const checkout = somaAcoes(acoes, t => t.includes('initiate_checkout'));
  const carrinho = somaAcoes(acoes, t => t.includes('add_to_cart'));
  const paginas = somaAcoes(acoes, t => t === 'landing_page_view');

  const plays = somaAcoes(linha.video_play_actions, () => true);
  const p75 = somaAcoes(linha.video_p75_watched_actions, () => true);
  const p100 = somaAcoes(linha.video_p100_watched_actions, () => true);
  // O Meta removeu video_3_sec_watched_actions dos campos padrão; `video_view`
  // dentro de actions é o equivalente que segue disponível.
  const v3s = somaAcoes(acoes, t => t === 'video_view');

  const impressoes = Number(linha.impressions ?? 0);
  const investimento = Number(linha.spend ?? 0);

  return {
    data: linha.date_start,
    ad_account_id: contaUuid,
    nivel,
    campanha_id: linha.campaign_id ?? null,
    campanha_nome: linha.campaign_name ?? null,
    adset_id: linha.adset_id ?? null,
    adset_nome: linha.adset_name ?? null,
    ad_id: linha.ad_id ?? null,
    ad_nome: linha.ad_name ?? null,
    impressoes,
    alcance: num(linha.reach),
    frequencia: num(linha.frequency),
    cliques: num(linha.clicks),
    cliques_link: num(linha.inline_link_clicks),
    ctr: num(linha.ctr),
    ctr_link: num(linha.inline_link_click_ctr),
    cpm: num(linha.cpm),
    cpc: num(linha.cpc),
    cpp: num(linha.cost_per_unique_click),
    video_plays: plays || null,
    video_3s: v3s || null,
    video_75pct: p75 || null,
    video_100pct: p100 || null,
    taxa_video_3s: impressoes > 0 && v3s ? (v3s / impressoes) * 100 : null,
    taxa_video_75pct: plays > 0 && p75 ? (p75 / plays) * 100 : null,
    taxa_video_compra: p75 > 0 && compras ? (compras / p75) * 100 : null,
    visualizacoes_pagina: paginas || null,
    initiate_checkout: checkout || null,
    add_to_cart: carrinho || null,
    compras_meta: compras || null,
    investimento,
    faturamento_atribuido: receita || null,
    atualizado_em: new Date().toISOString(),
  };
}

/** Sincroniza um intervalo de datas para uma conta, nos três níveis. */
async function sincronizarConta(
  conta: { id: string; account_id: string; nome: string },
  desde: string,
  ate: string,
) {
  let linhasGravadas = 0;
  let usoMax: number | null = null;

  for (const [nivel, nivelApi] of Object.entries(NIVEL_API)) {
    // time_increment=1 devolve o intervalo quebrado por dia numa chamada só,
    // em vez de uma chamada por dia.
    const params = new URLSearchParams({
      level: nivelApi,
      time_increment: '1',
      time_range: JSON.stringify({ since: desde, until: ate }),
      fields: CAMPOS,
      limit: '500',
      access_token: TOKEN!,
    });

    const { dados, usoPct } = await buscar(`${BASE}/${conta.account_id}/insights?${params}`);
    if (usoPct !== null) usoMax = Math.max(usoMax ?? 0, usoPct);
    if (dados.length === 0) continue;

    const brutos = dados.map(l => ({
      ad_account_id: conta.id,
      data: l.date_start,
      nivel,
      objeto_id: String(l.ad_id ?? l.adset_id ?? l.campaign_id ?? 'conta'),
      payload: l,
    }));
    await supabase.from('meta_insights_raw')
      .upsert(brutos, { onConflict: 'ad_account_id,data,nivel,objeto_id' });

    const normalizadas = dados
      .map(l => normalizar(l, conta.id, nivel))
      // metricas_meta exige campanha_id
      .filter(l => l.campanha_id);

    if (normalizadas.length > 0) {
      const { error } = await supabase.from('metricas_meta')
        .upsert(normalizadas, { onConflict: 'data,ad_account_id,nivel,campanha_id_key,adset_id_key,ad_id_key' });
      if (error) throw new Error(`upsert metricas_meta (${nivel}): ${error.message}`);
      linhasGravadas += normalizadas.length;
    }
  }

  return { linhasGravadas, usoMax };
}

function diasAtras(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (!TOKEN) {
    return json({
      erro: 'META_ACCESS_TOKEN não configurado',
      comoResolver: 'Business Manager > Usuários do Sistema > gerar token com ads_read, '
        + 'e cadastrar como secret META_ACCESS_TOKEN nas Edge Functions',
    }, 503);
  }

  const url = new URL(req.url);
  const modo = url.searchParams.get('modo') ?? 'hoje';

  try {
    if (modo === 'descobrir') {
      return json({ ok: true, ...(await descobrirContas()) });
    }

    let desde: string, ate: string;
    if (modo === 'hoje') {
      desde = ate = diasAtras(0);
    } else if (modo === 'recente') {
      // Janela de atribuição: o Meta ainda credita conversões a até 7 dias atrás.
      desde = diasAtras(7);
      ate = diasAtras(1);
    } else if (modo === 'backfill') {
      desde = url.searchParams.get('desde') ?? diasAtras(30);
      ate = url.searchParams.get('ate') ?? diasAtras(1);
    } else {
      return json({ erro: `modo desconhecido: ${modo}` }, 400);
    }

    // A descoberta roda junto do sync diário para pegar conta nova sem intervenção.
    if (modo === 'recente') await descobrirContas();

    const { data: contas } = await supabase
      .from('ad_accounts')
      .select('id, account_id, nome')
      .eq('ativo', true);

    if (!contas || contas.length === 0) {
      return json({ ok: true, aviso: 'nenhuma conta ativa em ad_accounts', modo });
    }

    const resultado: Linha[] = [];
    for (const conta of contas) {
      try {
        const { linhasGravadas, usoMax } = await sincronizarConta(conta, desde, ate);
        await supabase.from('meta_sync_estado').upsert({
          ad_account_id: conta.id,
          ultimo_sucesso: new Date().toISOString(),
          mensagem_erro: null,
          linhas_ultima_execucao: linhasGravadas,
          uso_api_pct: usoMax,
          atualizado_em: new Date().toISOString(),
        });
        resultado.push({ conta: conta.nome, linhas: linhasGravadas, uso_api_pct: usoMax });
      } catch (e) {
        // Uma conta com problema não pode impedir a sincronização das outras.
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from('meta_sync_estado').upsert({
          ad_account_id: conta.id,
          ultimo_erro: new Date().toISOString(),
          mensagem_erro: msg,
          atualizado_em: new Date().toISOString(),
        });
        resultado.push({ conta: conta.nome, erro: msg });
      }
    }

    return json({ ok: true, modo, periodo: { desde, ate }, contas: resultado });
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
