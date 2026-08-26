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
 *   teste_stats → as métricas dos dois lados de um teste A/B.
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

    // Métricas dos dois lados de um teste A/B.
    case 'teste_stats':
      return ok(await vturb('/comparison_groups/stats', 'POST', {
        comparison_group_id: p.grupo_id,
        items: p.items,
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

    // Traz os testes A/B do VTurb para `testes_funis`, com os números dos dois
    // lados.
    //
    // O que isto resolve: 10 dos 13 testes concluídos estão sem vencedor. Não é
    // desleixo — preencher exigia abrir o VTurb, achar o teste, copiar os
    // números e voltar. Com eles prontos, julgar vira decisão de dois segundos.
    //
    // O VENCEDOR NÃO É PREENCHIDO AQUI, de propósito. O VTurb sabe os números,
    // não o veredito: os 4 testes de lá estão com `finished_at` nulo. Declarar
    // um vencedor por taxa de conversão ignoraria significância e inventaria
    // uma certeza que ninguém tem. A tela mostra os dois lados e ela decide.
    case 'sincronizar_testes': {
      const gl = await vturb('/comparison_groups/list', 'POST', {
        start_date: p.inicio ?? '2026-01-01 00:00:00',
        end_date: p.fim ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
        timezone: 'America/Sao_Paulo',
      });
      if (gl.erro) return ok(gl);

      const pl = await vturb('/players/list', 'GET', {});
      if (pl.erro) return ok(pl);
      const porId = new Map(
        ((pl.dados ?? []) as Array<{ id: string; name: string; duration: number; pitch_time: number }>)
          .map((x) => [x.id, x]),
      );

      const grupos = (gl.dados ?? []) as Array<{
        id: string; name: string; player_ids: string[];
        started_at: string | null; finished_at: string | null;
      }>;

      let gravados = 0;
      const problemas: string[] = [];

      for (const g of grupos) {
        const items = g.player_ids.map((id) => ({
          player_id: id,
          video_duration: porId.get(id)?.duration ?? null,
          pitch_time: porId.get(id)?.pitch_time ?? null,
        }));

        const st = await vturb('/comparison_groups/stats', 'POST', {
          comparison_group_id: g.id,
          items,
          timezone: 'America/Sao_Paulo',
        });
        if (st.erro) { problemas.push(`${g.name}: ${st.erro}`); continue; }

        type Lado = {
          player_id: string;
          views: { total_uniq_device: number };
          plays: { total_uniq_device: number };
          conversions: { total_uniq_device: number; total_amount_brl: number };
        };

        const lados = ((st.dados?.stats ?? []) as Lado[]).map((x) => {
          const views = x.views?.total_uniq_device ?? 0;
          const conv  = x.conversions?.total_uniq_device ?? 0;
          return {
            player_id: x.player_id,
            vsl: porId.get(x.player_id)?.name ?? x.player_id,
            views,
            plays: x.plays?.total_uniq_device ?? 0,
            conversoes: conv,
            faturamento_brl: x.conversions?.total_amount_brl ?? 0,
            // Guardo a taxa calculada junto do numerador e do denominador de
            // propósito: quem ler depois consegue conferir a conta em vez de
            // ter que confiar nela.
            taxa_conversao: views > 0 ? +(conv / views * 100).toFixed(2) : null,
          };
        });

        // Só descreve o que aconteceu; não diz quem ganhou.
        const resumo = (i: number) => lados[i]
          ? `${lados[i].vsl}: ${lados[i].conversoes} conversões em ${lados[i].views} views `
            + `(${lados[i].taxa_conversao ?? '—'}%), R$ ${Math.round(lados[i].faturamento_brl)}`
          : null;

        const linha = {
          vturb_comparison_id: g.id,
          titulo: g.name,
          tipo: 'ab_interno',
          categoria: 'pagina',
          metrica: 'Conversão (conversões ÷ views)',
          variante_a: lados[0]?.vsl ?? null,
          variante_b: lados[1]?.vsl ?? null,
          resultado_a: resumo(0),
          resultado_b: resumo(1),
          data_inicio: g.started_at ? g.started_at.slice(0, 10) : null,
          data_fim: g.finished_at ? g.finished_at.slice(0, 10) : null,
          pipeline_status: g.finished_at ? 'concluido' : 'rodando',
          metricas_vturb: { sincronizado_em: new Date().toISOString(), lados },
        };

        // `onConflict` na chave do VTurb: re-sincronizar ATUALIZA os números.
        // Um teste rodando muda de número todo dia, e um retrato velho seria
        // pior que nenhum — alguém decidiria por um dado de duas semanas atrás.
        const { error } = await supabaseAdmin
          .from('testes_funis')
          .upsert(linha, { onConflict: 'vturb_comparison_id' });

        if (error) problemas.push(`${g.name}: ${error.message}`);
        else gravados++;
      }

      // Tenta ligar ao REV pela VSL. Devolve 0 enquanto nenhum REV tiver VSL
      // escolhida, e a mensagem precisa dizer isso — senão parece falha.
      const { data: ligados } = await supabaseAdmin.rpc('fn_backfill_funil_dos_testes');

      return ok({
        dados: {
          testes_no_vturb: grupos.length,
          gravados,
          ligados_a_um_rev: ligados ?? 0,
          problemas,
        },
      });
    }

    default:
      return ok({ erro: `Ação desconhecida: ${acao}` });
  }
});
