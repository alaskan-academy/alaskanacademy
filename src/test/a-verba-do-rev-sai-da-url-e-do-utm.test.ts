/**
 * A verba de um REV sai da URL e do UTM — e `aprovada` só vale para dinheiro.
 *
 * ── O que aconteceu ──────────────────────────────────────────────────────
 *
 * Em 10/10/2026 o card do REV10 mostrava, no período de 26/09 a 10/10:
 *
 *   Investimento   R$ 0,00    "sem conjunto identificado"
 *   Lucro líquido  R$ 56,06   margem de 84,5%
 *
 * O conjunto `07/10 TESTE REV10` existia, com 8 anúncios e **R$ 305,98**
 * gastos. O REV10 era o teste menos rentável do painel aparecendo como o mais
 * rentável: lucro real −R$ 292,76, margem −441,4%, erro de R$ 348,82.
 *
 * ── A causa, e a regra que sai dela ──────────────────────────────────────
 *
 * O vínculo anúncio↔REV saía de `vendas` com `status = 'aprovada'`. O REV10
 * tinha duas vendas: a aprovada sem UTM nenhum, e a que carregava a cadeia
 * inteira — `utm_medium = '07/10 TESTE REV10|120252583859370560'` — **pendente**.
 * O filtro jogava fora exatamente a linha que tinha a resposta.
 *
 *   `status = 'aprovada'` está certo quando se conta DINHEIRO, e errado
 *   quando se estabelece IDENTIDADE.
 *
 * Saber de quem é o tráfego não depende de o pagamento ter caído: o clique
 * aconteceu e o Meta cobrou. Exigir aprovação faz o custo de um teste aparecer
 * só depois da primeira venda paga — ao contrário do que um teste precisa.
 *
 * ── Por que pelo ID, e não pelo nome ─────────────────────────────────────
 *
 * A primeira proposta foi casar `adset_nome ilike '%REV10%'`, e estava errada:
 * `%REV1%` casa com REV10 e REV11, e `REV3 - VSL` não casa com conjunto
 * nenhum porque o conjunto se chama só "REV3". Convenção de nome envelhece —
 * terceira armadilha. A Payt já manda o id dentro do `utm_medium` como
 * "nome|id", e medido em 4.956 linhas ele bate com `metricas_meta` em 100%
 * delas, com ZERO contradições.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

const migracoes = readdirSync(MIGRACOES)
  .filter(n => n.endsWith('.sql')).sort()
  .map(nome => ({ nome, sql: readFileSync(join(MIGRACOES, nome), 'utf8') }));

function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * O CORPO da última definição da função, só o que está entre os delimitadores
 * `$function$`.
 *
 * Fatiar importa: o arquivo inteiro contém o cabeçalho em prosa, a prova e o
 * `comment on function`, e todos citam as palavras que os casos abaixo
 * procuram. Um teste que lesse o arquivo todo passaria verde com a função
 * errada desde que o comentário certo estivesse lá — que é a forma mais
 * silenciosa de um teste ficar cego.
 */
function corpoDaFuncao(): string {
  let achado: string | null = null;
  for (const m of migracoes) {
    if (/create\s+or\s+replace\s+function\s+public\.fn_metricas_do_rev_bloco/i.test(m.sql)) {
      achado = m.sql;
    }
  }
  if (!achado) throw new Error('nenhuma migração define fn_metricas_do_rev_bloco — o teste ficou cego');
  const partes = achado.split(/\$function\$/);
  if (partes.length < 3) throw new Error('não achei o corpo entre $function$ — o teste ficou cego');
  return semComentarios(partes[1]);
}

const CORPO = corpoDaFuncao();

/** O trecho entre dois marcadores do corpo, para cobrar cada metade no lugar. */
function entre(de: string, ate: string): string {
  const i = CORPO.indexOf(de);
  const j = CORPO.indexOf(ate, i + 1);
  if (i < 0 || j < 0) throw new Error(`não achei "${de}".."${ate}" no corpo — o teste ficou cego`);
  return CORPO.slice(i, j);
}

describe('a verba do REV sai da URL e do UTM', () => {
  it('o VÍNCULO não filtra status — venda pendente também prova de quem é o tráfego', () => {
    /*
      O caso central. Eram 2.392 vendas com o id do conjunto no UTM e sem
      aprovação, descartadas — 33% do sinal. Entre elas, a única venda do REV10
      que sabia de onde tinha vindo.
    */
    const vinculo = entre('liga as (', 'ambiguos as (');
    expect(vinculo, 'voltou um filtro de status dentro do vínculo: o custo de um teste some até a primeira venda paga')
      .not.toMatch(/status/i);
  });

  it('o CAIXA continua filtrando aprovada — senão pendente vira faturamento', () => {
    /*
      O outro lado, e sem ele o conserto vira um estrago maior: o REV10 tem uma
      venda pendente de R$ 66,33 que passaria a contar como receita. Tirar o
      filtro dos dois lugares é o erro oposto, e pior que o original.
    */
    const caixa = entre('with todas as (', 'liga as (');
    expect(caixa, "o filtro aprovada saiu do caixa: venda pendente viraria faturamento")
      .toMatch(/status\s*=\s*'aprovada'/i);
  });

  it('o conjunto é lido pelo ID do utm_medium, nunca pelo NOME', () => {
    /*
      `%REV1%` casa com REV10 e REV11; `REV3 - VSL` não casa com "REV3". O id
      não colide e não envelhece.
    */
    expect(CORPO, 'o vínculo deixou de ler o id que a Payt manda dentro do utm_medium')
      .toMatch(/split_part\(\s*v\.utm_medium\s*,\s*'\|'\s*,\s*2\s*\)/i);
    expect(CORPO, 'apareceu casamento por NOME de conjunto — %REV1% casa com REV10 e REV11')
      .not.toMatch(/adset_nome/i);
    expect(CORPO, 'apareceu casamento por nome de campanha')
      .not.toMatch(/campanha_nome/i);
  });

  it('o REV sai do funil_id, que já vem da URL da Payt — e não de outra heurística', () => {
    /*
      `fn_venda_resolve_funil` resolve `vendas.funil_id` a partir do `link_url`
      que a Payt manda, via `funil_checkouts`. O vínculo se apoia nisso em vez
      de reimplementar a resolução — dois caminhos para a mesma pergunta
      divergiriam, que é a primeira armadilha.
    */
    const vinculo = entre('liga as (', 'ambiguos as (');
    expect(vinculo, 'o vínculo parou de sair de vendas.funil_id')
      .toMatch(/v\.funil_id\s+is\s+not\s+null/i);
    expect(vinculo, 'o vínculo passou a resolver a URL por conta própria em vez de usar funil_id')
      .not.toMatch(/funil_checkouts|link_url/i);
  });

  it('conjunto que serve a mais de um REV fica FORA da conta dos dois', () => {
    /*
      Subir de anúncio para conjunto traz o risco de o mesmo real ser contado
      duas vezes. Medido em 10/10/2026: 1 de 120 conjuntos é ambíguo, e gastou
      R$ 0,00 na janela. Mesmo assim é barrado — e dito, não escondido.
    */
    expect(CORPO, 'sumiu a exclusão de conjunto ambíguo: o mesmo real passa a ser contado em dois REVs')
      .toMatch(/not\s+in\s*\(\s*select\s+adset_id\s+from\s+ambiguos\s*\)/i);
    expect(CORPO, 'a regra do ambíguo deixou de ser "mais de um REV"')
      .toMatch(/having\s+count\s*\(\s*distinct\s+funil_id\s*\)\s*>\s*1/i);
    for (const chave of ['conjuntos_ambiguos', 'investimento_ambiguo']) {
      expect(CORPO, `a view parou de dizer o que ficou de fora em \`${chave}\``)
        .toContain(chave);
    }
  });

  it('o aviso que não depende do vínculo continua de pé', () => {
    /*
      `investimento_sem_rev_no_projeto` olha a verba do PROJETO e pergunta onde
      ela foi parar. É o único sinal que funciona quando o vínculo é o que está
      quebrado — os outros três (`distanciaDoMeta`, `baseAnteriorFragil` e os
      dois selos) desligam todos quando o investimento é zero, que é
      exatamente o caso do REV10.
    */
    expect(CORPO, 'sumiu o aviso de verba do projeto fora de REV — o caso do REV10 voltaria a passar em silêncio')
      .toContain('investimento_sem_rev_no_projeto');
    expect(CORPO, 'o aviso parou de olhar as contas do projeto')
      .toMatch(/ac\.projeto_id\s*=/i);
  });

  it('a função segue SECURITY DEFINER com search_path preso', () => {
    /*
      Ela é chamada por `anon`/`authenticated` pela tela e lê `vendas` e
      `metricas_meta` direto. Um `create or replace` desatento que perdesse o
      `set search_path` abriria a porta de sempre.
    */
    const arquivo = migracoes
      .filter(m => /create\s+or\s+replace\s+function\s+public\.fn_metricas_do_rev_bloco/i.test(m.sql))
      .pop()!.sql;
    const assinatura = arquivo.slice(
      arquivo.search(/create\s+or\s+replace\s+function\s+public\.fn_metricas_do_rev_bloco/i),
      arquivo.indexOf('$function$'),
    );
    expect(assinatura, 'a função perdeu SECURITY DEFINER').toMatch(/security\s+definer/i);
    expect(assinatura, 'a função perdeu o search_path preso').toMatch(/set\s+search_path/i);
    expect(assinatura, 'a função deixou de ser STABLE').toMatch(/\bstable\b/i);
  });
});
