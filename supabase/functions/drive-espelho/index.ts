import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Espelha no Drive o documento que ja esta no Storage, e apaga a copia quando o
 * original some.
 *
 * O Storage e a fonte: privado, com RLS por dono, e e de onde a tela le. O Drive
 * e a copia para a contabilidade, que trabalha la e nao vai entrar no dashboard.
 *
 * Estrutura, `{empresa}/{competencia}/{tipo}/{arquivo}`:
 *   alaskan/2026-08/ferramentas/2026-08_ElevenLabs_invoice.pdf
 *   alaskan/2026-08/servicos/2026-08_Jaqueline-Coelho_NF.pdf
 *   aeliss/2026-09/comprovantes/2026-09-04_J-A-BATISTA-JUNIOR_83319848.pdf
 *
 * A empresa virou o primeiro nivel em 08/10/2026 (antes era `{tipo}/{mes}`), e a
 * mesma estrutura vale no Storage — ver docs/estrutura-de-pastas-dos-documentos.md.
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

    /* ── Mover para a pasta nova ──────────────────────────────────────────
       A migracao de `{tipo}/{mes}` para `{empresa}/{mes}/{tipo}`, nos DOIS
       sistemas: o arquivo no Storage e a copia no Drive. Ver `moverUm`, que tem
       a ordem dos passos e o motivo de ela ser essa.

       Mora aqui, e nao numa migracao SQL, porque mover no Storage exige a API
       `.move()`: a chave do objeto inclui o `name`, entao trocar
       `storage.objects.name` por SQL deixaria o banco apontando para um caminho
       sem arquivo. Esta funcao tem a service role e pode chamar a API. */
    if (corpoReq.acao === 'mover') {
      // Um documento, ou um lote. O lote existe porque sao 212 na migracao, e
      // 212 chamadas HTTP seria 212 chances de parar no meio sem saber onde.
      //
      // Os pendentes vem de `vw_documentos_a_mover`, que exclui quem ja tem os
      // dois passos com `ok`. Pegar "os 60 primeiros por criado_em" olharia os
      // mesmos 60 em toda chamada e nunca alcancaria o 61: o cursor tem de ser
      // o que ja foi feito, nao a posicao na lista.
      let alvos: string[];
      if (corpoReq.documento_id) {
        alvos = [corpoReq.documento_id];
      } else {
        const { data } = await supabase
          .from('vw_documentos_a_mover').select('id')
          .limit(Math.min(corpoReq.lote ?? 60, 60));
        alvos = (data ?? []).map((d: { id: string }) => d.id);
      }

      // Em SERIE, pela mesma razao do espelho em lote: as pastas novas sao
      // criadas sob demanda, e em paralelo o primeiro lote disputaria a criacao
      // de `{empresa}` e `{empresa}/{mes}` varias vezes.
      let movidos = 0, jaEstavam = 0;
      const erros: string[] = [];
      for (const id of alvos) {
        const r = await moverUm(id, token);
        if (r.erro) erros.push(`${id}: ${r.erro}`);
        else if (r.movido) movidos++;
        else jaEstavam++;
      }
      const { count: restam } = await supabase
        .from('vw_documentos_a_mover').select('id', { count: 'exact', head: true });
      return json({ ok: true, movidos, ja_estavam: jaEstavam, erros, olhados: alvos.length, restam });
    }

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

/**
 * A pasta de destino no Drive: `{empresa}/{competencia}/{tipo}`.
 *
 * A empresa entrou como primeiro nivel em 08/10/2026. Antes era
 * `{tipo}/{competencia}`, e o pacote mensal da contabilidade — que e de UMA
 * empresa num mes — ficava espalhado por tres pastas. Agora e uma so.
 *
 * Recusa sem empresa em vez de improvisar uma pasta "sem-empresa": documento
 * fiscal sem dono foi o que colocou 38 notas em lugar nenhum ate 07/10/2026, e
 * a tela ja passou a exigir a empresa no upload. Aqui e a segunda rede.
 *
 * Ver docs/estrutura-de-pastas-dos-documentos.md.
 */
async function pastaDoDocumento(
  token: string,
  doc: { tipo: string; competencia: unknown; empresas?: unknown },
): Promise<string | { erro: string }> {
  // O embed do PostgREST devolve objeto ou lista conforme resolve a relacao.
  const rel = doc.empresas as { slug?: string } | { slug?: string }[] | null;
  const slug = (Array.isArray(rel) ? rel[0]?.slug : rel?.slug)?.trim();
  if (!slug) return { erro: 'documento sem empresa: nao sei em que pasta guardar' };

  const pasta = pastaDoTipo(doc.tipo);
  const mes = String(doc.competencia).slice(0, 7);

  // Um `garantirPasta` por nivel, na ordem: cada um precisa do id do pai.
  const idEmpresa = await garantirPasta(token, slug, DRIVE_PASTA_RAIZ);
  const idMes     = await garantirPasta(token, `${slug}/${mes}`, idEmpresa);
  return await garantirPasta(token, `${slug}/${mes}/${pasta}`, idMes);
}

/** `documentos_fiscais.tipo` -> nome da pasta. O mesmo mapa de
 *  `PASTA_DO_TIPO` em src/lib/documentos.ts; o teste
 *  `caminho-do-documento-e-um-so` amarra os dois. */
function pastaDoTipo(tipo: string): string {
  return tipo === 'servico' ? 'servicos'
       : tipo === 'comprovante' ? 'comprovantes'
       : 'ferramentas';
}

/** Grava o passo em `documentos_movidos` antes de executa-lo, e devolve o id da
 *  linha para marcar o resultado. Sem a linha o passo nao acontece: um erro no
 *  meio de 212 arquivos, em dois sistemas, sem registro de onde cada um estava,
 *  e arqueologia. */
async function registrarPasso(
  documentoId: string, sistema: 'storage' | 'drive', de: string, para: string,
): Promise<{ id: string } | { erro: string }> {
  const { data, error } = await supabase.from('documentos_movidos')
    .insert({ documento_id: documentoId, sistema, de, para })
    .select('id').single();
  if (error || !data) return { erro: `nao registrei o passo ${sistema}: ${error?.message}` };
  return { id: data.id };
}

const fecharPasso = (id: string, ok: boolean, erro?: string) =>
  supabase.from('documentos_movidos').update({ ok, erro: erro ?? null }).eq('id', id);

/**
 * Leva UM documento para a estrutura `{empresa}/{competencia}/{tipo}`, nos dois
 * sistemas: o arquivo no Storage e a copia no Drive.
 *
 * Existe como acao PROPRIA porque o gatilho nao resolve. `trg_espelho_drive`
 * dispara em `UPDATE OF storage_path`, mas `espelhar()` comeca com
 * `if (doc.drive_url) return null` — guarda correta, que impede a contabilidade
 * de ver a mesma nota duas vezes, e que por isso nunca reposicionaria um
 * documento ja espelhado.
 *
 * ── A ordem, que e o ponto todo ──────────────────────────────────────────
 *
 *   1. Storage: `.move()`, a API, que COPIA o objeto. Nao da para fazer isso em
 *      SQL trocando `storage.objects.name`: a chave do objeto no armazenamento
 *      e `{bucket}/{name}/{version}`, entao renomear a linha sem copiar deixa o
 *      banco apontando para um caminho sem arquivo — a tela mostra a nota e o
 *      download da 404.
 *   2. `storage_path`: agora Storage e banco voltam a concordar. Entre 1 e 2 o
 *      par esta partido, e e por isso que sao dois passos seguidos e nao tres
 *      coisas em paralelo.
 *   3. Drive: `PATCH ?addParents&removeParents`, que so troca o pai. Nao baixa
 *      nem sobe: o `drive_id` continua o mesmo, entao `drive_url` segue valendo
 *      e nenhum link guardado quebra.
 *
 * Se 3 falhar, 1 e 2 ficaram certos e a copia do Drive esta na pasta velha —
 * incomodo, nao estrago, e a proxima chamada conserta porque cada passo olha o
 * estado real antes de agir.
 *
 * Idempotente. Passo que ja estava certo grava sentinela (`de = para`): sem ela
 * o documento certo travaria a fila atras de si, porque a fila e justamente a
 * ausencia de linha.
 */
async function moverUm(
  documentoId: string, token: string,
): Promise<{ movido: boolean; erro?: string }> {
  const { data: doc, error: erroDoc } = await supabase
    .from('documentos_fiscais')
    .select('id, tipo, competencia, storage_path, drive_id, empresa_id, empresas(slug)')
    .eq('id', documentoId).single();
  if (erroDoc || !doc) return { movido: false, erro: 'documento nao encontrado' };
  if (!doc.storage_path) return { movido: false, erro: 'documento sem arquivo' };

  // O embed do PostgREST devolve objeto ou lista conforme resolve a relacao.
  const rel = doc.empresas as { slug?: string } | { slug?: string }[] | null;
  const slug = (Array.isArray(rel) ? rel[0]?.slug : rel?.slug)?.trim();
  if (!slug) return { movido: false, erro: 'documento sem empresa: nao sei para que pasta levar' };

  const mes = String(doc.competencia).slice(0, 7);
  let mexeu = false;

  // ── 1 e 2: o arquivo no Storage, e o caminho no banco ────────────────────
  const nome = doc.storage_path.replace(/^.*\//, '');
  const caminhoNovo = `${slug}/${mes}/${pastaDoTipo(doc.tipo)}/${nome}`;

  const passoStorage = await registrarPasso(
    doc.id, 'storage', doc.storage_path, caminhoNovo,
  );
  if ('erro' in passoStorage) return { movido: false, erro: passoStorage.erro };

  if (doc.storage_path !== caminhoNovo) {
    const { error: erroMove } = await supabase.storage
      .from('documentos').move(doc.storage_path, caminhoNovo);
    if (erroMove) {
      await fecharPasso(passoStorage.id, false, erroMove.message);
      return { movido: false, erro: `storage move: ${erroMove.message}` };
    }

    const { error: erroPath } = await supabase.from('documentos_fiscais')
      .update({ storage_path: caminhoNovo }).eq('id', doc.id);
    if (erroPath) {
      // O arquivo mudou de lugar e o banco nao sabe: desfaz o Storage em vez de
      // deixar a linha apontando para o caminho velho, que agora esta vazio.
      await supabase.storage.from('documentos').move(caminhoNovo, doc.storage_path);
      await fecharPasso(passoStorage.id, false, `storage_path: ${erroPath.message}`);
      return { movido: false, erro: `storage_path: ${erroPath.message}` };
    }
    mexeu = true;
    console.log(`[drive-espelho] storage ${doc.storage_path} -> ${caminhoNovo}`);
  }
  await fecharPasso(passoStorage.id, true);

  // ── 3: a copia no Drive ──────────────────────────────────────────────────
  if (!doc.drive_id) {
    // Sem copia no Drive nao ha o que mover. Grava sentinela para a fila
    // andar — `espelhar()` e quem cuida de criar a copia que falta, e ela ja
    // nasce na estrutura nova.
    const p = await registrarPasso(doc.id, 'drive', '(sem copia)', '(sem copia)');
    if (!('erro' in p)) await fecharPasso(p.id, true);
    return { movido: mexeu };
  }

  const destino = await pastaDoDocumento(token, doc);
  if (typeof destino !== 'string') return { movido: mexeu, erro: destino.erro };

  // Os pais ATUAIS vem do proprio Drive, nao de `drive_pastas` pelo caminho
  // antigo: se alguem moveu o arquivo a mao, o banco nao sabe e o
  // `removeParents` erraria o alvo, deixando o arquivo em duas pastas.
  const atual = await fetch(
    `https://www.googleapis.com/drive/v3/files/${doc.drive_id}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!atual.ok) return { movido: mexeu, erro: `drive get [${atual.status}]: ${await atual.text()}` };
  const pais: string[] = (await atual.json()).parents ?? [];
  const jaEstava = pais.length === 1 && pais[0] === destino;

  const passoDrive = await registrarPasso(
    doc.id, 'drive', jaEstava ? destino : (pais.join(',') || '(sem pai)'), destino,
  );
  if ('erro' in passoDrive) return { movido: mexeu, erro: passoDrive.erro };

  if (!jaEstava) {
    const params = new URLSearchParams({
      addParents: destino, supportsAllDrives: 'true', fields: 'id,parents',
    });
    if (pais.length) params.set('removeParents', pais.join(','));

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${doc.drive_id}?${params}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const texto = await res.text();
      await fecharPasso(passoDrive.id, false, `[${res.status}] ${texto}`);
      return { movido: mexeu, erro: `drive move [${res.status}]: ${texto}` };
    }
    mexeu = true;
    console.log(`[drive-espelho] drive ${doc.drive_id} -> ${destino}`);
  }
  await fecharPasso(passoDrive.id, true);

  return { movido: mexeu };
}

/** Devolve null em sucesso, ou o motivo da falha. */
async function espelhar(documentoId: string, token: string): Promise<string | null> {
  const { data: doc, error: erroDoc } = await supabase
    .from('documentos_fiscais')
    .select('id, tipo, competencia, nome_arquivo, storage_path, drive_url, empresa_id, empresas(slug)')
    .eq('id', documentoId)
    .single();
  if (erroDoc || !doc) return 'documento nao encontrado';
  if (!doc.storage_path) return 'documento sem arquivo';
  // Ja espelhado: reenviar criaria uma segunda copia, e a contabilidade veria a
  // mesma nota duas vezes.
  if (doc.drive_url) return null;

  // O ultimo nivel e a pasta do TIPO desde 08/10/2026; antes era a do mes.
  const idPasta = await pastaDoDocumento(token, doc);
  if (typeof idPasta !== 'string') return idPasta.erro;

  const { data: arquivo, error: erroArq } = await supabase.storage
    .from('documentos').download(doc.storage_path);
  if (erroArq || !arquivo) return `storage: ${erroArq?.message ?? 'arquivo vazio'}`;

  // Upload multipart: metadados e conteudo na mesma chamada. Em duas chamadas,
  // uma falha no meio deixaria arquivo vazio no Drive.
  const limite = `-------${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name: doc.nome_arquivo, parents: [idPasta] });
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
