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
 *   modo=objetos → só o estado (ligado/pausado/reprovado), sem tocar métrica
 *   modo=quemsou → de quem é o token e o que ele enxerga (diagnóstico)
 *
 * O ESTADO VEM DE OUTRO LUGAR QUE O DESEMPENHO
 *
 * `/insights` devolve gasto e conversão, nunca configuração — por isso o
 * dashboard sabia quanto cada anúncio gastou e não sabia se ele estava ligado.
 * O estado mora em três outras arestas (/campaigns, /adsets, /ads) e vai para
 * `meta_objetos`, uma linha por objeto, reescrita a cada rodada.
 *
 * Não dá para deduzir da impressão: medido contra 4 meses, "sem impressão há 2
 * dias = desligado" erra 33,6% das vezes — 252 anúncios ficaram 2+ dias calados
 * e voltaram a rodar, um deles depois de 88 dias. E anúncio reprovado nunca
 * teve impressão, então não tem nem linha em `metricas_meta`: é invisível para
 * qualquer dedução, não apenas mal classificado.
 *
 * Volume: ~31 chamadas de insights por conta por dia, mais 3 de estado por
 * rodada. O sync antigo usava intervalo de 60s, o que dava ~14.400.
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

/**
 * As três arestas de ESTADO, que não são as de insights.
 *
 * `status` é a chave que a pessoa virou (ACTIVE, PAUSED, ARCHIVED).
 * `effective_status` é o estado de verdade, já considerando os pais e a
 * revisão da Meta — um anúncio ACTIVE dentro de um conjunto pausado vem como
 * ADSET_PAUSED, e um reprovado vem como DISAPPROVED. Guardar os dois é o que
 * responde "está ligado e não roda — por quê?".
 *
 * Só o pai DIRETO é gravado. A aresta /ads devolve `campaign_id` também, e
 * guardar os dois seria a primeira armadilha do CLAUDE.md: a campanha do
 * anúncio sai do salto duplo pelo conjunto.
 */
const ESTADO_EDGE: Record<string, { edge: string; campos: string[]; pai: string | null }> = {
  campanha: {
    edge: 'campaigns',
    campos: ['id', 'name', 'status', 'effective_status', 'objective',
             'daily_budget', 'lifetime_budget', 'created_time', 'updated_time'],
    pai: null,
  },
  adset: {
    edge: 'adsets',
    campos: ['id', 'name', 'status', 'effective_status', 'campaign_id',
             'daily_budget', 'lifetime_budget', 'created_time', 'updated_time'],
    pai: 'campaign_id',
  },
  ad: {
    edge: 'ads',
    campos: ['id', 'name', 'status', 'effective_status', 'adset_id',
             'created_time', 'updated_time'],
    pai: 'adset_id',
  },
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

/**
 * Valor do primeiro `action_type` encontrado, na ordem da lista.
 *
 * A Meta devolve a MESMA conversão sob vários rótulos: uma compra aparece
 * simultaneamente como `purchase`, `omni_purchase`,
 * `offsite_conversion.fb_pixel_purchase`, `onsite_web_purchase` e outros — todos
 * com valor idêntico. Somar por "contém purchase" multiplicava o resultado por 8
 * (224 compras onde havia 28). Por isso a busca é exata e para no primeiro acerto.
 */
function valorAcao(lista: unknown, tipos: string[]): number {
  if (!Array.isArray(lista)) return 0;
  for (const tipo of tipos) {
    const achado = (lista as Linha[]).find(i => String(i?.action_type ?? '') === tipo);
    if (achado) return Number(achado.value ?? 0);
  }
  return 0;
}

// Ordem de preferência: o evento do pixel é o mais fiel à configuração da casa;
// os demais servem de fallback caso a conta use outro método de rastreio.
const TIPOS_COMPRA   = ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'];
const TIPOS_CHECKOUT = ['offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout', 'initiate_checkout'];
const TIPOS_CARRINHO = ['offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart', 'add_to_cart'];
const TIPOS_PAGINA   = ['landing_page_view', 'omni_landing_page_view'];

const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Orçamento: a Meta devolve em centavos, como string. */
const centavos = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v) / 100);

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

/**
 * De quem é este token, e o que ele enxerga.
 *
 * Existe porque "conceder permissão ao usuário do sistema" não resolve quando
 * ninguém sabe QUAL usuário do sistema. Em 29/08 duas contas pararam de
 * sincronizar, a atribuição foi conferida no Business Manager e estava lá —
 * num usuário que pode não ser o dono deste token. São várias BMs, cada uma
 * com o seu usuário do sistema: sem saber de quem é o token, a conferência é
 * no lugar errado.
 *
 * NUNCA devolve o token nem parte dele: só a identidade que ele representa e
 * as contas que alcança. O segredo continua sendo segredo.
 */
async function quemSou() {
  /*
    Cada pedaço em `try` próprio.

    O diagnóstico existe justamente para rodar quando algo está errado, então
    um campo que exige permissão que o token não tem — e nem deve ter — não
    pode derrubar a resposta inteira. A primeira versão pedia `business` junto,
    levou 400 por falta de `business_management`, e o erro apagou também a
    identidade, que era exatamente o que se queria saber.
  */
  const tentar = async <T>(f: () => Promise<T>): Promise<T | { erro: string }> => {
    try { return await f(); } catch (e) {
      return { erro: e instanceof Error ? e.message : String(e) };
    }
  };

  const eu = await tentar(async () => {
    const r = await fetch(`${BASE}/me?fields=id,name&access_token=${TOKEN}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
    return { id: j?.id ?? null, nome: j?.name ?? null };
  });

  const contas = await tentar(async () => {
    const { dados } = await buscar(
      `${BASE}/me/adaccounts?fields=account_id,name,account_status&limit=200&access_token=${TOKEN}`,
    );
    return dados.map(c => ({
      account_id: `act_${c.account_id}`,
      nome: c.name,
      status: c.account_status,
    }));
  });

  return {
    usuario_do_token: eu,
    contas_que_o_token_alcanca: Array.isArray(contas) ? contas.length : null,
    contas,
  };
}

/** Converte uma linha de insight da API no formato de `metricas_meta`. */
function normalizar(linha: Linha, contaUuid: string, nivel: string): Linha {
  const acoes = linha.actions;
  const valores = linha.action_values;

  const compras = valorAcao(acoes, TIPOS_COMPRA);
  const receita = valorAcao(valores, TIPOS_COMPRA);
  const checkout = valorAcao(acoes, TIPOS_CHECKOUT);
  const carrinho = valorAcao(acoes, TIPOS_CARRINHO);
  const paginas = valorAcao(acoes, TIPOS_PAGINA);

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

/**
 * O estado atual dos objetos de uma conta.
 *
 * Reescreve `visto_em` em todo objeto que a API confirmou nesta rodada. É o
 * que substitui o gatilho que um espelho de banco teria: objeto que sumiu da
 * API fica com o `visto_em` para trás, e `vw_meta_status` o classifica como
 * "sem_dado" em vez de mostrar um status congelado como se fosse de agora.
 * Sem isso, um anúncio arquivado ficaria eternamente ACTIVE na tela — a quarta
 * armadilha do CLAUDE.md, que já produziu venda órfã em `funil_checkouts`.
 *
 * Não apaga nada: o objeto some da API, não do histórico. `metricas_meta`
 * continua ancorado nele.
 */
async function sincronizarEstado(conta: { id: string; account_id: string }) {
  const agora = new Date().toISOString();
  const porNivel: Record<string, number> = {};

  for (const [nivel, cfg] of Object.entries(ESTADO_EDGE)) {
    const params = new URLSearchParams({
      fields: cfg.campos.join(','),
      limit: '500',
      access_token: TOKEN!,
    });
    const { dados } = await buscar(`${BASE}/${conta.account_id}/${cfg.edge}?${params}`);
    porNivel[nivel] = dados.length;
    if (dados.length === 0) continue;

    const linhas = dados.map(o => ({
      ad_account_id: conta.id,
      nivel,
      objeto_id: String(o.id),
      nome: (o.name as string) ?? null,
      pai_id: cfg.pai && o[cfg.pai] ? String(o[cfg.pai]) : null,
      status: (o.status as string) ?? null,
      effective_status: (o.effective_status as string) ?? null,
      // A API devolve orçamento em centavos, como string.
      orcamento_diario: centavos(o.daily_budget),
      orcamento_total: centavos(o.lifetime_budget),
      objetivo: (o.objective as string) ?? null,
      criado_em_meta: (o.created_time as string) ?? null,
      atualizado_em_meta: (o.updated_time as string) ?? null,
      visto_em: agora,
      atualizado_em: agora,
    }));

    // Em blocos: uma conta grande passa de 800 anúncios num upsert só.
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await supabase.from('meta_objetos')
        .upsert(linhas.slice(i, i + 500), { onConflict: 'ad_account_id,nivel,objeto_id' });
      if (error) throw new Error(`upsert meta_objetos (${nivel}): ${error.message}`);
    }
  }

  return porNivel;
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

    if (modo === 'quemsou') {
      return json({ ok: true, ...(await quemSou()) });
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
    } else if (modo === 'objetos') {
      // Só o estado. Datas não são usadas neste modo — estado é agora, não tem
      // histórico por dia.
      desde = ate = diasAtras(0);
    } else {
      return json({ erro: `modo desconhecido: ${modo}` }, 400);
    }

    // A descoberta roda junto do sync diário para pegar conta nova sem intervenção.
    if (modo === 'recente') await descobrirContas();

    // Só sincroniza conta que a descoberta confirmou existir (`visto_em`). As 10
    // cadastradas à mão antes deste sync não pertencem mais ao portfólio e
    // devolviam 403 a cada execução, poluindo o log e gastando chamada à toa.
    // Filtrar por `visto_em` em vez de mexer em `ativo` preserva o histórico de
    // métricas que ainda está ancorado nelas.
    const { data: contas } = await supabase
      .from('ad_accounts')
      .select('id, account_id, nome')
      .eq('ativo', true)
      .not('visto_em', 'is', null);

    if (!contas || contas.length === 0) {
      return json({
        ok: true,
        aviso: 'nenhuma conta confirmada pela API — rode modo=descobrir primeiro',
        modo,
      });
    }

    const resultado: Linha[] = [];
    for (const conta of contas) {
      try {
        /*
          O estado acompanha todo modo que olha o presente.

          Em `backfill` não: aquele modo reescreve meses de métrica de uma vez,
          e o estado de hoje não tem nada a ver com o que estava ligado em maio.
          Gravá-lo ali só gastaria chamada e daria a impressão de que o histórico
          carrega status.

          O try/catch PRÓPRIO é a parte importante, e a medição mostrou por quê:
          duas das sete contas ("Saponaria" e "Desafios na Sala - TSL") deixam
          ler insights e devolvem 403 nas arestas de objeto — a permissão que o
          dono da conta concedeu cobre uma coisa e não a outra. Sem este catch,
          o throw do estado abortaria a conta inteira e as duas parariam de
          receber MÉTRICA, que é o dado que o dashboard já tinha e do qual
          depende. O estado é um acréscimo: pode faltar, não pode derrubar.

          É o mesmo princípio do catch de fora, uma camada abaixo.
        */
        let estado: Record<string, number> | null = null;
        let erroEstado: string | null = null;
        if (modo !== 'backfill') {
          try {
            estado = await sincronizarEstado(conta);
          } catch (e) {
            erroEstado = e instanceof Error ? e.message : String(e);
          }
        }

        const { linhasGravadas, usoMax } = modo === 'objetos'
          ? { linhasGravadas: 0, usoMax: null }
          : await sincronizarConta(conta, desde, ate);

        const agora = new Date().toISOString();
        await supabase.from('meta_sync_estado').upsert({
          ad_account_id: conta.id,
          // A métrica passou, então o sucesso é real; o erro do estado entra ao
          // lado em vez de apagá-lo. Registrar só um dos dois esconderia metade
          // do que aconteceu.
          ultimo_sucesso: agora,
          ...(erroEstado
            ? { ultimo_erro: agora, mensagem_erro: erroEstado }
            : { mensagem_erro: null }),
          linhas_ultima_execucao: linhasGravadas,
          uso_api_pct: usoMax,
          atualizado_em: agora,
        });
        resultado.push({
          conta: conta.nome, linhas: linhasGravadas, uso_api_pct: usoMax,
          estado, ...(erroEstado ? { estado_erro: erroEstado } : {}),
        });
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
