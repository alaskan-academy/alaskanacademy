import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Chave de integração da Payt — configure em Supabase > Edge Functions > Secrets
const INTEGRATION_KEY = Deno.env.get('PAYT_INTEGRATION_KEY');

/**
 * Onde a Payt pode colocar o identificador da transação.
 *
 * A versão anterior olhava só `transaction_id` e devolvia 400 quando não achava,
 * descartando o corpo junto. Capturando os eventos crus deu para ver que quem
 * caía nesse caso era o `lost_cart` — carrinho abandonado, que não tem transação
 * nenhuma — e não o upsell, como se supôs a princípio.
 *
 * Hoje o corpo é gravado antes de qualquer validação, então mesmo um formato novo
 * fica recuperável em vez de virar um 400 sem rastro.
 */
const CAMINHOS_ID = [
  ['transaction_id'],
  ['transaction', 'id'],
  ['transaction', 'transaction_id'],
  ['transaction', 'code'],
  ['order', 'transaction_id'],
  ['order', 'id'],
  ['order', 'code'],
  ['order_id'],
  ['code'],
  ['id'],
];

function buscar(obj: any, caminho: string[]): string | null {
  let atual = obj;
  for (const parte of caminho) {
    if (atual == null || typeof atual !== 'object') return null;
    atual = atual[parte];
  }
  if (typeof atual === 'string' && atual.trim() !== '') return atual.trim();
  if (typeof atual === 'number') return String(atual);
  return null;
}

function extrairId(body: any): string | null {
  for (const caminho of CAMINHOS_ID) {
    const valor = buscar(body, caminho);
    if (valor) return valor;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const texto = await req.text();

  let body: any;
  try {
    body = JSON.parse(texto);
  } catch {
    // Nem JSON válido: guarda o texto cru para inspeção depois.
    await supabase.from('payt_webhook_raw').insert({
      body: { _corpo_nao_json: texto.slice(0, 20000) },
      motivo: 'corpo não é JSON válido',
    });
    return json({ ok: true, stored: true, skipped: 'invalid json' });
  }

  // A chave é o que separa a Payt de qualquer um: continua sendo 401 e não grava.
  if (INTEGRATION_KEY && body.integration_key !== INTEGRATION_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const payt_id = extrairId(body);

  // Grava o bruto antes de decidir qualquer coisa. A partir daqui nada se perde.
  const { data: bruto, error: erroBruto } = await supabase
    .from('payt_webhook_raw')
    .insert({ payt_id, body })
    .select('id')
    .single();

  if (erroBruto) {
    // Falhou o registro bruto: aí sim devolve erro, para a Payt reenviar.
    console.error('Falha ao gravar payload bruto:', erroBruto.message);
    return json({ error: erroBruto.message }, 500);
  }

  const encerrar = async (motivo: string, processado = false) => {
    await supabase
      .from('payt_webhook_raw')
      .update({ processado, motivo })
      .eq('id', bruto.id);
    return json({ ok: true, stored: true, payt_id, motivo });
  };

  if (body.test === true) return encerrar('pedido de teste', true);

  // `upsell` é uma venda como qualquer outra, só que disparada depois do checkout.
  // O filtro antigo aceitava apenas `order` e descartava esses eventos em silêncio,
  // com 200 — foi assim que 46 vendas de agosto, R$ 10.220,70, nunca chegaram.
  if (body.type !== 'order' && body.type !== 'upsell') {
    return encerrar(`tipo de evento: ${body.type}`);
  }

  // Carrinho abandonado não é venda: chega como `order` mas sem transação nenhuma.
  // Era ele que provocava os 400 do webhook antigo, não o upsell.
  if (body.status === 'lost_cart') return encerrar('carrinho abandonado', true);

  if (!payt_id) return encerrar('não achei o id da transação no payload');

  // Data: usa paid_at quando disponível, senão updated_at
  const rawDate: string =
    body.transaction?.paid_at ||
    body.updated_at ||
    body.started_at ||
    '';
  const data = rawDate.slice(0, 10) || null;

  /**
   * Valor: centavos → reais.
   *
   * A Payt zera `total_price` ao estornar. A versão anterior tratava isso com uma
   * escada de alternativas que terminava no **preço de tabela do produto** — e era ela
   * que ganhava, sobrescrevendo o valor real da compra. A conferência de 21/08 contra
   * o relatório da Payt pegou: 7 dos 14 reembolsos de agosto viraram R$ 67,00, o preço
   * de lista, no lugar dos R$ 66,33 com desconto do Pix, dos R$ 60,30 com cupom e dos
   * R$ 123,65 que incluíam um order bump.
   *
   * A regra agora é outra: **estorno muda o status da venda, não o quanto ela custou.**
   * Só grava valor quando ele vem da transação de verdade; se não vier, mantém o que já
   * está gravado, e o preço de tabela só entra se a venda for nova e não houver nada.
   */
  const emReais = (c: unknown) => (typeof c === 'number' && c > 0 ? c / 100 : null);

  const valorDaTransacao =
    emReais(body.transaction?.total_price) ??
    emReais(body.transaction?.price_without_installments) ??
    emReais(body.transaction?.price);

  const valorDeTabela = emReais(body.product?.price) ?? emReais(body.total_price);

  let valor: number;
  if (valorDaTransacao !== null) {
    valor = valorDaTransacao;
  } else {
    const { data: jaGravado } = await supabase
      .from('vendas_payt')
      .select('valor')
      .eq('payt_id', payt_id)
      .maybeSingle();
    valor = jaGravado?.valor ?? valorDeTabela ?? 0;
  }

  const status: string = body.status ?? 'unknown';

  // Produto principal
  const produto: string | null =
    body.product?.name ?? body.products?.[0]?.name ?? null;

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

  // O upsell se identifica de duas formas no payload: pelo `type` do evento e pelo
  // `upsell_code`. Guardar aqui elimina a heurística de "segunda compra do mesmo
  // cliente em 30 min", que marcava compra dupla legítima como upsell.
  const tipo_venda =
    body.type === 'upsell' || (typeof body.upsell_code === 'string' && body.upsell_code.trim() !== '')
      ? 'Upsell'
      : 'Venda Direta';

  // Upsert por payt_id — se a Payt reenviar (ex: reembolso), atualiza o status
  const { error } = await supabase.from('vendas_payt').upsert(
    {
      payt_id,
      data,
      valor,
      status,
      produto,
      tipo_venda,
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
    await supabase
      .from('payt_webhook_raw')
      .update({ motivo: `erro ao gravar venda: ${error.message}` })
      .eq('id', bruto.id);
    return json({ error: error.message }, 500);
  }

  await supabase
    .from('payt_webhook_raw')
    .update({ processado: true })
    .eq('id', bruto.id);

  return json({ ok: true, payt_id, status, utm_content });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
