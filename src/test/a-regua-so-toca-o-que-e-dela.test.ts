/**
 * A régua de avaliação só pode tocar o que é dela.
 *
 * ── O que está em jogo, em número ─────────────────────────────────────────
 *
 * `producoes.avaliacao` tem 3.212 valores preenchidos. Medido em 09/10/2026,
 * só **393 cards** passaram pela tela em toda a história (583 alterações em
 * `criativo_historico`, desde 29/07/2026). Os outros ~2.800 vieram de uma
 * importação.
 *
 * Em 09/10/2026 ela decidiu que a régua automática vale **só para cards
 * novos** — nada do que já existe é tocado. A decisão foi implementada como
 * selo, não como data: `20261009b` carimbou `avaliacao_origem` em todos os
 * 3.860 cards já postados ou arquivados ('humano' nos 393, 'fora_do_escopo' no
 * resto) e deixou NULO nos 326 que ainda vão ser postados.
 *
 * O escopo da régua é, literalmente, `avaliacao_origem IS NULL OR =
 * 'automatico'`. Uma guarda esquecida num `update` não dá erro, não aparece na
 * tela e apaga de uma vez os 393 julgamentos reais — a única coisa confiável
 * que existe naquele campo — e os 2.800 que ela pediu para não mexer.
 *
 * ── Por que ler o arquivo, e não o banco ─────────────────────────────────
 *
 * Porque o defeito não se manifesta como erro: ele se manifesta como dado certo
 * virando dado errado, em silêncio, na primeira vez que o cron rodar. O único
 * jeito de impedir é ler as migrações — o mesmo caminho de
 * `aliquota-do-simples-e-medida` e `o-empate-e-um-so`, e a razão pela qual o
 * CLAUDE.md proíbe migração sem arquivo.
 *
 * Os comentários saem antes de qualquer busca: este arquivo e as migrações
 * explicam a regra em prosa citando as mesmas strings que ela proíbe, e um
 * teste que tropeça na própria documentação é um teste que alguém desliga.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const SRC = join(process.cwd(), 'src');

function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const migracoes = readdirSync(MIGRACOES)
  .filter(n => n.endsWith('.sql')).sort()
  .map(nome => ({ nome, sql: readFileSync(join(MIGRACOES, nome), 'utf8') }));

/** A última migração que define um objeto, sem comentários. */
function ultimaQueDefine(re: RegExp): { nome: string; sql: string } {
  let achado: { nome: string; sql: string } | null = null;
  for (const m of migracoes) if (re.test(m.sql)) achado = { nome: m.nome, sql: semComentarios(m.sql) };
  if (!achado) throw new Error(`nenhuma migração casa ${re} — o teste ficou cego`);
  return achado;
}

function fontes(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) fontes(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}
const FONTES = fontes(SRC).filter(f => !f.includes('test'));

function codigoDe(arquivo: string): string {
  return readFileSync(arquivo, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
}

/**
 * A GUARDA, nas DUAS formas aceitáveis.
 *
 * A ampla — `is null or = 'automatico'` — é o escopo da régua: ela escreve onde
 * ainda não há procedência e onde a procedência é dela mesma.
 *
 * A estreita — só `= 'automatico'` — é mais segura, e é a que
 * `fn_desfazer_avaliacao_automatica` usa de propósito: desfazer não deve tocar
 * card que a régua nunca escreveu. Exigir a forma ampla ali seria o teste
 * cobrando uma guarda PIOR que a que está no código.
 */
/*
  A ÚLTIMA peneira é a que faltava, e ela apareceu plantando a isca.

  A primeira versão deste regex aceitava a forma estreita solta
  (`avaliacao_origem = 'automatico'`) — e com isso passou a casar o
  `set avaliacao_origem = 'automatico'` do próprio UPDATE. Removi uma das duas
  guardas da migração de propósito e o teste passou verde: ele estava contando a
  ATRIBUIÇÃO como se fosse condição.

  Por isso a forma estreita exige vir depois de `and` ou `where`. A forma ampla
  não precisa: `is null or` nunca aparece num `set`.
*/
const GUARDA = new RegExp(
  '(' +
  'avaliacao_origem\\s+is\\s+null\\s+or\\s+[a-z_.]*avaliacao_origem\\s*=\\s*\'automatico\'' +
  '|' +
  '\\b(?:and|where)\\s+\\(?\\s*[a-z_.]*avaliacao_origem\\s*=\\s*\'automatico\'' +
  ')', 'i');

/**
 * A régua estreou em 09/10/2026. Migrações anteriores não podem ser cobradas
 * por uma guarda que não existia.
 *
 * Mesmo recorte de `view-nova-nao-fura-a-rls.test.ts`, que tem um
 * `A_PARTIR_DE`: a alternativa seria condenar a história retroativamente, e um
 * teste que começa vermelho por causa do passado é um teste que alguém
 * desliga. O caso concreto aqui é `20260827zo_deduplica_cards_da_importacao`,
 * que mesclou cards duplicados da importação e legitimamente escreveu em
 * `avaliacao` e `status_veiculacao` — em agosto, quando os dois campos eram
 * digitados e não havia régua nenhuma.
 */
const A_PARTIR_DE = '20261009';
const DAQUI_PRA_FRENTE = migracoes.filter(m => m.nome >= A_PARTIR_DE);

describe('a régua só toca o que é dela', () => {
  it('todo UPDATE de producoes.avaliacao nas migrações carrega a guarda', () => {
    /*
      A varredura é sobre TODAS as migrações, não só a da régua: o risco não é a
      função que eu escrevi hoje, é a que alguém escrever em três meses para
      "arrumar as avaliações antigas".

      Exceção explícita e justificada: `20261009b`, o backfill de procedência.
      Ele é a migração que CRIA o selo, então não pode exigi-lo — e ele não
      toca `avaliacao`, só `avaliacao_origem`, o que o teste confere adiante.
    */
    const suspeitos: string[] = [];

    for (const m of DAQUI_PRA_FRENTE) {
      const sql = semComentarios(m.sql);
      /* Cada `update ... producoes ... set ...` até o fim do comando. */
      for (const bloco of sql.match(/update\s+(?:public\.)?producoes[\s\S]*?;/gi) ?? []) {
        /* Só interessa quem mexe no VALOR da avaliação. Quem mexe apenas na
           procedência é outro assunto (o backfill, e o botão de confirmar). */
        if (!/\bset\b[\s\S]*?\bavaliacao\s*=/i.test(bloco)) continue;
        if (!GUARDA.test(bloco)) {
          suspeitos.push(`${m.nome} — update de avaliacao sem a guarda de origem`);
        }
      }
    }

    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('a função da régua tem a guarda no CTE e no próprio update', () => {
    /* Duas vezes de propósito. A view já filtra por `no_escopo`, mas é no
       `update` que o estrago aconteceria, e um dia alguém mexe no CTE. */
    const re = /create\s+or\s+replace\s+function\s+public\.fn_avaliar_criativos/i;
    const { nome, sql } = ultimaQueDefine(re);

    /*
      RECORTAR O CORPO, e não contar no arquivo inteiro.

      Segunda cegueira achada plantando a isca: a migração define DUAS funções,
      e `fn_desfazer_avaliacao_automatica` também tem guarda. Contando no
      arquivo todo, apagar uma das duas guardas de `fn_avaliar_criativos`
      continuava dando 2 — uma dela, uma da vizinha — e o teste passava verde
      sobre a função desprotegida.
    */
    const inicio = sql.search(re);
    const fim = sql.indexOf('$fn$;', inicio);
    expect(fim, `não consegui recortar o corpo de fn_avaliar_criativos em ${nome}`)
      .toBeGreaterThan(inicio);
    const corpo = sql.slice(inicio, fim);

    const guardas = (corpo.match(new RegExp(GUARDA.source, 'gi')) ?? []).length;
    expect(guardas, `${nome} tem ${guardas} guarda(s) em fn_avaliar_criativos, esperava ao menos 2 `
      + '(uma no CTE que escolhe os alvos, outra no WHERE do próprio UPDATE)')
      .toBeGreaterThanOrEqual(2);
  });

  it('a régua NUNCA escreve em criativo_historico', () => {
    /*
      `criativo_historico` é a única prova de toque humano. Foi ela que permitiu
      separar os 393 julgamentos reais da carga, em `20261009b` — e ela também
      alimenta `fn_desempenho_editores` e a tela "o que eu aprovei".
      Enchê-la de 2.100 linhas de máquina destruiria a prova que o próprio
      backfill usou, e inflaria o desempenho dos editores com trabalho que
      ninguém fez.
    */
    for (const objeto of [
      /create\s+or\s+replace\s+function\s+public\.fn_avaliar_criativos/i,
      /create\s+or\s+replace\s+function\s+public\.trg_avaliar_card_novo/i,
    ]) {
      const { nome, sql } = ultimaQueDefine(objeto);
      /* Recorta só o corpo da função, para não casar com outra coisa da
         migração que legitimamente escreva no histórico. */
      const corpo = sql.slice(sql.search(objeto));
      expect(corpo, `${nome} escreve em criativo_historico`)
        .not.toMatch(/insert\s+into\s+(?:public\.)?criativo_historico/i);
    }
  });

  it('a régua NUNCA toca a marcação', () => {
    /* `status_veiculacao` é intenção dela, e a divergência com o Meta é o alarme
       que achou 24 cards dados por encerrados gastando R$ 5.691,62 em sete
       dias. Nenhuma migração pode escrever nele — ver também
       `status-veiculacao-e-intencao`. */
    const suspeitos: string[] = [];
    for (const m of DAQUI_PRA_FRENTE) {
      const sql = semComentarios(m.sql);
      for (const bloco of sql.match(/update\s+(?:public\.)?producoes[\s\S]*?;/gi) ?? []) {
        if (/\bset\b[\s\S]*?\bstatus_veiculacao\s*=/i.test(bloco)) {
          suspeitos.push(`${m.nome} — migração escrevendo status_veiculacao`);
        }
      }
    }
    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('o backfill de procedência não mexe em nenhum valor de avaliação', () => {
    const { nome, sql } = ultimaQueDefine(/add\s+column\s+if\s+not\s+exists\s+avaliacao_origem/i);
    for (const bloco of sql.match(/update\s+(?:public\.)?producoes[\s\S]*?;/gi) ?? []) {
      expect(bloco, `${nome} — o backfill de procedência está mexendo em avaliacao`)
        .not.toMatch(/\bset\b[\s\S]*?\bavaliacao\s*=/i);
    }
    /* E ele tem de travar a faixa: 393 medidos. Se vier 2.700, o
       `campo_alterado` mudou de nome e o backfill carimbou a carga inteira
       como julgamento dela. */
    expect(sql, `${nome} não tem prova de faixa para o selo 'humano'`)
      .toMatch(/humano\s*<\s*300\s*or\s*v_humano\s*>\s*500/i);
  });

  it('a tela confirma ao alterar, e nenhum componente escreve nas tabelas da máquina', () => {
    const tela = codigoDe(join(SRC, 'features', 'criativos', 'components', 'AvaliacaoView.tsx'));

    /* Mexer na avaliação é confirmá-la: o valor passa a ser dela e a régua para
       de poder sobrescrever. Sem isto, ela corrige um card e a próxima passada
       horária desfaz a correção — o pior comportamento possível, porque parece
       que a tela não salvou. */
    expect(tela, 'handleChange não grava avaliacao_origem ao alterar a avaliação')
      .toMatch(/avaliacao_origem:\s*'humano'/);

    /* E as tabelas da máquina são só da máquina: componente que escreve nelas
       estraga o desfazer e a fila. */
    const suspeitos: string[] = [];
    for (const arquivo of FONTES) {
      const codigo = codigoDe(arquivo);
      for (const tabela of ['avaliacao_sugerida', 'avaliacao_automatica_log']) {
        /* `.from('tabela')` seguido de escrita. Leitura é permitida — a tela
           PRECISA ler a sugestão para mostrar "a régua discorda". */
        const re = new RegExp(`from\\('${tabela}'\\)[\\s\\S]{0,120}?\\.(insert|update|upsert|delete)\\(`);
        if (re.test(codigo)) suspeitos.push(`${arquivo.replace(SRC, 'src')} escreve em ${tabela}`);
      }
    }
    expect(suspeitos.join(' | ')).toEqual('');
  });

  it('a fila "a revisar" é procedência, não adivinhação', () => {
    /*
      O antigo `isPendente` era `!avaliacao || avaliacao === 'Sem dados'`. Com a
      régua gravando, 2.669 dos 3.004 criativos postados caem em "Sem dados" —
      um veredito legítimo, porque criativo que não gastou um ticket não tem o
      que ser julgado. A fila teria nascido com dois mil e seiscentos itens e
      ninguém a abriria nunca.
    */
    const tela = codigoDe(join(SRC, 'features', 'criativos', 'components', 'AvaliacaoView.tsx'));
    expect(tela, 'a tela voltou a adivinhar pendência pelo valor da avaliação')
      .not.toMatch(/avaliacao\s*===\s*'Sem dados'/);
    expect(tela, 'a tela não usa a procedência para montar a fila')
      .toMatch(/aRevisar|precisaRevisar/);

    /* E a condição da fila é a MESMA do escopo no banco. Se as duas
       divergirem, a tela mostra como revisável um card que a régua não pode
       escrever, ou esconde um que ela pode. */
    const modulo = codigoDe(join(SRC, 'features', 'criativos', 'avaliacao.ts'));
    expect(modulo, 'aRevisar deixou de espelhar o escopo do banco')
      .toMatch(/!origem\s*\|\|\s*origem\s*===\s*'automatico'/);
  });
});
