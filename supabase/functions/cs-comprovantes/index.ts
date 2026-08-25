import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Busca na Conta Simples os comprovantes dos PIX enviados.
 *
 * Ela pediu para guardar o comprovante de pagamento dos PIX, e a primeira
 * conclusao foi que precisaria anexar um a um. Estava errada: o payload traz
 * `showReceipt: true` em 100% dos PIX enviados, e sondando a API achamos
 *
 *   GET /statements/v1/banking/{id}/receipt -> { downloadUrl: "<S3 assinado>" }
 *
 * A Conta Simples gera o PDF sozinha. Ninguem precisa anexar nada -- o trabalho
 * some, que e melhor que o trabalho ficar facil.
 *
 * Os comprovantes entram como `documentos_fiscais` do tipo 'comprovante', e dai
 * pegam carona no espelho do Drive que ja existe.
 */

const env = (n: string) => (Deno.env.get(n) ?? '').trim();
const CS_API_KEY     = env('CS_API_KEY');
const CS_API_SECRET  = env('CS_API_SECRET');
const CS_SYNC_SECRET = env('CS_SYNC_SECRET');
const CS_BASE_URL    = 'https://api.contasimples.com';

/** A borda derruba a requisicao em 150s de ociosidade. Cada comprovante custa
 *  duas chamadas HTTP mais o upload, entao em serie 60 itens estouram o limite
 *  -- foi o que aconteceu na primeira tentativa, com IDLE_TIMEOUT e zero
 *  gravado. Cinco de cada vez cabe bem, e nao castiga a API deles. */
const EM_PARALELO = 5;
/** Teto por invocacao. O que sobrar fica para a proxima: o cron roda todo dia e
 *  a fila drena sozinha, sem precisar de uma rodada heroica. */
const TETO = 40;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function getToken(): Promise<string> {
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
  if (!res.ok) throw new Error(`CS auth [${res.status}]: ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token as string;
}

/** Nome sempre datado e no mesmo formato, com a referencia no fim:
 *  `2026-08-21_Jaqueline-Coelho_83319848_comprovante.pdf`
 *
 *  A referencia entra no NOME tambem porque ha varios PIX ao mesmo destinatario
 *  no mesmo dia -- sem ela, o segundo sobrescreveria o primeiro no Storage. */
function nomeDoArquivo(data: string, descricao: string, referencia: string): string {
  const quem = descricao
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^[\d\s.\-*]{6,}/, '')
    .replace(/[^\w\s-]/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 40) || 'PIX';
  return `${data}_${quem}_${referencia}_comprovante.pdf`;
}

interface Pendente { referencia_externa: string; data: string; descricao: string | null; valor: number }

async function buscarUm(p: Pendente, token: string): Promise<string | null> {
  const r = await fetch(
    `${CS_BASE_URL}/statements/v1/banking/${p.referencia_externa}/receipt`,
    { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'alaskan-dashboard/1.0' } },
  );
  if (!r.ok) return `receipt ${r.status}`;

  const { downloadUrl } = await r.json();
  if (!downloadUrl) return 'sem downloadUrl';

  // A URL do S3 e assinada e expira; baixa-se agora e guarda-se o ARQUIVO, nao o
  // link. Guardar o link daria um comprovante que morre em horas.
  const pdf = await fetch(downloadUrl);
  if (!pdf.ok) return `s3 ${pdf.status}`;
  const bytes = new Uint8Array(await pdf.arrayBuffer());

  const mes = String(p.data).slice(0, 7);
  const nome = nomeDoArquivo(String(p.data), p.descricao ?? '', p.referencia_externa);
  const caminho = `comprovantes/${mes}/${nome}`;

  const { error: erroUp } = await supabase.storage
    .from('documentos').upload(caminho, bytes, { contentType: 'application/pdf', upsert: true });
  if (erroUp) return `storage: ${erroUp.message}`;

  // `referencia_externa` na chave: comprovante e por TRANSACAO, nao por
  // fornecedor/mes como a nota fiscal. Sem ela, o segundo PIX do mes para o
  // mesmo destinatario sobrescrevia o primeiro -- 25 arquivos baixados viraram
  // 10 linhas na primeira rodada, e os PDFs ficaram orfaos.
  const { error: erroLinha } = await supabase.from('documentos_fiscais').upsert({
    competencia: `${mes}-01`,
    fornecedor: (p.descricao ?? 'PIX').slice(0, 120),
    tipo: 'comprovante',
    subtipo: '',
    referencia_externa: p.referencia_externa,
    storage_path: caminho,
    nome_arquivo: nome,
    valor: Math.abs(Number(p.valor)),
  }, { onConflict: 'competencia,fornecedor,tipo,subtipo,referencia_externa' });
  if (erroLinha) return `db: ${erroLinha.message}`;

  await supabase.from('comprovantes_buscados')
    .upsert({ referencia_externa: p.referencia_externa, storage_path: caminho });

  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if ((req.headers.get('x-sync-secret') ?? '').trim() !== CS_SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({})) as { desde?: string; limite?: number };
    const desde = body.desde ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const limite = Math.min(body.limite ?? TETO, TETO);

    const { data: pendentes, error: erroLista } = await supabase
      .from('vw_pix_sem_comprovante')
      .select('referencia_externa, data, descricao, valor')
      .gte('data', desde)
      .limit(limite);
    if (erroLista) throw erroLista;
    if (!pendentes?.length) return json({ ok: true, buscados: 0, nada_a_fazer: true });

    const token = await getToken();
    let buscados = 0;
    const falhas: { id: string; motivo: string }[] = [];

    for (let i = 0; i < pendentes.length; i += EM_PARALELO) {
      const lote = pendentes.slice(i, i + EM_PARALELO) as Pendente[];
      const saidas = await Promise.all(lote.map(async p => {
        try { return { id: p.referencia_externa, motivo: await buscarUm(p, token) }; }
        catch (err) { return { id: p.referencia_externa, motivo: String(err) }; }
      }));
      for (const s of saidas) {
        if (s.motivo) falhas.push({ id: s.id, motivo: s.motivo });
        else buscados++;
      }
    }

    const { count: restam } = await supabase
      .from('vw_pix_sem_comprovante')
      .select('referencia_externa', { count: 'exact', head: true });

    console.log(`[cs-comprovantes] ${buscados} buscados, ${falhas.length} falhas, ${restam ?? '?'} restam`);
    return json({ ok: true, buscados, falhas, restam });
  } catch (err) {
    console.error('[cs-comprovantes] Erro:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
