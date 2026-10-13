import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Carimba, todo dia, os tres indicadores que moram no Supabase da Area de
 * Membros Handify -- que e outro projeto, e por isso `fn_metas_medir` nao os
 * alcanca.
 *
 *   ativacao_30d_pct      de quem fez conta nos ultimos 30 dias, quantas
 *                         abriram alguma aula
 *   retencao_30_60d_pct   de quem fez conta entre 30 e 60 dias atras,
 *                         quantas voltaram a abrir aula nos ultimos 30 dias
 *   bumps_abertos_pct     de cada par (compradora, curso) concedido por order
 *                         bump numa venda paga, em quantos ela CONCLUIU
 *                         alguma aula daquele curso
 *
 * ── Por que isto nao pode esperar ──────────────────────────────────────────
 *
 * `lesson_progress` tem UNIQUE(user_id, lesson_id) e sobrescreve `updated_at`
 * a cada toque. Quem abriu uma aula em agosto e voltou nela em outubro teve o
 * carimbo de agosto APAGADO. Nao existe historico para reconstruir: a serie so
 * pode comecar no dia em que alguem passar a grava-la, e cada dia sem rodar e
 * um dia que nao volta.
 *
 * E a quarta armadilha do CLAUDE.md na forma mais literal que ja apareceu
 * aqui -- carga inicial preenche o passado, gatilho mantem o presente, e aqui
 * nem passado ha. O primeiro ponto foi carimbado a mao em 12/10/2026; desta
 * funcao em diante, e ela.
 *
 * ── Por que puxa linha em vez de pedir a conta pronta ─────────────────────
 *
 * O jeito barato seria uma funcao SQL do lado de la devolvendo os tres
 * numeros. Mas a autorizacao dela foi explicita: "quero que apenas visualise,
 * nao mude nada la". Criar funcao e mudar, entao nao criei.
 *
 * O jeito seguinte seria agregar pelo PostgREST. Medido em 12/10/2026:
 * `select=count()` responde `PGRST123: Use of aggregate functions is not
 * allowed` -- agregado esta desligado naquele projeto.
 *
 * Sobrou puxar as colunas minimas e contar aqui. O volume e pequeno para uma
 * rodada diaria:
 *
 *     profiles              5.503 linhas   (id, email, created_at, role, banned)
 *     lesson_progress 30d  15.713 linhas   (so user_id)
 *     lesson_progress feita 35.771 linhas  (user_id, lesson_id)
 *     payment_events pagos  6.050 linhas   (buyer_email e so o order_bumps do payload)
 *     lessons + modules       270 linhas
 *     courses                  24 linhas
 *
 * Conferido em 12/10/2026 rodando a mesma logica contra a API real: a funcao
 * reproduz 82,3 / 29,8 / 7,3 e tambem os totais, 7.561 pares e 1.195 sem
 * conta. Conferir so a TAXA teria deixado passar o defeito dos codigos de
 * checkout -- ver o comentario de `codigoParaCursos`.
 *
 * ── O que esta funcao NAO faz ─────────────────────────────────────────────
 *
 * Nao escreve NADA na Area de Membros. Toda leitura passa por `puxar`, que
 * fixa `method: 'GET'` no proprio corpo -- nao ha como alguem acrescentar um
 * POST sem reescrever a funcao e ver o comentario que explica por que ela e
 * assim. A chave de la e service_role e passa por cima de toda a RLS daquele
 * projeto; e so por isso que a porta precisa estar pregada, e nao so fechada.
 */

const env = (n: string) => (Deno.env.get(n) ?? '').trim();

/* Da Area de Membros. Nomes com prefixo MEMBROS_ para nunca se confundirem
   com os do proprio painel, que o Supabase injeta sozinho. */
const MEMBROS_URL    = env('MEMBROS_SUPABASE_URL');
const MEMBROS_KEY    = env('MEMBROS_SERVICE_ROLE_KEY');
const MEMBROS_SEGREDO = env('MEMBROS_SYNC_SECRET');

/* Do painel, injetados pelo Supabase. */
const URL_PAINEL  = env('SUPABASE_URL');
const CHAVE_PAINEL = env('SUPABASE_SERVICE_ROLE_KEY');

const PAGINA = 1000;

interface Resposta {
  ok: boolean;
  medido_em?: string;
  valores?: Record<string, number | null>;
  detalhe?: Record<string, unknown>;
  erro?: string;
}

function json(corpo: Resposta, status = 200) {
  return new Response(JSON.stringify(corpo, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET paginado no PostgREST da Area de Membros.
 *
 * Nunca aceita metodo diferente de GET: a chave que vai no cabecalho e
 * service_role e passa por cima de toda RLS de la. Deixar a porta aberta para
 * um POST "so para testar" e como estes acidentes comecam.
 */
async function puxar<T>(caminho: string): Promise<T[]> {
  const saida: T[] = [];
  let de = 0;
  let total = Number.NaN;

  for (;;) {
    const r = await fetch(`${MEMBROS_URL}/rest/v1/${caminho}`, {
      method: 'GET',
      headers: {
        apikey: MEMBROS_KEY,
        Authorization: `Bearer ${MEMBROS_KEY}`,
        Range: `${de}-${de + PAGINA - 1}`,
        'Range-Unit': 'items',
        /* Sem `count=exact` o PostgREST devolve `0-999/*` e nao ha como saber
           quando acabou. Ver o comentario do laco abaixo. */
        Prefer: 'count=exact',
      },
    });

    if (!r.ok) {
      throw new Error(`Area de Membros respondeu ${r.status} em ${caminho}: ${await r.text()}`);
    }

    const lote = (await r.json()) as T[];
    saida.push(...lote);

    /* Avanca pelo que VEIO, nao pelo que foi pedido.
       A primeira versao fazia `de += PAGINA` e parava em `lote.length <
       PAGINA`. Se o `max-rows` do servidor fosse menor que PAGINA -- e e
       configuracao do projeto, nao constante -- toda pagina voltaria
       incompleta, o laco pararia na primeira e o indicador sairia calculado
       sobre uma fracao das linhas. Sem erro, sem aviso: so um numero menor.
       Exatamente o tipo de truncamento silencioso que o CLAUDE.md manda
       caçar. */
    de += lote.length;

    const totalDaFaixa = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    if (Number.isFinite(totalDaFaixa)) total = totalDaFaixa;

    if (lote.length === 0) break;
    if (Number.isFinite(total)) { if (de >= total) break; }
    else if (lote.length < PAGINA) break;

    if (de > 500_000) throw new Error(`paginacao de ${caminho} passou de 500 mil linhas`);
  }

  /* Se o servidor disse quantas linhas havia, cobra-se o combinado. Ler menos
     do que existe e o defeito que mais importa aqui, porque ele se parece com
     um numero legitimo. */
  if (Number.isFinite(total) && saida.length !== total) {
    throw new Error(`${caminho}: li ${saida.length} linhas e o servidor disse que havia ${total}`);
  }

  return saida;
}

const iso = (d: Date) => d.toISOString();
const chaveDoPar = (u: string, c: string) => `${u}|${c}`;

Deno.serve(async (req) => {
  /* Mesmo contrato dos outros crons do painel: o segredo vem do Vault no
     `net.http_post` e e conferido aqui. */
  if (!MEMBROS_SEGREDO || req.headers.get('x-sync-secret') !== MEMBROS_SEGREDO) {
    return json({ ok: false, erro: 'segredo invalido' }, 401);
  }

  if (!MEMBROS_URL || !MEMBROS_KEY) {
    return json({
      ok: false,
      erro: 'faltam MEMBROS_SUPABASE_URL e/ou MEMBROS_SERVICE_ROLE_KEY nos segredos da funcao',
    }, 500);
  }

  try {
    const agora = new Date();
    const d30 = new Date(agora.getTime() - 30 * 86_400_000);
    const d60 = new Date(agora.getTime() - 60 * 86_400_000);

    /* ---------------------------------------------------------------------
       1. Quem e aluna, e quem abriu aula nos ultimos 30 dias.
       --------------------------------------------------------------------- */
    const perfis = await puxar<{ id: string; email: string | null; created_at: string; role: string; banned: boolean }>(
      'profiles?select=id,email,created_at,role,banned',
    );

    const ativasAgora = new Set(
      (await puxar<{ user_id: string }>(
        `lesson_progress?select=user_id&updated_at=gte.${iso(d30)}`,
      )).map(r => r.user_id),
    );

    /* `role='student' and not banned` e o mesmo recorte que o card "Alunas
       ativas" da Visao Geral de la ja usa com esse nome. Em vez de criar um
       segundo numero rival, os dois passam a ser a mesma fracao. */
    const alunas = perfis.filter(p => p.role === 'student' && !p.banned);

    const naJanela = (p: typeof alunas[number], de: Date, ate?: Date) => {
      const t = new Date(p.created_at).getTime();
      return t >= de.getTime() && (ate === undefined || t < ate.getTime());
    };

    const novatas  = alunas.filter(p => naJanela(p, d30));
    const coorte   = alunas.filter(p => naJanela(p, d60, d30));

    const pct = (n: number, d: number) => (d === 0 ? null : Math.round((1000 * n) / d) / 10);

    const ativacao = pct(novatas.filter(p => ativasAgora.has(p.id)).length, novatas.length);
    const retencao = pct(coorte.filter(p => ativasAgora.has(p.id)).length, coorte.length);

    /* ---------------------------------------------------------------------
       2. Bumps: o par (compradora, curso) que um bump concedeu, e se ela
          concluiu alguma aula daquele curso.
       --------------------------------------------------------------------- */
    const cursos  = await puxar<{ id: string; checkout_codes: string[] | null }>('courses?select=id,checkout_codes');
    const aulas   = await puxar<{ id: string; module_id: string }>('lessons?select=id,module_id');
    const modulos = await puxar<{ id: string; course_id: string }>('modules?select=id,course_id');

    const moduloParaCurso = new Map(modulos.map(m => [m.id, m.course_id]));
    const aulaParaCurso = new Map<string, string>();
    for (const a of aulas) {
      const c = moduloParaCurso.get(a.module_id);
      if (c) aulaParaCurso.set(a.id, c);
    }

    /* Codigo de checkout -> cursoS, no plural, e isso NAO e detalhe.
       Medido em 12/10/2026: dos 42 codigos distintos, 10 aparecem em mais de
       um curso e um deles concede 23 -- e a biblioteca inteira.

       A primeira versao guardava `Map<codigo, curso>` e o ultimo curso lido
       sobrescrevia os outros. O resultado passou no teste assim mesmo, porque
       a TAXA continuou 7,3%: o que caiu pela metade foi o denominador, de
       7.561 pares para 3.007. Numero certo pelo motivo errado e o pior tipo
       de acerto, e so apareceu porque a prova comparava tambem os totais. */
    const codigoParaCursos = new Map<string, string[]>();
    for (const c of cursos) {
      for (const cod of c.checkout_codes ?? []) {
        const ja = codigoParaCursos.get(cod);
        if (ja) ja.push(c.id); else codigoParaCursos.set(cod, [c.id]);
      }
    }

    const emailParaPerfil = new Map<string, string>();
    for (const p of perfis) {
      const e = (p.email ?? '').trim().toLowerCase();
      if (e) emailParaPerfil.set(e, p.id);
    }

    const concluiuPar = new Set<string>();
    for (const r of await puxar<{ user_id: string; lesson_id: string }>(
      'lesson_progress?select=user_id,lesson_id&completed=is.true',
    )) {
      const curso = aulaParaCurso.get(r.lesson_id);
      if (curso) concluiuPar.add(chaveDoPar(r.user_id, curso));
    }

    const pagos = await puxar<{ buyer_email: string | null; order_bumps: unknown }>(
      'payment_events?select=buyer_email,order_bumps:payload->order_bumps&event_type=eq.paid',
    );

    /* Um par distinto por (compradora, curso). Um bump "grouped" concede 5
       cursos de proposito, e vira 5 pares: sao 5 coisas para abrir. */
    const paresBump = new Set<string>();
    for (const ev of pagos) {
      const email = (ev.buyer_email ?? '').trim().toLowerCase();
      if (!email) continue;
      const bumps = Array.isArray(ev.order_bumps) ? ev.order_bumps : [];
      for (const b of bumps as Array<{ product?: { code?: string } }>) {
        for (const curso of codigoParaCursos.get(b?.product?.code ?? '') ?? []) {
          paresBump.add(chaveDoPar(email, curso));
        }
      }
    }

    let semConta = 0;
    let concluiu = 0;
    for (const par of paresBump) {
      const [email, curso] = par.split('|');
      const user = emailParaPerfil.get(email);
      /* Quem pagou e nunca criou conta FICA no denominador: pagou e nao usou e
         exatamente o que o indicador quer flagrar. Conferido em 12/10/2026 que
         nao e falha de casamento -- 1.194 dos 1.195 tem convite emitido. */
      if (!user) { semConta++; continue; }
      if (concluiuPar.has(chaveDoPar(user, curso))) concluiu++;
    }

    const bumps = pct(concluiu, paresBump.size);

    /* ---------------------------------------------------------------------
       3. Carimba no painel.
       --------------------------------------------------------------------- */
    const medidoEm = agora.toISOString().slice(0, 10);
    const valores: Record<string, number | null> = {
      ativacao_30d_pct: ativacao,
      retencao_30_60d_pct: retencao,
      bumps_abertos_pct: bumps,
    };

    const linhas = Object.entries(valores)
      .filter(([, v]) => v !== null)
      .map(([kpi, valor]) => ({
        kpi,
        valor,
        medido_em: medidoEm,
        origem: 'area_membros',
        observacao: null,
      }));

    if (linhas.length !== 3) {
      /* Denominador zerado em algum dos tres e sinal de que a leitura veio
         pela metade. Gravar dois de tres deixaria um buraco na serie que
         ninguem notaria depois. */
      throw new Error(
        `so ${linhas.length} de 3 indicadores tiveram denominador: ${JSON.stringify(valores)}`,
      );
    }

    const painel = createClient(URL_PAINEL, CHAVE_PAINEL);
    const { error } = await painel
      .from('metas_medicao')
      .upsert(linhas, { onConflict: 'kpi,empresa_id,medido_em' });

    if (error) throw new Error(`nao consegui gravar em metas_medicao: ${error.message}`);

    return json({
      ok: true,
      medido_em: medidoEm,
      valores,
      detalhe: {
        alunas: alunas.length,
        novatas: novatas.length,
        coorte_30_60d: coorte.length,
        ativas_30d: ativasAgora.size,
        pares_bump: paresBump.size,
        pares_sem_conta: semConta,
        pares_concluidos: concluiu,
      },
    });
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
