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
 *
 * ── Uma conta bancaria por empresa (31/08/2026) ───────────────────────────
 *
 * Esta funcao usava UMA credencial e nao carimbava a empresa no documento. O
 * `cs-sync` ja tinha sido consertado; esta ficou para tras, e a lacuna so
 * apareceria quando a Aeliss comecasse a movimentar a conta dela.
 *
 * O que teria acontecido, nesta ordem:
 *
 *   1. o PIX da Aeliss entra em `transacoes` com `empresa_id` carimbado;
 *   2. esta funcao pega a referencia `aeliss_83319848` e pede o comprovante a
 *      API da ALASKAN, que responde 404 -- id de outra conta;
 *   3. a falha e silenciosa, porque `buscarUm` devolve o motivo e a rodada
 *      segue; o PIX volta para a fila amanha e falha de novo, para sempre.
 *
 * E se por acaso funcionasse, seria pior: o comprovante entraria em
 * `documentos_fiscais` sem `empresa_id`, e a contabilidade da Aeliss receberia
 * um PDF que o painel diz ser de ninguem.
 */

const env = (n: string) => (Deno.env.get(n) ?? '').trim();
const CS_SYNC_SECRET = env('CS_SYNC_SECRET');
const CS_BASE_URL    = 'https://api.contasimples.com';

/**
 * Uma conta bancaria por empresa, e o NOME do segredo diz de quem ela e.
 *
 *   CS_API_KEY / CS_API_SECRET                -> alaskan (os que ja existiam)
 *   CS_API_KEY_<SLUG> / CS_API_SECRET_<SLUG>  -> o `slug` correspondente
 *
 * Mesmo padrao do `cs-sync` e das chaves da Payt: empresa nova e um par de
 * segredos novo, sem tocar em codigo.
 */
interface ContaCS {
  slug: string;
  key: string;
  secret: string;
}

const PREFIXO_KEY = 'CS_API_KEY_';

function contasConfiguradas(): ContaCS[] {
  const achadas: ContaCS[] = [];

  /* A dupla historica e lida DIRETO, e nao pela varredura: se `toObject()`
     falhasse, a lista viria vazia e a funcao nao faria nada em silencio. */
  const k = env('CS_API_KEY');
  const s = env('CS_API_SECRET');
  if (k && s) achadas.push({ slug: 'alaskan', key: k, secret: s });

  try {
    for (const nome of Object.keys(Deno.env.toObject())) {
      if (!nome.startsWith(PREFIXO_KEY)) continue;
      const sufixo  = nome.slice(PREFIXO_KEY.length);
      const chave   = env(nome);
      const segredo = env('CS_API_SECRET_' + sufixo);
      if (chave && segredo) {
        achadas.push({ slug: sufixo.toLowerCase(), key: chave, secret: segredo });
      } else {
        /* Meia credencial e pior que nenhuma: some sem erro. */
        console.error('[cs-comprovantes] ' + nome + ' existe mas CS_API_SECRET_' + sufixo + ' nao — conta ignorada');
      }
    }
  } catch (e) {
    console.error('[cs-comprovantes] nao consegui varrer os segredos:', e);
  }

  return achadas;
}

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

async function getToken(conta: ContaCS): Promise<string> {
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
  if (!res.ok) throw new Error(`CS auth [${res.status}]: ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token as string;
}

/**
 * O id que a API da Conta Simples reconhece.
 *
 * `cs-sync` prefixa a referencia das contas novas com o slug (`aeliss_1234`)
 * porque o id da Conta Simples so e garantidamente unico DENTRO de uma conta —
 * a da Alaskan ficou sem prefixo para nao reimportar 1.238 linhas como novas.
 *
 * Aqui o caminho e o inverso: a URL do comprovante quer o id CRU. Mandar o
 * prefixado da 404, e a falha some no `motivo` sem ninguem ligar uma coisa a
 * outra.
 */
function idNaApi(referencia: string, slug: string): string {
  const prefixo = slug + '_';
  return referencia.startsWith(prefixo) ? referencia.slice(prefixo.length) : referencia;
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

interface Pendente {
  referencia_externa: string;
  data: string;
  descricao: string | null;
  valor: number;
  empresa_id: string | null;
}

async function buscarUm(p: Pendente, conta: ContaCS, token: string): Promise<string | null> {
  const r = await fetch(
    `${CS_BASE_URL}/statements/v1/banking/${idNaApi(p.referencia_externa, conta.slug)}/receipt`,
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
    // Vem da TRANSACAO, que e carimbada na importacao do extrato. Derivar aqui
    // (pelo slug da conta, por exemplo) criaria uma segunda resposta para a
    // mesma pergunta, e as duas divergiriam no dia em que uma conta trocasse
    // de empresa.
    empresa_id: p.empresa_id,
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

    const contas = contasConfiguradas();
    if (contas.length === 0) {
      return json({
        erro: 'nenhuma conta da Conta Simples configurada',
        comoResolver: 'Cadastre CS_API_KEY e CS_API_SECRET nas Edge Functions. '
          + 'Uma empresa a mais e um par a mais: CS_API_KEY_<SLUG> e CS_API_SECRET_<SLUG>, '
          + 'com o mesmo <slug> da tabela `empresas`.',
      }, 503);
    }

    /* empresa_id -> conta. A credencial certa e a da empresa DONA do PIX: a
       referencia so existe dentro da conta bancaria que a gerou. */
    const { data: linhasEmpresa } = await supabase.from('empresas').select('id,slug');
    const contaPorEmpresa = new Map<string, ContaCS>();
    for (const e of (linhasEmpresa ?? []) as Record<string, unknown>[]) {
      const c = contas.find(x => x.slug === String(e.slug));
      if (c) contaPorEmpresa.set(String(e.id), c);
    }

    const { data: pendentes, error: erroLista } = await supabase
      .from('vw_pix_sem_comprovante')
      .select('referencia_externa, data, descricao, valor, empresa_id')
      .gte('data', desde)
      .limit(limite);
    if (erroLista) throw erroLista;
    if (!pendentes?.length) return json({ ok: true, buscados: 0, nada_a_fazer: true });

    /*
      Agrupa por empresa antes de pedir token: um token por conta na rodada,
      em vez de um por comprovante. E o PIX sem credencial correspondente sai
      da fila ANTES de gastar chamada — sem isto ele bateria na API errada e
      voltaria 404 todo dia, para sempre.
    */
    const porEmpresa = new Map<string, Pendente[]>();
    const semCredencial: { id: string; empresa_id: string | null }[] = [];
    for (const p of pendentes as Pendente[]) {
      const chave = p.empresa_id ?? '';
      if (!contaPorEmpresa.has(chave)) { semCredencial.push({ id: p.referencia_externa, empresa_id: p.empresa_id }); continue; }
      porEmpresa.set(chave, [...(porEmpresa.get(chave) ?? []), p]);
    }
    if (semCredencial.length) {
      console.error(
        `[cs-comprovantes] ${semCredencial.length} PIX sem credencial da empresa dona — `
        + 'cadastre CS_API_KEY_<SLUG>/CS_API_SECRET_<SLUG> ou confira o empresa_id da transacao',
      );
    }

    let buscados = 0;
    const falhas: { id: string; motivo: string }[] = [];
    const porConta: Record<string, unknown>[] = [];

    for (const [empresaId, fila] of porEmpresa) {
      const conta = contaPorEmpresa.get(empresaId)!;
      /* Uma conta que falha na autenticacao nao derruba as outras: a Aeliss
         com a chave errada nao pode impedir os comprovantes da Alaskan. */
      try {
        const token = await getToken(conta);
        let daConta = 0;

        for (let i = 0; i < fila.length; i += EM_PARALELO) {
          const lote = fila.slice(i, i + EM_PARALELO);
          const saidas = await Promise.all(lote.map(async p => {
            try { return { id: p.referencia_externa, motivo: await buscarUm(p, conta, token) }; }
            catch (err) { return { id: p.referencia_externa, motivo: String(err) }; }
          }));
          for (const s of saidas) {
            if (s.motivo) falhas.push({ id: s.id, motivo: s.motivo });
            else { buscados++; daConta++; }
          }
        }

        porConta.push({ conta: conta.slug, buscados: daConta, na_fila: fila.length });
      } catch (e) {
        console.error('[cs-comprovantes] conta ' + conta.slug + ':', e);
        porConta.push({ conta: conta.slug, erro: String(e), na_fila: fila.length });
      }
    }

    const { count: restam } = await supabase
      .from('vw_pix_sem_comprovante')
      .select('referencia_externa', { count: 'exact', head: true });

    console.log(`[cs-comprovantes] ${buscados} buscados, ${falhas.length} falhas, ${restam ?? '?'} restam`);
    return json({
      ok: true,
      buscados,
      falhas,
      restam,
      por_conta: porConta,
      ...(semCredencial.length ? { sem_credencial: semCredencial } : {}),
    });
  } catch (err) {
    console.error('[cs-comprovantes] Erro:', err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
