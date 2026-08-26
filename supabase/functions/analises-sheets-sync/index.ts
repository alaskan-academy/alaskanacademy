import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Espelha as rodadas de análise numa planilha do Google.
 *
 * Reescreve as duas abas inteiras a cada chamada, e é isso que a torna segura
 * de disparar no botão de salvar: rodar vinte vezes seguidas dá o mesmo
 * resultado que rodar uma. Acrescentar linhas produziria vinte cópias da mesma
 * análise, que é o defeito clássico de exportação automática.
 *
 * Os números saem do RETRATO gravado em `analise_itens.metricas`, não de
 * recálculo: a planilha é o histórico da decisão, e recalcular faria uma linha
 * de agosto mudar sozinha quando uma venda fosse recategorizada em setembro.
 *
 * O id da planilha vive em `configuracoes_texto.analises_spreadsheet_id`, e não
 * no código: assim ela troca de planilha sem deploy. Vazio, a função não faz
 * nada e diz que pulou — a análise não pode depender de exportação.
 *
 * Reaproveita a conta de serviço do Google que `radar-sheets-sync` já usa
 * (secret GOOGLE_SERVICE_ACCOUNT). Uma conta, três planilhas.
 */

const ABA_ANALISES = "Análises";
const ABA_ACOES    = "Ações";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HEADERS_ANALISES = [
  "Data", "Projeto", "REV", "Método", "Período", "Rodada fechada em",
  "Investimento", "Faturamento", "Resultado", "Vendas", "ROAS",
  "Imposto", "Taxa", "Taxa %", "Lucro líquido", "Margem %",
  "Upsells", "Adesão upsell %", "Faturamento upsell", "ROAS c/ upsell", "Lucro c/ upsell",
  "Oferta principal", "Bumps", "Adesão bump %", "Receita bumps",
  "Cliques", "CPC", "Checkouts", "CPI", "Conv. checkout %", "CPA", "Conv. funil %",
  "CPV", "EPC", "EPC−CPV", "AOV",
  "Play Rate %", "1 minuto %", "Fim da lead %", "Pitch %", "Final VSL %",
  "Leitura",
];

const HEADERS_ACOES = [
  "Data da rodada", "Projeto", "REV", "Ação", "Expectativa",
  "Feita", "Feita em", "Feita por", "Criada em",
];

// ── Google JWT auth ───────────────────────────────────────────────────────────

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const toSign = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })}`;

  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );

  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${toSign}.${sigB64}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const br = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
    })
  : "";

const dia = (d: string | null) => d ? d.split("-").reverse().join("/") : "";

/**
 * Número para a célula.
 *
 * Sai como número puro, sem "R$" e sem formatar: assim a planilha soma, ordena
 * e faz gráfico. Formatar aqui transformaria cada valor em texto — o erro que
 * faz a coluna de faturamento não somar.
 */
const n = (v: unknown): string | number => (typeof v === "number" ? v : "");

async function ensureSheet(
  base: string, auth: Record<string, string>, title: string, existentes: any[],
): Promise<number> {
  const achou = existentes.find((s: any) => s.properties.title === title);
  if (achou) return achou.properties.sheetId as number;
  const res = await fetch(`${base}:batchUpdate`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  const data = await res.json();
  return data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
}

async function writeSheet(
  base: string, auth: Record<string, string>,
  sheetName: string, sheetId: number,
  headers: string[], rows: (string | number)[][],
): Promise<void> {
  await fetch(
    `${base}/values/${encodeURIComponent(`${sheetName}!A1:BZ20000`)}:clear`,
    { method: "POST", headers: auth },
  );
  const res = await fetch(
    `${base}/values/${encodeURIComponent(`${sheetName}!A1`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", headers: auth, body: JSON.stringify({ values: [headers, ...rows] }) },
  );
  if (!res.ok) throw new Error(`Sheets write error (${sheetName}): ${await res.text()}`);

  await fetch(`${base}:batchUpdate`, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.11, green: 0.11, blue: 0.11 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
        { updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
        } },
      ],
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const ok = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json", ...CORS },
  });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cfg } = await supabase
      .from("configuracoes_texto").select("valor")
      .eq("chave", "analises_spreadsheet_id").maybeSingle();

    const planilhaId = (cfg?.valor ?? "").trim();
    if (!planilhaId) {
      // Sem planilha configurada não é erro: é o estado inicial. A tela mostra
      // isso uma vez, e a análise segue.
      return ok({ pulado: true, motivo: "analises_spreadsheet_id não configurado" });
    }

    const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
    if (!saJson) throw new Error("Secret GOOGLE_SERVICE_ACCOUNT não configurado.");
    const sa = JSON.parse(saJson) as Record<string, string>;

    const [{ data: rodadas }, { data: acoes }, { data: revs }, { data: perfis }] = await Promise.all([
      supabase.from("analises")
        .select("id,data,fechada_em,analise_itens(funil_id,leitura,metricas,retencao)")
        .order("data", { ascending: false }),
      supabase.from("analise_acoes")
        .select("funil_id,texto,expectativa,feita,feita_em,feita_por,criada_em,analise_id")
        .order("criada_em", { ascending: false }),
      supabase.from("vw_mapa_revs").select("id,rev,projeto"),
      supabase.from("perfis").select("id,nome"),
    ]);

    const nomeRev = Object.fromEntries((revs ?? []).map((r: any) => [r.id, r]));
    const nomePerfil = Object.fromEntries((perfis ?? []).map((p: any) => [p.id, p.nome]));
    const dataDaRodada = Object.fromEntries((rodadas ?? []).map((r: any) => [r.id, r.data]));

    // ── Aba de análises ──────────────────────────────────────────────────────
    const linhas: (string | number)[][] = [];
    for (const rodada of rodadas ?? []) {
      for (const item of (rodada as any).analise_itens ?? []) {
        const rev = nomeRev[item.funil_id] ?? {};
        const m = item.metricas?.atual ?? {};
        const ret = item.retencao ?? {};
        linhas.push([
          dia(rodada.data), rev.projeto ?? "", rev.rev ?? "", "",
          item.metricas?.inicio && item.metricas?.fim
            ? `${dia(item.metricas.inicio)} a ${dia(item.metricas.fim)}` : "",
          br(rodada.fechada_em),
          n(m.investimento), n(m.faturamento), n(m.resultado), n(m.vendas), n(m.roas),
          n((m.imposto_simples ?? 0) + (m.imposto_meta ?? 0)),
          n(m.taxa_plataforma), n(m.taxa_plataforma_pct),
          n(m.lucro_liquido), n(m.margem_pct),
          n(m.upsell_qtd), n(m.upsell_adesao_pct), n(m.upsell_faturamento),
          n(m.roas_com_upsell), n(m.lucro_com_upsell),
          n(m.oferta_principal_valor), n(m.bump_qtd), n(m.bump_adesao_pct), n(m.bump_faturamento),
          n(m.cliques), n(m.cpc), n(m.checkouts_iniciados), n(m.cpi),
          n(m.conv_checkout_pct), n(m.cpa), n(m.conv_funil_pct),
          n(m.cpv), n(m.epc), n(m.epc_menos_cpv), n(m.aov),
          n(ret.play_rate_pct), n(ret.um_minuto_pct), n(ret.fim_da_lead_pct),
          n(ret.pitch_pct), n(ret.final_pct),
          item.leitura ?? "",
        ]);
      }
    }

    // ── Aba de ações ─────────────────────────────────────────────────────────
    const linhasAcoes: (string | number)[][] = (acoes ?? []).map((a: any) => {
      const rev = nomeRev[a.funil_id] ?? {};
      return [
        dia(dataDaRodada[a.analise_id] ?? null),
        rev.projeto ?? "", rev.rev ?? "",
        a.texto ?? "", a.expectativa ?? "",
        a.feita ? "Sim" : "Não",
        br(a.feita_em), nomePerfil[a.feita_por] ?? "",
        br(a.criada_em),
      ];
    });

    const token = await getGoogleAccessToken(sa);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${planilhaId}`;
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const meta = await (await fetch(base, { headers: auth })).json();
    if (meta.error) throw new Error(`Sheets: ${meta.error.message}`);
    const existentes = meta.sheets ?? [];

    const idAnalises = await ensureSheet(base, auth, ABA_ANALISES, existentes);
    const idAcoes    = await ensureSheet(base, auth, ABA_ACOES, existentes);

    await writeSheet(base, auth, ABA_ANALISES, idAnalises, HEADERS_ANALISES, linhas);
    await writeSheet(base, auth, ABA_ACOES, idAcoes, HEADERS_ACOES, linhasAcoes);

    return ok({ analises: linhas.length, acoes: linhasAcoes.length });
  } catch (e) {
    return ok({ erro: e instanceof Error ? e.message : String(e) });
  }
});
