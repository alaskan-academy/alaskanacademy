/**
 * `funil_alvo_id` não pode repetir a morte de `producoes.funil_id`.
 *
 * ── Como a coluna anterior morreu ──────────────────────────────────────────
 *
 * `producoes.funil_id` existiu por meses com **0 de 4.098 linhas preenchidas**,
 * e foi apagada em 21/09/2026 — levando cinco telas junto, porque o DROP saiu
 * antes do deploy. Ela morreu por uma razão simples: NADA A PREENCHIA. Não
 * havia campo no formulário, então o campo era um lugar onde o dado deveria
 * estar e nunca esteve. Segunda armadilha do CLAUDE.md.
 *
 * Ela autorizou recriar a ligação com uma condição explícita: "precisa nascer
 * com o campo no formulário junto, senão vira a mesma coluna vazia de novo".
 * Este teste é essa condição, escrita de um jeito que falha se alguém a
 * desfizer sem perceber.
 *
 * ── O modo de falhar que quase passou ──────────────────────────────────────
 *
 * O seletor só oferece funis do projeto escolhido — `f.projeto_id ===
 * form.projeto_id`. Mas `CalendarioView` passa a lista pronta de
 * `dataCache.fetchFunis`, que buscava `id,nome,produto,ativo` e NÃO
 * `projeto_id`. Criar um card pelo calendário abriria o seletor vazio, e o
 * campo nunca seria preenchido por aquele caminho — a coluna morreria de novo,
 * pela mesma causa, com o formulário existindo.
 *
 * Nenhum erro apareceria: lista vazia é indistinguível de "este projeto não tem
 * funil".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

const FORM = join(SRC, 'features', 'producao', 'components', 'CriativoFormModal.tsx');
const CACHE = join(SRC, 'lib', 'dataCache.ts');

describe('funil_alvo_id nasce preenchível', () => {
  const form = readFileSync(FORM, 'utf8');

  it('o formulário tem o campo e o grava', () => {
    expect(form, 'o estado do formulário perdeu funil_alvo_id')
      .toMatch(/funil_alvo_id:\s*string/);
    expect(
      form,
      'o formulário deixou de ENVIAR funil_alvo_id no payload — o campo vira ' +
        'enfeite e a coluna volta a nascer vazia, que foi como a anterior morreu.',
    ).toMatch(/funil_alvo_id:\s*form\.funil_alvo_id/);
  });

  it('o seletor filtra por projeto, e quem alimenta a lista traz projeto_id', () => {
    /* O filtro é o que torna a escolha correta; sem ele o campo ofereceria
       funil de outro produto. Mas o filtro é também o que faz a lista vazia
       quando a origem não traz `projeto_id`. */
    expect(form, 'o seletor de funil alvo deixou de filtrar pelo projeto')
      .toMatch(/f\.projeto_id\s*===\s*form\.projeto_id/);

    /* As DUAS origens da lista. A interna, do próprio modal: */
    const selectInterno = form.match(/from\(['"]funis['"]\)\s*\.\s*select\(['"]([^'"]+)['"]\)/);
    expect(selectInterno, 'não achei a busca de funis dentro do formulário').toBeTruthy();
    expect(
      selectInterno![1],
      `a busca interna de funis traz "${selectInterno?.[1]}" e precisa de projeto_id, ` +
        `senão o seletor abre vazio e o campo nunca é preenchido.`,
    ).toContain('projeto_id');

    /* E a externa, que o Calendário passa pronta: */
    const cache = readFileSync(CACHE, 'utf8');
    const selectCache = cache.match(/from\(['"]funis['"]\)\s*\.\s*select\(['"]([^'"]+)['"]\)/);
    expect(selectCache, 'não achei fetchFunis em dataCache.ts').toBeTruthy();
    expect(
      selectCache![1],
      `fetchFunis traz "${selectCache?.[1]}" e precisa de projeto_id. O Calendário ` +
        `passa essa lista para o formulário; sem a coluna, criar card por lá abre ` +
        `o seletor vazio — sem erro, porque lista vazia parece "projeto sem funil".`,
    ).toContain('projeto_id');
  });

  it('trocar de projeto derruba o funil escolhido', () => {
    /* O funil pertence a um projeto. Sem isto, escolher projeto A, escolher o
       funil dele, e depois trocar para o projeto B gravaria um alvo de outro
       produto — e a tela não teria como denunciar. */
    expect(
      form,
      'trocar o projeto deixou de limpar funil_alvo_id, e dá para gravar alvo ' +
        'de um produto em card de outro.',
    ).toMatch(/projeto_id:\s*v === '_' \? '' : v,\s*funil_alvo_id:\s*''/);
  });

  it('ninguém preenche o alvo a partir do fato', () => {
    /* `vw_criativo_funil` diz de qual REV veio a VENDA — fato. `funil_alvo_id`
       é INTENÇÃO. Copiar um no outro apaga a distinção justamente nos cards que
       o campo existe para guardar: os que rodaram contra a página errada
       ficariam registrados como se tivessem sido feitos para ela.
       Inventar intenção é pior que campo vazio: o vazio se vê. */
    const suspeitas: string[] = [];
    for (const nome of readdirSync(MIGRACOES).filter(n => n.endsWith('.sql'))) {
      const sql = readFileSync(join(MIGRACOES, nome), 'utf8')
        .replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (!/funil_alvo_id/.test(sql)) continue;
      /* `update ... set funil_alvo_id` é o backfill que não pode existir. */
      if (/update[\s\S]{0,200}?set[\s\S]{0,100}?funil_alvo_id/i.test(sql)) suspeitas.push(nome);
    }
    expect(
      suspeitas,
      `${suspeitas.join(', ')} preenche funil_alvo_id por UPDATE. O alvo é ` +
        `intenção e só quem fez o card sabe qual era; derivá-lo do fato ` +
        `(vw_criativo_funil) registra a página errada como se fosse a pretendida.`,
    ).toEqual([]);
  });
});
