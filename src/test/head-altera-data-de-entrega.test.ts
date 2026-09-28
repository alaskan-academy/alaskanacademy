/**
 * Head altera data de entrega de qualquer editor.
 *
 * ── O que estava assim ─────────────────────────────────────────────────────
 *
 *     const canEdit = nivel === 'socio';
 *
 * Uma linha no `CriativoDrawer`, e ela decidia o card inteiro. Quem não é
 * sócio abria o card e não tinha botão nenhum: nome, projeto, responsável e
 * Cronograma, tudo só de leitura. O relato chegou em 28/09/2026 assim —
 * "não consigo alterar as datas das demandas por aqui".
 *
 * O calendário SEMPRE deixou arrastar o card para outro dia (nem `useDraggable`
 * nem a alça de redimensionar olham `nivel`), então a permissão existia e só
 * não tinha porta: um gesto que ninguém descobre sozinho. Duas telas discordando
 * sobre a mesma pergunta — a primeira armadilha do CLAUDE.md, em forma de gate.
 *
 * ── Por que o Geral também abriu ───────────────────────────────────────────
 *
 * Head só tinha "Calendário do Setor", que corta DUAS vezes: pelas pessoas do
 * setor e pelas fases do setor. Um card parado numa fase de outro setor some
 * da tela — e some calado, que é o pior jeito de sumir. "Alterar de todos os
 * editores" precisa alcançar o card, então o Geral passou a valer para head.
 *
 * ── O que continua do sócio ────────────────────────────────────────────────
 *
 * Reprogramar não é reatribuir. Trocar responsável, projeto ou nome segue
 * sendo do sócio, e é por isso que o modo de edição virou dois: `modoEdicao`
 * é o botão ligado, `editing` são os campos que abrem para o sócio, e
 * `editandoData` é o Cronograma, que abre para os dois.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const semComentarios = (caminho: string) =>
  readFileSync(join(process.cwd(), caminho), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const DRAWER = 'src/features/producao/components/CriativoDrawer.tsx';
const PAGINA = 'src/features/producao/pages/ProducaoPage.tsx';
const drawer = semComentarios(DRAWER);
const pagina = semComentarios(PAGINA);

describe('head altera data de entrega', () => {
  it('o botão de editar do card não é só do sócio', () => {
    const linha = drawer.match(/const canEdit\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(linha, `${DRAWER}: não achei a atribuição de canEdit`).not.toBe('');
    expect(linha, 'head precisa poder abrir o card para mexer na data').toMatch(
      /nivel === 'head'/,
    );
  });

  it('o Cronograma abre no modo de edição, não no recorte do sócio', () => {
    // O campo de data tem gate PRÓPRIO — se ele voltar a usar `editing`,
    // volta a ser do sócio sozinho, porque `editing` já embute o nível.
    expect(drawer, `${DRAWER}: o campo Data perdeu o gate próprio`).toMatch(
      /<Field label="Data" editing={editandoData}>/,
    );
    const derivado = drawer.match(/const editandoData\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(derivado, `${DRAWER}: não achei a derivação de editandoData`).not.toBe('');
    expect(derivado, 'editandoData não pode depender do nível de sócio').not.toMatch(
      /socio/,
    );
  });

  it('reatribuir continua sendo do sócio', () => {
    // A contraprova: se `editing` deixar de exigir sócio, o head passa a
    // editar responsável e projeto junto — que NÃO foi o combinado.
    const derivado = drawer.match(/const editing\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(derivado, `${DRAWER}: não achei a derivação de editing`).not.toBe('');
    expect(derivado, 'os demais campos seguem do sócio').toMatch(/nivel === 'socio'/);
    expect(drawer, 'excluir e duplicar seguem do sócio').toMatch(
      /const canDelete\s*=\s*nivel === 'socio';/,
    );
  });

  it('head alcança o calendário inteiro, não só o do setor dele', () => {
    const aba = pagina.match(/chave: 'calendario'[^}]*}/)?.[0] ?? '';
    expect(aba, `${PAGINA}: não achei a aba do Calendário Geral`).not.toBe('');
    expect(aba, 'sem o Geral, head não alcança card de fase de outro setor').toMatch(
      /'head'/,
    );
  });
});
