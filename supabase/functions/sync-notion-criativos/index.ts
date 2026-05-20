import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NOTION_TOKEN   = Deno.env.get('NOTION_TOKEN')!;
const NOTION_DB_ID   = 'c97f48d8146e4811a84fe5f4de6f2a9a'; // Criativos | DB
const NOTION_VERSION = '2022-06-28';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function notionGet(path: string) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
    },
  });
  return res.json();
}

async function notionPost(path: string, body: unknown) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Resolve user IDs → nomes via /users endpoint (requer "Read user information" na integração)
async function resolveUsers(ids: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const unique = [...new Set(ids)];
  await Promise.all(unique.map(async id => {
    try {
      const u = await notionGet(`/users/${id}`);
      map[id] = u.name || u.person?.email || '';
    } catch {
      map[id] = '';
    }
  }));
  return map;
}

// Resolve IDs de páginas de projeto → nomes em batch
async function resolvePages(urls: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const unique = [...new Set(urls)];
  await Promise.all(unique.map(async url => {
    try {
      // url no formato https://www.notion.so/<id-sem-hifens>
      const pageId = url.replace('https://www.notion.so/', '').replace(/-/g, '').split('?')[0];
      const p = await notionGet(`/pages/${pageId}`);
      const title = p.properties?.Nome?.title?.[0]?.plain_text
        || p.properties?.Name?.title?.[0]?.plain_text
        || p.properties?.Título?.title?.[0]?.plain_text
        || '—';
      map[url] = title;
    } catch {
      map[url] = url;
    }
  }));
  return map;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS, status: 204 });

  try {
    // Busca todas as páginas do banco (paginado)
    const pages: any[] = [];
    let cursor: string | undefined;
    do {
      const body: any = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = await notionPost(`/databases/${NOTION_DB_ID}/query`, body);
      if (res.object === 'error') return ok({ error: `Notion: ${res.message}` });
      pages.push(...(res.results || []));
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    // Coleta todos os user IDs e page URLs para resolver em batch
    const allUserIds: string[] = [];
    const allPageUrls: string[] = [];

    for (const p of pages) {
      const editors: any[] = p.properties?.['Editor Responsável']?.people || [];
      for (const e of editors) if (e.id) allUserIds.push(e.id);

      const projRelations: any[] = p.properties?.['Projeto']?.relation || [];
      for (const r of projRelations) if (r.id) {
        allPageUrls.push(`https://www.notion.so/${r.id.replace(/-/g, '')}`);
      }
    }

    const [userMap, pageMap] = await Promise.all([
      resolveUsers(allUserIds),
      resolvePages(allPageUrls),
    ]);

    // Monta rows
    const rows = pages.map(p => {
      const nome = p.properties?.['Nome']?.title?.[0]?.plain_text || '';
      const editors: any[] = p.properties?.['Editor Responsável']?.people || [];
      // usa nome inline (presente quando integração tem "Read user information"), depois userMap, depois descarta
      const editor_nome = editors
        .map(e => e.name || userMap[e.id] || '')
        .filter(Boolean).join(', ') || null;

      const projRelations: any[] = p.properties?.['Projeto']?.relation || [];
      const projUrls = projRelations.map(r => `https://www.notion.so/${r.id.replace(/-/g, '')}`);
      const projeto_nome = projUrls.map(u => pageMap[u] || '').filter(Boolean).join(', ') || null;

      return { id: p.id, nome, editor_nome, projeto_nome, synced_at: new Date().toISOString() };
    }).filter(r => r.nome);

    // Upsert no Supabase
    const { error } = await supabase
      .from('notion_criativos')
      .upsert(rows, { onConflict: 'id' });

    if (error) return ok({ error: error.message });

    // Remove registros que sumiram do Notion
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      await supabase.from('notion_criativos').delete().not('id', 'in', `(${ids.map(id => `"${id}"`).join(',')})`);
    }

    return ok({ synced: rows.length });
  } catch (e: any) {
    return ok({ error: String(e?.message ?? e) });
  }
});
