import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Espelha no Drive o documento que ja esta no Storage, e apaga a copia quando o
 * original some.
 *
 * O Storage e a fonte: privado, com RLS por dono, e e de onde a tela le. O Drive
 * e a copia para a contabilidade, que trabalha la e nao vai entrar no dashboard.
 *
 * Estrutura, uma pasta com tres subpastas e um nivel de mes:
 *   ferramentas/2026-08/2026-08_ElevenLabs_invoice.pdf
 *   servicos/2026-08/2026-08_Jaqueline-Coelho_NF.pdf
 *   comprovantes/2026-08/2026-08-21_Jaqueline-Coelho_83319848_comprovante.pdf
 */

/** `.trim()` em tudo: colar um segredo no painel traz quebra de linha junto com
 *  frequencia, e foi exatamente o que aconteceu na primeira configuracao -- 65
 *  caracteres onde deviam ser 64, e todo espelho morria em 401. */
const env = (nome: string) => (Deno.env.get(nome) ?? '').trim();

const GOOGLE_SERVICE_ACCOUNT = env('GOOGLE_SERVICE_ACCOUNT');
const DRIVE_SYNC_SECRET      = env('DRIVE_SYNC_SECRET');
/** Pasta raiz compartilhada com a conta de servico. Sem ela o upload vai para o
 *  Drive da propria conta de servico, que ninguem consegue abrir. */
const DRIVE_PASTA_RAIZ       = env('DRIVE_PASTA_RAIZ');

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
    scope: 'https://www.googleapis.com/auth/drive',
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

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Devolve o id da pasta, criando-a se preciso.
 *
 * Quem cria e decidido pelo BANCO, nao por cada worker. A versao anterior fazia
 * "consulta o cache, nao acha, cria no Drive, insere no cache", e com cinco
 * downloads em paralelo os cinco passavam pela consulta antes de qualquer
 * insercao: todos criavam a pasta, e quatro insercoes falhavam em silencio
 * porque o erro nao era verificado. Resultado real: TRES pastas "comprovantes"
 * no Drive com os arquivos espalhados entre elas.
 *
 * Agora `fn_reservar_pasta` insere a linha com id nulo. Quem conseguiu inserir
 * ganhou o direito de criar; quem perdeu espera o vencedor preencher.
 */
async function garantirPasta(token: string, caminho: string, paiId: string): Promise<string> {
  const { data: cache } = await supabase
    .from('drive_pastas').select('drive_id').eq('caminho', caminho).maybeSingle();
  if (cache?.drive_id) return cache.drive_id;

  const { data: ganhou } = await supabase.rpc('fn_reservar_pasta', { p_caminho: caminho });

  if (!ganhou) {
    // Outro worker esta criando. Espera ele preencher, com teto para nao ficar
    // preso caso ele tenha morrido no meio.
    for (let i = 0; i < 30; i++) {
      await dormir(400);
      const { data } = await supabase
        .from('drive_pastas').select('drive_id').eq('caminho', caminho).maybeSingle();
      if (data?.drive_id) return data.drive_id;
    }
    throw new Error(`Timeout esperando a pasta ${caminho} ser criada por outro processo`);
  }

  const nome = caminho.split('/').pop()!;
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: nome,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [paiId],
    }),
  });
  const criada = await res.json();
  if (!criada.id) {
    // Solta a reserva: mantida, ela travaria todos os proximos para sempre.
    await supabase.from('drive_pastas').delete().eq('caminho', caminho);
    throw new Error(`Drive folder error: ${JSON.stringify(criada)}`);
  }

  await supabase.from('drive_pastas').update({ drive_id: criada.id }).eq('caminho', caminho);
  return criada.id as string;
}

Deno.serve(async (req) => {
  // Diagnostico: diz o que esta configurado sem devolver nenhum valor de
  // segredo. Existe porque "401 Unauthorized" nao distingue segredo errado de
  // segredo ausente, e sem isso a investigacao vira adivinhacao.
  if (req.method === 'GET') {
    const pontas = (s: string) => s.length >= 8 ? `${s.slice(0, 4)}...${s.slice(-4)}` : '(curto demais)';
    let email = null;
    try { email = JSON.parse(GOOGLE_SERVICE_ACCOUNT || '{}').client_email ?? null; } catch { /* ignora */ }
    return json({
      DRIVE_SYNC_SECRET: { configurado: Boolean(DRIVE_SYNC_SECRET), tamanho: DRIVE_SYNC_SECRET.length, pontas: pontas(DRIVE_SYNC_SECRET) },
      DRIVE_PASTA_RAIZ:  { configurado: Boolean(DRIVE_PASTA_RAIZ), valor: DRIVE_PASTA_RAIZ },
      GOOGLE_SERVICE_ACCOUNT: { configurado: Boolean(GOOGLE_SERVICE_ACCOUNT), client_email: email },
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!DRIVE_SYNC_SECRET) return json({ error: 'DRIVE_SYNC_SECRET nao configurado na funcao' }, 500);
  if ((req.headers.get('x-sync-secret') ?? '').trim() !== DRIVE_SYNC_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const corpoReq = await req.json() as { documento_id?: string; acao?: string; drive_id?: string; lote?: number };

    // ── Apagar a copia ──────────────────────────────────────────────────────
    if (corpoReq.acao === 'apagar') {
      if (!corpoReq.drive_id) return json({ error: 'drive_id obrigatorio' }, 400);
      const sa = JSON.parse(GOOGLE_SERVICE_ACCOUNT) as Record<string, string>;
      const token = await getGoogleAccessToken(sa);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${corpoReq.drive_id}?supportsAllDrives=true`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      // 404 e sucesso para o nosso proposito: o que se queria e que nao exista.
      if (!res.ok && res.status !== 404) {
        throw new Error(`Drive delete error [${res.status}]: ${await res.text()}`);
      }
      console.log(`[drive-espelho] apagado ${corpoReq.drive_id}`);
      return json({ ok: true, apagado: corpoReq.drive_id });
    }

    if (!DRIVE_PASTA_RAIZ) throw new Error('DRIVE_PASTA_RAIZ nao configurado');
    const sa = JSON.parse(GOOGLE_SERVICE_ACCOUNT) as Record<string, string>;
    const token = await getGoogleAccessToken(sa);

    // ── Espelhar em lote ────────────────────────────────────────────────
    // Em SERIE de proposito: e o que garante que a primeira pasta de cada tipo
    // seja criada uma vez so. Paralelizar aqui foi o que produziu tres pastas
    // "comprovantes" -- e mesmo com a reserva no banco corrigindo isso, em serie
    // o caso comum nem chega a disputar.
    if (corpoReq.lote) {
      const { data: pendentes } = await supabase
        .from('vw_documentos_sem_espelho').select('id').limit(Math.min(corpoReq.lote, 60));
      let feitos = 0;
      const erros: string[] = [];
      for (const p of pendentes ?? []) {
        const r = await espelhar(p.id, token);
        if (r) erros.push(`${p.id}: ${r}`); else feitos++;
      }
      const { count: restam } = await supabase
        .from('vw_documentos_sem_espelho').select('id', { count: 'exact', head: true });
      return json({ ok: true, espelhados: feitos, erros, restam });
    }

    // ── Espelhar um ────────────────────────────────────────────────────
    if (!corpoReq.documento_id) return json({ error: 'documento_id obrigatorio' }, 400);
    const erro = await espelhar(corpoReq.documento_id, token);
    if (erro) return json({ error: erro }, 500);
    const { data: pronto } = await supabase
      .from('documentos_fiscais').select('drive_url, drive_id').eq('id', corpoReq.documento_id).single();
    return json({ ok: true, ...pronto });
  } catch (err) {
    console.error('[drive-espelho] Erro:', err);
    return json({ error: String(err) }, 500);
  }
});

/** Devolve null em sucesso, ou o motivo da falha. */
async function espelhar(documentoId: string, token: string): Promise<string | null> {
  const { data: doc, error: erroDoc } = await supabase
    .from('documentos_fiscais')
    .select('id, tipo, competencia, nome_arquivo, storage_path, drive_url')
    .eq('id', documentoId)
    .single();
  if (erroDoc || !doc) return 'documento nao encontrado';
  if (!doc.storage_path) return 'documento sem arquivo';
  // Ja espelhado: reenviar criaria uma segunda copia, e a contabilidade veria a
  // mesma nota duas vezes.
  if (doc.drive_url) return null;

  const pasta = doc.tipo === 'servico' ? 'servicos'
              : doc.tipo === 'comprovante' ? 'comprovantes'
              : 'ferramentas';
  const mes = String(doc.competencia).slice(0, 7);

  const idTipo = await garantirPasta(token, pasta, DRIVE_PASTA_RAIZ);
  const idMes  = await garantirPasta(token, `${pasta}/${mes}`, idTipo);

  const { data: arquivo, error: erroArq } = await supabase.storage
    .from('documentos').download(doc.storage_path);
  if (erroArq || !arquivo) return `storage: ${erroArq?.message ?? 'arquivo vazio'}`;

  // Upload multipart: metadados e conteudo na mesma chamada. Em duas chamadas,
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
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
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
  if (!enviado.id) return `drive upload: ${JSON.stringify(enviado)}`;

  const url = enviado.webViewLink ?? `https://drive.google.com/file/d/${enviado.id}/view`;
  // Guarda o id tambem: extrair de volta da URL por regex funcionaria hoje e
  // quebraria no dia em que o Google mudasse o formato do link.
  await supabase.from('documentos_fiscais')
    .update({ drive_url: url, drive_id: enviado.id }).eq('id', doc.id);

  return null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
