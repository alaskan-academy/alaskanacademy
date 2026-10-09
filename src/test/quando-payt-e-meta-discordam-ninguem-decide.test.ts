/**
 * Quando Payt e Meta discordam, a régua não decide — e isso é o produto, não
 * uma falta.
 *
 * ── As duas fontes contam venda de jeitos diferentes, e as duas erram ────
 *
 * Medido em 09/10/2026, nos 3.004 criativos postados:
 *
 *   · a **Payt subestima**: só 58-76% das vendas aprovadas carregam
 *     `ad_id_meta` (jun 64,5% · jul 58,9% · ago 57,7% · set 75,7% · out 75,6%);
 *   · o **Meta infla**: a janela de 7 dias credita venda de backend ao anúncio
 *     de topo;
 *   · a razão entre as duas é **1,49x a 1,76x**, muito além do que a atribuição
 *     incompleta explica.
 *
 * E o tamanho da aposta: os **mesmos 60 cards** rendem **−R$ 67.441 de lucro
 * pela Payt** e **+R$ 126.762 pelo Meta**. Nenhuma das duas medições
 * independentes feitas naquele dia resolveu qual está certa.
 *
 * Por isso a régua decide pela Payt (que é a fonte sobre a qual o crivo foi
 * medido) e só grava quando o Meta chega ao mesmo veredito. Nos **65 cards** em
 * que elas discordam ela não escreve nada — e esses 65 carregam **R$ 264.049**,
 * 64% de toda a verba. Carimbar esse dinheiro com um palpite de 1,5x de viés é
 * o erro mais caro que esta automação pode cometer; devolvê-lo para a fila é o
 * comportamento correto.
 *
 * ── A exceção que NÃO é discordância ─────────────────────────────────────
 *
 * Uma fonte dizer "Validado" e a outra "Escalado" não é discordar sobre o que
 * importa: as duas dizem que o card é bom. Ali a régua grava o nível MENOR — o
 * lado que não autoriza verba por engano. São 4 cards, e é o que leva o Validado
 * de 7 para 11.
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

/** A última definição da view da régua, só a definição. */
const regra = (() => {
  const re = /create\s+or\s+replace\s+view\s+public\.vw_criativo_avaliacao_sugerida/i;
  let achado: { nome: string; sql: string } | null = null;
  for (const m of migracoes) if (re.test(m.sql)) achado = { nome: m.nome, sql: semComentarios(m.sql) };
  if (!achado) throw new Error('nenhuma migração define vw_criativo_avaliacao_sugerida');
  const inicio = achado.sql.search(re);
  const fim = achado.sql.indexOf('comment on view public.vw_criativo_avaliacao_sugerida', inicio);
  return { nome: achado.nome, def: achado.sql.slice(inicio, fim > inicio ? fim : undefined) };
})();

describe('quando Payt e Meta discordam, ninguém decide', () => {
  it('a definição foi recortada: há o que conferir', () => {
    /* Um recorte vazio faria todas as asserções abaixo passarem sobre nada. */
    expect(regra.def.length, `não consegui recortar a view em ${regra.nome}`)
      .toBeGreaterThan(500);
  });

  it('existe um ramo que devolve NULO, e o motivo diz qual é a divergência', () => {
    /* Sem o nulo, a régua é obrigada a escolher um lado em R$ 264 mil de verba.
       E sem o motivo, a tela mostra um campo vazio sem explicar — que é pior
       que o campo errado, porque ninguém sabe o que fazer com ele. */
    expect(regra.def, 'a régua não tem ramo que se recuse a decidir')
      .toMatch(/else\s+null\s+end\s+as\s+sugestao/i);
    expect(regra.def, 'a régua não explica a divergência num motivo')
      .toMatch(/discordam/i);
  });

  it('o veredito sai das colunas da PAYT; as do Meta ficam na guarda', () => {
    /*
      O crivo foi MEDIDO sobre números da Payt — 782 ADs, R$ 242.143 — e por
      isso é a Payt que decide. Trocar a fonte sem refazer a medição seria
      aplicar régua de uma fonte sobre outra: pelos números do Meta, o corte
      equivalente ao 1,8 seria algo perto de 2,7.

      A assimetria é a regra, então o teste cobra que ela exista: as colunas das
      duas fontes aparecem, e a decisão é tomada sobre a da Payt.
    */
    expect(regra.def, 'a régua não lê as vendas da Payt').toMatch(/\bb\.vendas\b/);
    expect(regra.def, 'a régua não lê o ROAS da Payt').toMatch(/\bb\.roas\b/);
    expect(regra.def, 'a régua não confere o Meta como guarda').toMatch(/vendas_meta/);
    expect(regra.def, 'a régua não confere o ROAS do Meta').toMatch(/roas_meta/);

    /* E `por_payt` é o lado que ganha quando os dois aprovam em níveis
       diferentes só se for o menor — nunca por ser a Payt. Ver o caso abaixo. */
    expect(regra.def, 'a régua não calcula o veredito de cada fonte separadamente')
      .toMatch(/por_payt[\s\S]*por_meta/);
  });

  it('quando as duas aprovam em níveis diferentes, grava o MENOR', () => {
    /*
      "Uma diz Validado, a outra Escalado" não é discordância sobre o que
      importa. Não gravar nada ali mandaria para a fila um card sobre o qual as
      fontes concordam — e o lado conservador (a nota menor) é o que não
      autoriza orçamento por engano.

      A comparação é por `ordem`, lida da tabela do crivo: usar o nome do nível
      exigiria uma lista no código, e aí um nível novo nasceria invisível para
      esta regra.
    */
    expect(regra.def, 'a régua não resolve o caso em que as duas fontes aprovam')
      .toMatch(/ap\.ordem\s*<=\s*am\.ordem/i);
    expect(regra.def, 'a régua decide o nível aprovado por lista de nomes em vez da tabela')
      .toMatch(/from\s+public\.vw_crivo_niveis_vigentes/i);
  });

  it('"sem verba" é decidido por INVESTIMENTO, nunca por vendas', () => {
    /*
      Um card que gastou R$ 3.000 e não vendeu nada não é "sem dados": é
      reprovado, e com clareza. Decidir a ausência de dados por vendas trocaria
      a pior notícia do painel pela mais neutra — e eram 97 cards acima de
      R$ 348 vendendo no vermelho, com R$ 300.480 de verba.
    */
    expect(regra.def, 'a régua não usa o piso de verba da tabela do crivo')
      .toMatch(/investimento\s*<=\s*c\.verba_min/i);
    /* E o piso é da TABELA, não um número aqui. */
    expect(regra.def, 'apareceu um piso de verba escrito na view')
      .not.toMatch(/investimento\s*<=\s*\d/);
  });

  it('nenhum número e nenhum nome de nível estão escritos na view', () => {
    /*
      A terceira armadilha, no lugar onde ela custaria mais: se a régua tivesse
      os limiares escritos aqui, mudar o nível na tabela deixaria a tela
      mostrando uma régua e o banco aplicando outra — sem erro em lugar nenhum.
    */
    for (const nivel of ['Validado', 'Escalado', 'Não validado', 'Sem dados']) {
      expect(regra.def, `a view cita o nível "${nivel}" diretamente`)
        .not.toContain(`'${nivel}'`);
    }
    /* Limiares: nenhum número com casa decimal comparado a vendas ou roas. */
    expect(regra.def, 'apareceu um limiar de ROAS escrito na view')
      .not.toMatch(/roas[a-z_]*\s*[<>]=?\s*\d+[.,]\d/i);
    expect(regra.def, 'apareceu um limiar de vendas escrito na view')
      .not.toMatch(/vendas[a-z_]*\s*>=\s*\d/i);
  });

  it('a tela mostra os dois números e diz que não preencheu', () => {
    /*
      A metade da decisão que vive no front: devolver o card para a fila só
      ajuda se a tela disser POR QUE. A `TiraDeMetricas` já mostra Payt e Meta
      lado a lado embaixo de cada linha desde que existe — o que faltava era o
      rótulo.
    */
    const tela = readFileSync(
      join(process.cwd(), 'src', 'features', 'criativos', 'components', 'AvaliacaoView.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

    expect(tela, 'a tela não lê o veredito da régua').toMatch(/avaliacao_sugerida/);
    expect(tela, 'a tela não avisa quando as fontes discordam')
      .toMatch(/fontes discordam/i);
    expect(tela, 'a tela deixou de mostrar os números das duas fontes')
      .toMatch(/TiraDeMetricas/);
  });
});
