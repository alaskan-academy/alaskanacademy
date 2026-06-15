import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SPREADSHEET_ID = "1UZKGatkgox6GC2yKuT_bPNVx5eMqh5ZERq3EaYdcLl8";
const SHEET_ATIVOS    = "Referências";
const SHEET_EXCLUIDOS = "Ref. Excluídas";

const HEADERS_ATIVOS = [
  "Título", "Área", "Categoria", "Descrição",
  "Links", "Nº Imagens", "Imagem 1", "Imagem 2", "Imagem 3", "Tags",
  "Criado por", "Criado em", "Atualizado por", "Atualizado em",
];

const HEADERS_EXCLUIDOS = [
  "Título", "Área", "Categoria", "Descrição",
  "Links", "Nº Imagens", "Imagem 1", "Imagem 2", "Imagem 3", "Tags",
  "Criado por", "Criado em", "Atualizado por", "Atualizado em",
  "Excluído em", "Excluído por",
];

const CATEGORIA_LABEL: Record<string, string> = {
  trafego:        "Tráfego",
  criativo:       "Criativo",
  funil_oferta:   "Funil & Oferta",
  produto:        "Produto",
  relacionamento: "Relacionamento",
  interno:        "Interno",
};

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

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function buildRow(
  r: any,
  areaMap: Record<string, any>,
  emailMap: Record<string, string>,
): string[] {
  const area = areaMap[r.area_id];
  const imagens = r.imagens ?? [];
  // Cada imagem vira um HYPERLINK clicável no Sheets; células vazias para as ausentes
  // URL pura — Sheets detecta automaticamente e torna clicável (sem problema de locale)
  const imgCell = (url: string | undefined) => url ?? "";

  return [
    r.titulo      ?? "",
    area?.nome    ?? "",
    CATEGORIA_LABEL[area?.categoria] ?? area?.categoria ?? "",
    r.descricao   ?? "",
    (r.links ?? []).join("\n"),
    imagens.length > 0 ? String(imagens.length) : "",
    imgCell(imagens[0]),
    imgCell(imagens[1]),
    imgCell(imagens[2]),
    (r.tags ?? []).join(", "),
    emailMap[r.criado_por]     ?? "",
    fmtDate(r.criado_em),
    emailMap[r.atualizado_por] ?? "",
    fmtDate(r.atualizado_em),
  ];
}

async function ensureSheet(
  base: string,
  auth: Record<string, string>,
  title: string,
  existingSheets: any[],
): Promise<number> {
  const found = existingSheets.find((s: any) => s.properties.title === title);
  if (found) return found.properties.sheetId as number;
  const res  = await fetch(`${base}:batchUpdate`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  const data = await res.json();
  return data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
}

async function writeSheet(
  base: string,
  auth: Record<string, string>,
  sheetName: string,
  sheetId: number,
  headers: string[],
  rows: string[][],
): Promise<void> {
  await fetch(
    `${base}/values/${encodeURIComponent(sheetName + "!A1:Z10000")}:clear`,
    { method: "POST", headers: auth },
  );
  const writeRes = await fetch(
    `${base}/values/${encodeURIComponent(sheetName + "!A1")}?valueInputOption=USER_ENTERED`,
    { method: "PUT", headers: auth, body: JSON.stringify({ values: [headers, ...rows] }) },
  );
  if (!writeRes.ok) throw new Error(`Sheets write error (${sheetName}): ${await writeRes.text()}`);

  await fetch(`${base}:batchUpdate`, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor:     { red: 0.11, green: 0.11, blue: 0.11 },
                textFormat:          { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length },
          },
        },
      ],
    }),
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const saJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
    if (!saJson) throw new Error("Secret GOOGLE_SERVICE_ACCOUNT não configurado.");
    const sa = JSON.parse(saJson) as Record<string, string>;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [
      { data: ativos },
      { data: excluidos },
      { data: areas },
      { data: { users } },
    ] = await Promise.all([
      supabase.from("referencias").select("*").is("deletado_em", null).order("criado_em", { ascending: false }),
      supabase.from("referencias").select("*").not("deletado_em", "is", null).order("deletado_em", { ascending: false }),
      supabase.from("radar_areas").select("id, nome, categoria"),
      supabase.auth.admin.listUsers({ perPage: 1000 }),
    ]);

    const areaMap  = Object.fromEntries((areas ?? []).map((a: any) => [a.id, a]));
    const emailMap = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.email ?? ""]));

    const rowsAtivos    = (ativos    ?? []).map((r: any) => buildRow(r, areaMap, emailMap));
    const rowsExcluidos = (excluidos ?? []).map((r: any) => [
      ...buildRow(r, areaMap, emailMap),
      fmtDate(r.deletado_em),
      emailMap[r.deletado_por] ?? "",
    ]);

    const token = await getGoogleAccessToken(sa);
    const base  = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;
    const auth  = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const metaRes = await fetch(`${base}?fields=sheets.properties`, { headers: auth });
    const meta    = await metaRes.json();
    if (meta.error) throw new Error(`Sheets meta error: ${JSON.stringify(meta.error)}`);

    const existingSheets = meta.sheets ?? [];
    const [sheetIdAtivos, sheetIdExcluidos] = await Promise.all([
      ensureSheet(base, auth, SHEET_ATIVOS,    existingSheets),
      ensureSheet(base, auth, SHEET_EXCLUIDOS, existingSheets),
    ]);

    await Promise.all([
      writeSheet(base, auth, SHEET_ATIVOS,    sheetIdAtivos,    HEADERS_ATIVOS,    rowsAtivos),
      writeSheet(base, auth, SHEET_EXCLUIDOS, sheetIdExcluidos, HEADERS_EXCLUIDOS, rowsExcluidos),
    ]);

    return new Response(
      JSON.stringify({ ok: true, synced: rowsAtivos.length, excluidos: rowsExcluidos.length }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (err: any) {
    console.error("[referencias-sheets-sync]", err);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
});
