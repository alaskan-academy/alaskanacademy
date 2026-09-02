/**
 * Sonda: mTLS funciona dentro da Edge Function do Supabase?
 *
 * ── Por que esta função existe ────────────────────────────────────────────
 *
 * As APIs do C6 (e as do Inter) exigem TLS mútuo: além do token OAuth2, a
 * conexão precisa apresentar um certificado de cliente. O `fetch` padrão do
 * Deno não faz isso — é preciso `Deno.createHttpClient({ cert, key })`, que em
 * algumas versões depende de flag instável.
 *
 * Se isso NÃO rodar no runtime do Supabase, a coleta bancária não pode morar
 * numa Edge Function, e o desenho inteiro da integração muda. É a única
 * pergunta que invalida tudo, então ela é respondida ANTES de escrever a
 * integração — e não descoberta no meio dela.
 *
 * ── Ela separa três respostas que costumam se confundir ───────────────────
 *
 *   1. o runtime SABE fazer mTLS?          (`Deno.createHttpClient` existe?)
 *   2. o certificado é aceito pelo C6?     (handshake TLS)
 *   3. as credenciais são válidas?         (200 com access_token)
 *
 * Um 401 responde "sim, sim, não" — e é um resultado ÓTIMO para esta sonda:
 * significa que o caminho técnico está livre e falta só credencial certa.
 * Sem separar as três, um erro genérico seria lido como "não dá", e a decisão
 * de arquitetura sairia errada.
 *
 * ── Segurança ─────────────────────────────────────────────────────────────
 *
 * Nada de segredo aparece na resposta: nem certificado, nem chave, nem
 * client_secret, nem o access_token. Só o tamanho de cada um, que é o
 * suficiente para saber se foi lido, e os primeiros caracteres do erro.
 *
 * Apagar esta função depois que a integração existir — ela não tem uso
 * corrente e é uma porta a menos.
 */

/* Os segredos, nas Edge Function Secrets. Aceita PEM cru ou base64: colar PEM
   multilinha no painel funciona, mas quebra fácil em copiar-e-colar, e o base64
   é uma linha só. Tentar os dois evita um "não funcionou" que era só formato. */
function lerPem(nomeB64: string, nomeCru: string): string | null {
  const b64 = Deno.env.get(nomeB64);
  if (b64) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(b64.trim()), c => c.charCodeAt(0))); }
    catch { return null; }
  }
  return Deno.env.get(nomeCru) ?? null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async () => {
  const passos: Record<string, unknown> = {};

  // ── 1. O runtime sabe fazer mTLS? ───────────────────────────────────────
  const temApi = typeof (Deno as unknown as { createHttpClient?: unknown }).createHttpClient === 'function';
  passos['1_runtime_suporta_mtls'] = temApi;
  passos['deno_version'] = Deno.version?.deno ?? 'desconhecida';

  if (!temApi) {
    return json({
      veredito: 'NAO — `Deno.createHttpClient` não existe neste runtime',
      significa: 'a coleta bancária não pode rodar em Edge Function; precisa de outro lugar',
      passos,
    });
  }

  // ── 2. Os segredos chegaram? ────────────────────────────────────────────
  const cert = lerPem('C6_CERT_B64', 'C6_CERT_PEM');
  const key  = lerPem('C6_KEY_B64',  'C6_KEY_PEM');
  const clientId     = Deno.env.get('C6_CLIENT_ID');
  const clientSecret = Deno.env.get('C6_CLIENT_SECRET');

  /* Tamanhos, nunca conteúdo. Serve para separar "não cadastrei" de
     "cadastrei errado" sem expor nada. */
  passos['2_segredos'] = {
    cert:          cert ? `${cert.length} caracteres` : 'AUSENTE',
    key:           key ? `${key.length} caracteres` : 'AUSENTE',
    client_id:     clientId ? `${clientId.length} caracteres` : 'AUSENTE',
    client_secret: clientSecret ? `${clientSecret.length} caracteres` : 'AUSENTE',
    cert_parece_pem: cert?.includes('BEGIN CERTIFICATE') ?? false,
    key_parece_pem:  key?.includes('PRIVATE KEY') ?? false,
  };

  if (!cert || !key || !clientId || !clientSecret) {
    return json({
      veredito: 'INCOMPLETO — o runtime suporta mTLS, mas falta segredo',
      comoResolver: 'Cadastre C6_CERT_B64, C6_KEY_B64, C6_CLIENT_ID e C6_CLIENT_SECRET '
        + 'nas Edge Function Secrets do projeto.',
      passos,
    });
  }

  // ── 3. O C6 aceita o certificado e as credenciais? ──────────────────────
  const AUTH = 'https://baas-api-sandbox.c6bank.info/v1/auth';
  try {
    const cliente = (Deno as unknown as {
      createHttpClient: (o: { cert: string; key: string }) => unknown;
    }).createHttpClient({ cert, key });

    const res = await fetch(AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      client: cliente,
    } as RequestInit);

    const texto = await res.text();
    let temToken = false;
    try { temToken = typeof JSON.parse(texto)?.access_token === 'string'; } catch { /* não é json */ }

    passos['3_resposta_do_c6'] = {
      status: res.status,
      /* O corpo NÃO sai inteiro: em caso de 200 ele contém o access_token. Só o
         começo, e só quando não for sucesso. */
      inicio_do_corpo: res.ok ? '(omitido: contém token)' : texto.slice(0, 300),
      recebeu_access_token: temToken,
    };

    if (res.ok && temToken) {
      return json({ veredito: 'SIM — mTLS funciona e as credenciais autenticaram', passos });
    }
    if (res.status === 401 || res.status === 403) {
      return json({
        veredito: 'SIM para o mTLS — o handshake passou; as credenciais é que foram recusadas',
        significa: 'o caminho técnico está livre. Conferir client_id/client_secret do sandbox.',
        passos,
      });
    }
    return json({ veredito: 'PARCIAL — conectou, mas o C6 respondeu ' + res.status, passos });
  } catch (e) {
    const msg = String(e);
    /* Erro de handshake e erro de API dizem coisas diferentes, e confundi-los
       levaria à decisão de arquitetura errada. */
    const deHandshake = /certificate|tls|handshake|ssl|unstable|permission/i.test(msg);
    passos['3_resposta_do_c6'] = { erro: msg.slice(0, 400) };
    return json({
      veredito: deHandshake
        ? 'NAO — o runtime tem a API, mas o mTLS falhou no handshake'
        : 'INDEFINIDO — falhou antes de responder; ver o erro',
      passos,
    });
  }
});
