/**
 * A escada da régua é monotônica: quem tira a nota máxima passa também no teste
 * da nota do meio.
 *
 * ── O preço exato deste teste, medido ────────────────────────────────────
 *
 * Em 09/10/2026 ela pediu "Escalado = 15 vendas ou mais". Tomado ao pé da letra
 * — 15 vendas e nenhuma exigência de retorno —, isto é o que aconteceria, medido
 * sobre os 3.004 criativos postados:
 *
 *   · **60 cards** receberiam a nota máxima, somando **R$ 294.286** de verba;
 *   · o lucro desse conjunto é **−R$ 67.441**, e **26 dos 60 estão no vermelho**;
 *   · **55 dos 60 reprovariam no teste do próprio "Validado"**;
 *   · e 37 cards que ela marcou "Validado" à mão (R$ 167.428) seriam
 *     PROMOVIDOS a "Escalado" pela máquina.
 *
 * A causa é a ordem: a escada testa o nível mais alto primeiro, então um card
 * que passa em "Escalado" nunca chega a ser avaliado por "Validado". Se o piso
 * de retorno do nível de cima for MENOR que o de baixo, a nota máxima vira um
 * atalho para escapar da reprovação.
 *
 * Ela decidiu o piso em 1,8 — acima do 1,65 do Validado —, e com isso a escada
 * fica correta. Este teste existe para o dia em que alguém mexer num dos dois
 * números sem olhar o outro, que é o jeito mais fácil de reintroduzir o defeito:
 * baixar o piso do Escalado parece afrouxar uma exigência e na verdade
 * desativa a reprovação de 60 cards.
 *
 * ── Por que ler a migração ───────────────────────────────────────────────
 *
 * A régua mora em `crivo_niveis`, então a invariante é sobre DADO, não sobre
 * código. O banco tem a prova (em `20261009a`), e aqui se cobra que ela
 * continue existindo — porque uma prova apagada não acusa nada, e uma régua
 * nova entra por `insert`, não por deploy.
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

/** A migração que semeia a régua. */
const semente = (() => {
  const m = migracoes.find(x => /insert\s+into\s+public\.crivo_niveis/i.test(x.sql));
  if (!m) throw new Error('nenhuma migração semeia crivo_niveis — o teste ficou cego');
  return { nome: m.nome, sql: semComentarios(m.sql) };
})();

/**
 * As cláusulas semeadas, como tuplas.
 *
 * O formato é `(v2, 'avaliacao', 'Escalado', 1, 15, 1.80, false, 2, '…')`:
 * versão, campo, nível, cláusula, vendas_min, roas_min, roas_inclusivo, ordem.
 */
interface Clausula {
  versao: string; nivel: string; clausula: number;
  vendasMin: number; roasMin: number; inclusivo: boolean; ordem: number;
}

function clausulas(): Clausula[] {
  const re = /\(\s*(v\d+)\s*,\s*'avaliacao'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*,\s*(true|false)\s*,\s*(\d+)\s*,/gi;
  const achados: Clausula[] = [];
  for (const m of semente.sql.matchAll(re)) {
    achados.push({
      versao: m[1], nivel: m[2], clausula: Number(m[3]),
      vendasMin: Number(m[4]), roasMin: Number(m[5]),
      inclusivo: m[6].toLowerCase() === 'true', ordem: Number(m[7]),
    });
  }
  return achados;
}

describe('a escada da régua é monotônica', () => {
  it('a semente foi lida: há cláusulas para conferir', () => {
    /* Um teste que não consegue extrair nada passa sempre. Se o formato do
       `insert` mudar, é aqui que isso aparece — e não disfarçado de aprovação
       nas asserções seguintes. */
    const cs = clausulas();
    expect(cs.length, 'não extraí nenhuma cláusula da semente — o formato mudou')
      .toBeGreaterThanOrEqual(2);
  });

  it('em cada versão, o piso de ROAS do nível de cima não é menor que o de baixo', () => {
    const cs = clausulas();
    const erros: string[] = [];

    for (const versao of [...new Set(cs.map(c => c.versao))]) {
      const daVersao = cs.filter(c => c.versao === versao);
      /* O piso EFETIVO de um nível é o menor entre suas cláusulas: basta uma
         passar para o nível passar. Comparar pelo maior esconderia o furo. */
      const pisoPorOrdem = new Map<number, { nivel: string; piso: number }>();
      for (const c of daVersao) {
        const atual = pisoPorOrdem.get(c.ordem);
        if (!atual || c.roasMin < atual.piso) pisoPorOrdem.set(c.ordem, { nivel: c.nivel, piso: c.roasMin });
      }

      const ordens = [...pisoPorOrdem.keys()].sort((a, b) => a - b);
      for (let i = 1; i < ordens.length; i++) {
        const baixo = pisoPorOrdem.get(ordens[i - 1])!;
        const alto  = pisoPorOrdem.get(ordens[i])!;
        if (alto.piso < baixo.piso) {
          erros.push(
            `${versao}: "${alto.nivel}" (ordem ${ordens[i]}) pede ROAS ${alto.piso}, ` +
            `menos que "${baixo.nivel}" (ordem ${ordens[i - 1]}) que pede ${baixo.piso}. ` +
            'A escada testa o nível de cima primeiro, então a nota máxima viraria ' +
            'atalho para escapar da reprovação — medido: 60 cards, R$ 294.286 de ' +
            'verba e −R$ 67.441 de lucro.');
        }
      }
    }

    expect(erros.join(' | ')).toEqual('');
  });

  it('em cada versão, o nível de cima exige pelo menos tantas vendas quanto o de baixo', () => {
    /* A outra metade da monotonicidade. "Escalado" significa "aguenta verba", e
       aguentar verba é sobre CONFIANÇA no número: exigir menos vendas para a
       nota maior inverteria o sentido do nível. */
    const cs = clausulas();
    const erros: string[] = [];

    for (const versao of [...new Set(cs.map(c => c.versao))]) {
      const daVersao = cs.filter(c => c.versao === versao);
      const minPorOrdem = new Map<number, { nivel: string; v: number }>();
      for (const c of daVersao) {
        const atual = minPorOrdem.get(c.ordem);
        if (!atual || c.vendasMin < atual.v) minPorOrdem.set(c.ordem, { nivel: c.nivel, v: c.vendasMin });
      }
      const ordens = [...minPorOrdem.keys()].sort((a, b) => a - b);
      for (let i = 1; i < ordens.length; i++) {
        const baixo = minPorOrdem.get(ordens[i - 1])!;
        const alto  = minPorOrdem.get(ordens[i])!;
        if (alto.v < baixo.v) {
          erros.push(`${versao}: "${alto.nivel}" pede ${alto.v} vendas, menos que "${baixo.nivel}" com ${baixo.v}.`);
        }
      }
    }

    expect(erros.join(' | ')).toEqual('');
  });

  it('a migração carrega a prova da monotonicidade no banco', () => {
    /*
      O teste acima lê a SEMENTE. Mas régua nova entra por `insert`, sem deploy
      e sem passar por aqui — e aí só o banco pode recusar. A prova da migração
      é o que cobre esse caminho, e este caso existe para que ela não seja
      apagada num "replace" futuro.
    */
    const criacao = migracoes.find(m =>
      /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.crivo_niveis\b/i.test(m.sql));
    expect(criacao, 'nenhuma migração cria crivo_niveis').toBeTruthy();
    const sql = semComentarios(criacao!.sql);
    /*
      Procurar a LÓGICA da prova, não a palavra.

      A primeira versão deste caso buscava `/monoton/i` e falhava sobre uma
      migração que tem a prova: o texto é "monotônica", com circunflexo, e
      `monoton` não casa `monotôn`. Teste que depende de como alguém grafou uma
      palavra acusa ortografia, não defeito.

      O que importa é que a prova COMPARE os dois pisos e aborte. Os nomes das
      variáveis podem mudar; a comparação entre o mínimo de um nível e o de
      outro, não.
    */
    expect(sql, 'a migração do crivo perdeu a prova que compara os pisos dos níveis')
      .toMatch(/min\(roas_min\)[\s\S]*min\(roas_min\)/i);
    expect(sql, 'a prova compara os pisos mas não aborta quando a escada inverte')
      .toMatch(/raise\s+exception/i);
  });

  it('nenhuma cláusula valida no empate ou abaixo dele', () => {
    /*
      "Sempre com margem" é a regra que ela deu ao definir o Validado, e é o que
      separa esta régua da anterior: a antiga validava em ROAS 1,6 com o empate
      em 1,6 — validava no zero. Uma cláusula no empate faz "Validado"
      significar "não perdeu dinheiro", que não é o que a palavra promete.

      O empate da versão vigente sai da mesma semente, e a comparação é por
      versão: a v1 histórica tinha empate 1,6 e cláusula em 1,6, e é por isso
      que ela foi substituída — condená-la aqui seria condenar o registro do
      passado, que existe de propósito.
    */
    const cs = clausulas();
    const vigente = cs.filter(c => c.versao === [...new Set(cs.map(x => x.versao))].sort().at(-1));
    expect(vigente.length, 'não identifiquei as cláusulas da versão mais nova').toBeGreaterThan(0);

    /* O empate da versão mais nova, extraído do `insert` em crivo_versoes. */
    const empates = [...semente.sql.matchAll(/'avaliacao',\s*'(\d{4}-\d{2}-\d{2})',\s*(?:null|'[\d-]+'),\s*([\d.]+)/gi)]
      .map(m => ({ data: m[1], empate: Number(m[2]) }))
      .sort((a, b) => a.data.localeCompare(b.data));
    expect(empates.length, 'não extraí o empate da semente').toBeGreaterThan(0);
    const empateVigente = empates.at(-1)!.empate;

    const erros = vigente
      .filter(c => c.roasMin <= empateVigente)
      .map(c => `"${c.nivel}" cláusula ${c.clausula} valida em ROAS ${c.roasMin}, `
        + `e o empate é ${empateVigente}: validaria sem margem.`);

    expect(erros.join(' | ')).toEqual('');
  });
});
