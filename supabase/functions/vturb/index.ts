import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Proxy para a Analytics API do VTurb.
 *
 * Existe por um motivo só: a chave não pode chegar ao navegador. A própria
 * documentação do VTurb avisa para "nunca expor sua chave em código público", e
 * um `fetch` direto do dashboard a entregaria em qualquer aba de rede aberta.
 * Aqui ela fica no secret e o front chama esta função autenticado.
 *
 * A API é só de leitura — não existe endpoint que altere player ou vídeo. Então
 * nada que esta função faça, mesmo com bug, mexe nas VSLs no ar.
 *
 * Ações:
 *   players     → lista os players (id + nome). É o que transforma "qual VSL está
 *                 rodando" de digitação em seleção.
 *   sincronizar → espelha os players na tabela `vsls`.
 *   stats       → métricas de um player no período. Traz os cinco campos que hoje
 *                 são digitados à mão na análise quinzenal.
 *   retencao    → a curva de retenção, para ler qualquer marco (1 min, fim da
 *                 lead, pitch) sem depender de campo fixo. Ver a armadilha em
 *                 `src/features/funis/revisao.md`: o dado bruto é histograma,
 *                 não curva.
 *   testes      → os testes A/B que já existem dentro do VTurb.
 *   quota       → quanto da cota foi usada. Serve para diagnóstico.
 */

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const TOKEN = Deno.env.get('VTURB_API_KEY');
const BASE = 'https://analytics.vturb.net';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/**
 * Uma chamada ao VTurb.
 *
 * `GET` leva os parâmetros na query e `POST` no corpo — a API mistura os dois
 * estilos (`/players/list` é GET, quase todo o resto é POST), então o método
 * vem de quem chama em vez de ser adivinhado aqui.
 */
async function vturb(caminho: string, metodo: 'GET' | 'POST', params: Record<string, unknown>) {
  const url = new URL(BASE + caminho);
  if (metodo === 'GET') {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const resp = await fetch(url, {
    method: metodo,
    headers: {
      'X-Api-Token': TOKEN!,
      'X-Api-Version': 'v1',
      'Content-Type': 'application/json',
    },
    body: metodo === 'POST' ? JSON.stringify(params) : undefined,
  });

  const texto = await resp.text();

  if (!resp.ok) {
    // 429 é o único erro que a documentação nomeia, e é o que aparece quando
    // alguém abre a tela várias vezes seguidas. Vale distinguir dos outros para
    // a mensagem dizer "espere" em vez de "deu erro".
    if (resp.status === 429) {
      return { erro: 'O VTurb limitou as chamadas (429). Tente de novo em um minuto.' };
    }
    return { erro: `VTurb respondeu ${resp.status}: ${texto.slice(0, 300)}` };
  }

  try {
    return { dados: JSON.parse(texto) };
  } catch {
    return { erro: `VTurb devolveu algo que não é JSON: ${texto.slice(0, 300)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS, status: 204 });
  }

  // Sem a chave a função não tem o que fazer, e o erro precisa dizer ONDE
  // configurar — senão vira meia hora procurando.
  if (!TOKEN) {
    return ok({
      erro: 'VTURB_API_KEY não está configurada. Supabase → Edge Functions → Secrets. '
          + 'A chave é gerada no painel do VTurb em Configurações → API do Analytics.',
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return ok({ erro: 'Não autenticado' });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return ok({ erro: 'Não autenticado' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return ok({ erro: 'Corpo inválido' });
  }

  const acao = String(body.acao ?? '');
  const p = (body.params ?? {}) as Record<string, unknown>;

  switch (acao) {
    // Lista os players. Sem `start_date`/`end_date` a API devolve todos, que é
    // o que o seletor de VSL precisa: o player existe mesmo sem play no período.
    case 'players':
      return ok(await vturb('/players/list', 'GET', {
        name: p.nome,
        name_match: p.nome ? 'contains' : undefined,
      }));

    // `video_duration` e `pitch_time` mudam o cálculo de retenção e de audiência
    // do pitch. Vêm de `/players/list`, então quem chama já os tem em mãos.
    case 'stats':
      return ok(await vturb('/sessions/stats', 'POST', {
        player_id: p.player_id,
        start_date: p.inicio,
        end_date: p.fim,
        video_duration: p.duracao,
        pitch_time: p.pitch,
        timezone: 'America/Sao_Paulo',
      }));

    case 'retencao':
      return ok(await vturb('/times/user_engagement', 'POST', {
        player_id: p.player_id,
        video_duration: p.duracao,
        start_date: p.inicio,
        end_date: p.fim,
        timezone: 'America/Sao_Paulo',
      }));

    case 'testes':
      return ok(await vturb('/comparison_groups/list', 'POST', {
        start_date: p.inicio,
        end_date: p.fim,
        timezone: 'America/Sao_Paulo',
      }));

    case 'quota':
      return ok(await vturb('/quota/usage', 'GET', {}));

    // Espelha os players do VTurb na tabela `vsls`.
    //
    // Só entra quem tem `pitch_time > 0`. Dos 162 players, 88 passam: o resto é
    // aula da área de membros e upsell curto, onde ninguém configurou pitch.
    // Não é um campo feito para classificar, mas é o único sinal que o VTurb dá
    // — e errar para menos aqui é barato, porque quem faltar aparece na busca
    // do seletor assim que alguém configurar o pitch lá.
    case 'sincronizar': {
      const r = await vturb('/players/list', 'GET', {});
      if (r.erro) return ok(r);

      const players = (r.dados ?? []) as Array<{
        id: string; name: string; duration: number;
        pitch_time: number; created_at: string;
      }>;

      const vsls = players
        .filter((p) => p.pitch_time > 0)
        .map((p) => ({
          id: p.id,
          nome: p.name,
          duracao_seg: p.duration,
          pitch_seg: p.pitch_time,
          criado_em_vturb: p.created_at,
          sincronizado_em: new Date().toISOString(),
        }));

      // `upsert` pela chave primária, que é o id do VTurb: rodar de novo não
      // duplica nem apaga o vínculo que o REV já tem com a VSL.
      const { error } = await supabaseAdmin.from('vsls').upsert(vsls);
      if (error) return ok({ erro: `Falha ao gravar: ${error.message}` });

      return ok({ dados: { players_no_vturb: players.length, vsls_gravadas: vsls.length } });
    }

    default:
      return ok({ erro: `Ação desconhecida: ${acao}` });
  }
});
