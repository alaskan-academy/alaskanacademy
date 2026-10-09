/**
 * O alerta de cadastro conta o que dá para arrumar — e o que não dá, ele diz
 * separado.
 *
 * ── O que ele dizia, e por que isso o matava ──────────────────────────────
 *
 * "155 itens de cadastro esperando arrumação". Revisado item a item em
 * 10/10/2026, **115 não eram arrumáveis**:
 *
 *   · 45 criativos de "Velas Perfeitas" — projeto inativo, 744 criativos
 *     postados e ZERO contas de anúncio mapeadas. Esses cards não podem ganhar
 *     vínculo nem em teoria;
 *   · 63 das 69 produções duplicadas, todas de projeto encerrado;
 *   · 7 cards que não são `tipo = 'criativo'` (ver abaixo).
 *
 * Um alerta que não pode zerar é um alerta que o olho para de ver — a mesma
 * razão pela qual `parado_recente` existe em vez de pintar todo parado de
 * âmbar. E o preço foi concreto: enterrada entre os 115 itens mortos estava a
 * oferta `RAOJGY`, "Guia do Comportamento na Sala de Aula", com **195 vendas e
 * R$ 22.949,86 desde 02/09, ainda vendendo, e sem cadastro**. Ela pesava 1/155
 * do número.
 *
 * ── Duas correções, e elas vão em lugares diferentes de propósito ────────
 *
 * **FATO → view.** `vw_criativo_sem_veiculacao` não filtrava `tipo`.
 * `fn_fixar_vinculo_ads` exige `tipo='criativo'`, então VSL e aula não podem
 * ter vínculo por construção; cobrá-las de "sem veiculação" é acusar alguém de
 * não ter feito algo que o tipo do card nunca faz.
 *
 * **JULGAMENTO → alerta.** "Projeto encerrado não é trabalho" é uma opinião
 * sobre prioridade, não sobre os dados. As views continuam respondendo o fato
 * inteiro ("o que está duplicado?"); o alerta responde a pergunta do dia ("o
 * que eu preciso arrumar?").
 *
 * Essa separação só é segura porque nada mais consome essas views — nenhuma
 * tela do `src/` as cita, e `pg_depend` não aponta dependente. Com uma tela, a
 * tela mostraria 155 e o alerta 40: dois números para a mesma pergunta, que é a
 * primeira armadilha. Por isso o primeiro caso aqui vigia exatamente isso.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const SRC = join(process.cwd(), 'src');

const migracoes = readdirSync(MIGRACOES)
  .filter(n => n.endsWith('.sql')).sort()
  .map(nome => ({ nome, sql: readFileSync(join(MIGRACOES, nome), 'utf8') }));

function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** A última migração que define um objeto, só a definição dele. */
function ultimaDefinicao(re: RegExp, ate: RegExp): string {
  let achado: string | null = null;
  for (const m of migracoes) if (re.test(m.sql)) achado = semComentarios(m.sql);
  if (!achado) throw new Error(`nenhuma migração casa ${re} — o teste ficou cego`);
  const i = achado.search(re);
  const j = achado.slice(i).search(ate);
  return j > 0 ? achado.slice(i, i + j) : achado.slice(i);
}

const VIEW = ultimaDefinicao(
  /create\s+or\s+replace\s+view\s+public\.vw_criativo_sem_veiculacao/i,
  /comment\s+on\s+view/i);

const ALERTA = ultimaDefinicao(
  /create\s+or\s+replace\s+function\s+public\.fn_alerta_cadastro_a_arrumar/i,
  /comment\s+on\s+function/i);

function fontes(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) fontes(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

describe('o alerta de cadastro conta o que dá para arrumar', () => {
  it('as views de cadastro não têm outro consumidor além do alerta', () => {
    /*
      A premissa de todo o resto. Filtrar no alerta e não na view só é honesto
      enquanto o alerta for o único leitor: no dia em que uma tela listar
      `vw_producoes_duplicadas`, ela mostraria 69 e o alerta diria 6 — dois
      números para a mesma pergunta, primeira armadilha.

      Se este caso quebrar, a decisão tem de ser revista: ou a tela aplica o
      mesmo filtro, ou o filtro desce para a view.
    */
    const views = [
      'vw_criativo_sem_veiculacao',
      'vw_producoes_duplicadas',
      'vw_ofertas_faltando',
      'vw_origens_a_classificar',
    ];
    const suspeitos: string[] = [];
    for (const arquivo of fontes(SRC).filter(f => !f.includes('test'))) {
      const codigo = readFileSync(arquivo, 'utf8');
      for (const v of views) {
        if (codigo.includes(v)) suspeitos.push(`${arquivo.replace(SRC, 'src')} lê ${v}`);
      }
    }
    expect(
      suspeitos.join(' | '),
      'uma tela passou a ler as views de cadastro: ou ela aplica o mesmo filtro de '
      + 'projeto ativo que fn_alerta_cadastro_a_arrumar, ou o filtro desce para a view',
    ).toEqual('');
  });

  it('só criativo é cobrado de veiculação — VSL e aula não podem ter vínculo', () => {
    /* `fn_fixar_vinculo_ads` exige `tipo='criativo'`, então a pergunta "virou
       anúncio?" não se aplica aos outros tipos. Eram 7 dos 78. */
    expect(VIEW, 'vw_criativo_sem_veiculacao voltou a não filtrar o tipo')
      .toMatch(/tipo\s*=\s*'criativo'/i);
  });

  it('a VIEW não julga: ela não filtra projeto encerrado', () => {
    /*
      O contrário também tem de ser verdade. Se o filtro de projeto descer para
      a view, ela deixa de responder "o que está sem veiculação?" e passa a
      responder "o que eu preciso arrumar?" — e aí não há mais onde consultar o
      fato inteiro quando alguém quiser fazer a limpeza dos projetos antigos.
    */
    expect(VIEW, 'a view passou a filtrar por projeto ativo — isso é julgamento, e pertence ao alerta')
      .not.toMatch(/\bativo\b/i);
  });

  it('o ALERTA julga: conta só projeto ativo nos dois grupos que têm projeto', () => {
    /* 45 criativos de Velas Perfeitas (inativo, zero contas de anúncio) e 63
       duplicatas de projetos encerrados somavam 108 itens que ninguém ia
       arrumar. */
    expect(ALERTA, 'o alerta não filtra projeto ativo nos criativos sem veiculação')
      .toMatch(/vw_criativo_sem_veiculacao[\s\S]{0,400}?oe\.ativo/i);
    expect(ALERTA, 'o alerta não filtra projeto ativo nas produções duplicadas')
      .toMatch(/vw_producoes_duplicadas\s+where\s+projeto_ativo/i);
  });

  it('ofertas e origens de UTM NÃO são filtradas — é onde está o dinheiro', () => {
    /*
      Elas não pertencem a projeto, e são justamente as que estão certas. A
      oferta `RAOJGY` fez R$ 22.949,86 em 195 vendas desde 02/09 e segue
      vendendo sem cadastro; filtrá-la por engano junto com o resto esconderia
      o único item do alerta que custa dinheiro agora.
    */
    const ofertas = ALERTA.slice(ALERTA.indexOf('vw_ofertas_faltando'));
    expect(ofertas.slice(0, 120), 'as ofertas não cadastradas ganharam um filtro')
      .not.toMatch(/where/i);

    const origens = ALERTA.slice(ALERTA.indexOf('vw_origens_a_classificar'));
    expect(origens.slice(0, 120), 'as origens de UTM ganharam um filtro')
      .not.toMatch(/where/i);
  });

  it('duplicata exige o mesmo TIPO DE TESTE, não só o nome repetido', () => {
    /*
      Revisados um a um os 6 grupos que sobravam em projeto ativo, **nenhum era
      duplicata**: eram o mesmo AD rodando como Vertical, Novo, Horizontal e
      Iteração, cada um com sua `data_inicio`, separadas por semanas ou meses.

        AD 009 H03 V03   Vertical 16/04 · Novo 24/03 · Horizontal 07/04
        AD 009 H02 V04   Horizontal 27/02 postado · Iteração 03/06 arquivado

      O nome do AD é o código da peça; `tipo_teste` é o que diz qual teste é
      aquele. Agrupar só pelo nome junta o que a operação criou de propósito
      separado — e enche o alerta com trabalho que não existe.

      Medido: 69 grupos / 6 ativos pela chave antiga; 58 / 1 com tipo_teste.
    */
    const dup = ultimaDefinicao(
      /create\s+or\s+replace\s+view\s+public\.vw_producoes_duplicadas/i,
      /comment\s+on\s+view/i);

    expect(dup, 'tipo_teste saiu da chave de agrupamento das duplicatas')
      .toMatch(/group\s+by[\s\S]{0,120}?tipo_teste/i);

    /*
      E `data_inicio` NÃO pode entrar na chave. Ela zeraria o detector — 7
      grupos, 0 em projeto ativo — e pelo motivo errado: um duplo cadastro em
      que alguém corrigiu a data num dos dois deixaria de ser visto.
      Detector que nunca acha nada não é detector.
    */
    expect(dup, 'data_inicio entrou na chave e isso zera o detector')
      .not.toMatch(/group\s+by[\s\S]{0,120}?data_inicio/i);

    /* Em vez de decidir pela data, a view MOSTRA a distância: mesma data é
       cadastro em dobro, meses de distância é reteste. Quem olha julga. */
    expect(dup, 'a view não expõe a distância entre as datas de início')
      .toMatch(/dias_entre_as_datas/);
  });

  it('o que fica de fora é dito, não escondido', () => {
    /*
      Esconder sem avisar trocaria um número inútil (155, que nunca zera) por um
      número incompleto (40, que finge que o resto não existe). Dizer "(108 em
      projeto encerrado, fora da conta)" mantém a porta aberta para a limpeza
      sem poluir a fila do dia.
    */
    expect(ALERTA, 'o alerta deixou de contar quantos ficaram de fora')
      .toMatch(/encerrados/i);
    expect(ALERTA, 'o alerta não diz na mensagem quantos ficaram de fora')
      .toMatch(/projeto encerrado/i);
  });
});
