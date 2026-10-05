/**
 * Bloco `<pre>` quebra linha, senão o conteúdo some sem nada denunciar.
 *
 * ── O que aconteceu em 05/10/2026 ─────────────────────────────────────────
 *
 * O Módulo 3 do SOP de Edição tem três prompts que a pessoa COPIA E COLA no
 * ChatGPT e no Flow. Eles foram conferidos caractere a caractere contra a
 * camada de texto do PDF de origem: os 4.507, os 3.861 e os 1.554 caracteres
 * batiam letra por letra, incluindo as letras GREGAS do nome do GPT.
 *
 * E na tela não dava para ler nenhum deles.
 *
 * O `<pre>` não tinha estilo nenhum, então valia o padrão do navegador,
 * `white-space: pre`, que NÃO quebra linha. Medido no navegador: o maior
 * prompt renderizava como uma linha de 35.921px de largura por 28px de altura,
 * dentro de um container de 528px. O texto estava lá, inteiro e correto, e
 * invisível.
 *
 * É o pior tipo de defeito que este projeto conhece: a página abre, parece
 * completa, e o que falta não aparece em lugar nenhum. Só dá para ver medindo
 * `scrollWidth` contra `clientWidth`, que não é coisa que alguém faça por
 * acaso.
 *
 * ── Por que isto é um teste de classe, e não de comportamento ─────────────
 *
 * O jsdom não aplica o CSS do Tailwind, então `getComputedStyle` devolveria
 * vazio e um teste de comportamento passaria com o defeito plantado. O que dá
 * para travar é a presença da regra. É mais fraco do que medir, e é o que
 * existe: pega quem apagar a linha, não pega quem a sobrescrever depois.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TELA = 'src/features/processos/components/BlocosRenderer.tsx';
const codigo = readFileSync(join(process.cwd(), TELA), 'utf8')
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  .replace(/\/\/[^\n]*/g, '');

describe('o bloco de prompt copiável', () => {
  it('quebra linha', () => {
    // Sem isto, 4.507 caracteres viram uma linha de 35.921px.
    expect(codigo, `${TELA}: o <pre> voltou a não quebrar linha`).toMatch(
      /\[&_pre\]:whitespace-pre-wrap/,
    );
  });

  it('tem altura máxima com rolagem própria', () => {
    /*
      4.507 caracteres quebrados dão ~1.400px de parede no meio do artigo. O
      painel com rolagem é o que mantém o artigo navegável sem esconder nada:
      quem quer o prompt inteiro rola dentro dele.
    */
    expect(codigo, `${TELA}: o <pre> perdeu o limite de altura`).toMatch(/\[&_pre\]:max-h-/);
    expect(codigo, `${TELA}: o <pre> perdeu a rolagem própria`).toMatch(/\[&_pre\]:overflow-y-auto/);
  });

  it('o destaque usa token, e não o amarelo do navegador', () => {
    /*
      O `<mark>` caía em #FFFF00 com texto preto, que é o padrão do navegador:
      um bloco neon no tema escuro e um hex que não existe em token nenhum.

      Âmbar e não vermelho: o CLAUDE.md reserva o vermelho para marca e para
      prejuízo, e gastá-lo num destaque de texto tira o único sinal que um
      número negativo tem.
    */
    expect(codigo, `${TELA}: o destaque saiu do token`).toMatch(/\[&_mark\]:bg-warning\//);
    expect(codigo, `${TELA}: cor escrita à mão no lugar do token`).not.toMatch(
      /\[&_mark\]:bg-\[#/,
    );
  });

  it('link dentro de tabela parece link', () => {
    /*
      O estilo de link morava só no BlocoTexto, e a matriz de navegação do SOP
      é uma tabela: a peça feita para rotear o editor para o módulo da demanda
      dele não tinha nada dizendo que era clicável.

      As duas ocorrências são BlocoTexto e BlocoHtml. Se virar uma só, um dos
      dois perdeu o estilo de novo.
    */
    const quantos = (codigo.match(/\[&_a\]:text-primary/g) ?? []).length;
    expect(quantos, `${TELA}: esperava o estilo de link nos blocos de texto E de html`).toBe(2);
  });
});
