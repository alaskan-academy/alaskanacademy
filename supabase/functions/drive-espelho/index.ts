import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Espelha no Drive o documento que já está no Storage.
 *
 * O Storage é a fonte: privado, com RLS por dono, e é de onde a tela lê. O Drive
 * é a cópia para a contabilidade, que trabalha lá e não vai entrar no dashboard.
 *
 * A estrutura é uma pasta com três subpastas, como ela pediu:
 *
 *   Documentos Fiscais Alaskan/
 *     ferramentas/2026-08/2026-08_ElevenLabs_invoice.pdf
 *     servicos/2026-08/2026-08_Jaqueline-Coelho_NF.pdf
 *     comprovantes/2026-08/…
 *
 * As pastas são criadas sob demanda e o id fica guardado em `drive_pastas`:
 * procurar por nome a cada upload custaria duas chamadas e criaria pasta
 * duplicada em duas execuções simultâneas.
 */

const GOOGLE_SERVICE_ACCOUNT = Deno.env.get('GOOGLE_SERVICE_ACCOUNT')!;
const DRIVE_SYNC_SECRET      = Deno.env.get('DRIVE_SYNC_SECRET')!;
/** Pasta raiz compartilhada com a conta de serviço. Sem ela o upload vai para o
 *  Drive da própria conta de serviço, que ninguém consegue abrir. */
const DRIVE_PASTA_RAIZ       = Deno.env.get('DRIVE_PASTA_RAIZ')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const toSign = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;

  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${toSign}.${sigB64}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google token error: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

/** Devolve o id da pasta, criando-a se preciso. O id fica em cache no banco. */
async function garantirPasta(token: string, caminho: string, paiId: string): Promise<string> {
  const { data: cache } = await supabase
    .from('drive_pastas').select('drive_id').eq('caminho', caminho).maybeSingle();
  if (cache?.drive_id) return cache.drive_id;

  const nome = caminho.split('/').pop()!;
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: nome,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [paiId],
    }),
  });
  const criada = await res.json();
  if (!criada.id) throw new Error(`Drive folder error: ${JSON.stringify(criada)}`);

  await supabase.from('drive_pastas').insert({ caminho, drive_id: criada.id });
  return criada.id as string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (req.headers.get('x-sync-secret') !== DRIVE_SYNC_SECRET) return json({ error: 'Unauthorized' }, 401);

  try {
    const { documento_id } = await req.json() as { documento_id?: string };
    if (!documento_id) return json({ error: 'documento_id obrigatório' }, 400);

    const { data: doc, error: erroDoc } = await supabase
      .from('documentos_fiscais')
      .select('id, tipo, competencia, nome_arquivo, storage_path, drive_url')
      .eq('id', documento_id)
      .single();
    if (erroDoc || !doc) return json({ error: 'Documento não encontrado' }, 404);
    if (!doc.storage_path) return json({ error: 'Documento sem arquivo' }, 400);
    // Já espelhado: reenviar criaria uma segunda cópia no Drive, e a
    // contabilidade veria a mesma nota duas vezes.
    if (doc.drive_url) return json({ ok: true, ja_existia: true, drive_url: doc.drive_url });

    const sa = JSON.parse(GOOGLE_SERVICE_ACCOUNT) as Record<string, string>;
    const token = await getGoogleAccessToken(sa);

    const pasta = doc.tipo === 'servico' ? 'servicos'
                : doc.tipo === 'comprovante' ? 'comprovantes'
                : 'ferramentas';
    const mes = String(doc.competencia).slice(0, 7);

    const idTipo = await garantirPasta(token, pasta, DRIVE_PASTA_RAIZ);
    const idMes  = await garantirPasta(token, `${pasta}/${mes}`, idTipo);

    const { data: arquivo, error: erroArq } = await supabase.storage
      .from('documentos').download(doc.storage_path);
    if (erroArq || !arquivo) throw new Error(`Storage: ${erroArq?.message ?? 'arquivo vazio'}`);

    // Upload multipart: metadados e conteúdo na mesma chamada. Em duas chamadas,
    // uma falha no meio deixaria arquivo vazio no Drive.
    const limite = `-------${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name: doc.nome_arquivo, parents: [idMes] });
    const bytes = new Uint8Array(await arquivo.arrayBuffer());

    const cabeca = new TextEncoder().encode(
      `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${limite}\r\nContent-Type: ${arquivo.type || 'application/octet-stream'}\r\n\r\n`,
    );
    const cauda = new TextEncoder().encode(`\r\n--${limite}--`);
    const corpo = new Uint8Array(cabeca.length + bytes.length + cauda.length);
    corpo.set(cabeca, 0);
    corpo.set(bytes, cabeca.length);
    corpo.set(cauda, cabeca.length + bytes.length);

    const envio = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${limite}`,
        },
        body: corpo,
      },
    );
    const enviado = await envio.json();
    if (!enviado.id) throw new Error(`Drive upload error: ${JSON.stringify(enviado)}`);

    const url = enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`;
    await supabase.from('documentos_fiscais').update({ drive_url: url }).eq('id', doc.id);

    console.log(`[drive-espelho] ${doc.nome_arquivo} → ${pasta}/${mes}`);
    return json({ ok: true, drive_url: url, pasta: `${pasta}/${mes}` });
  } catch (err) {
    console.error('[drive-espelho] Erro:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
