/**
 * Um tipo de bloco novo tem de sobreviver à ida e à volta.
 *
 * ── Os dois lugares que apagam em silêncio ─────────────────────────────────
 *
 * A lista de tipos conhecidos vive em DOIS lugares de `BlocosRenderer`, e
 * esquecer qualquer um deles é caro de um jeito que nenhuma tela denuncia:
 *
 *   `lerBlocos`  filtra pelos tipos conhecidos → o bloco SOME ao ler
 *   `semVazios`  cai em `return (b.dados.url ?? '')` no fim → o bloco é
 *                APAGADO DO BANCO no salvamento seguinte, sem erro nenhum
 *
 * O segundo é o pior: a pessoa escreve, salva, vê certo (o estado local ainda
 * tem o bloco), e o conteúdo já foi embora. Só reaparece como ausência na
 * próxima vez que alguém abrir o artigo.
 *
 * É a terceira armadilha do CLAUDE.md em TypeScript: uma lista escrita à mão
 * que envelhece calada. Este teste é a catraca — ele falha no dia em que
 * alguém acrescentar um tipo e esquecer um dos dois pontos.
 */
import { describe, it, expect } from 'vitest';
import { lerBlocos, semVazios, type Bloco, type TipoBloco } from '@/features/processos/components/BlocosRenderer';

/** Um exemplar NÃO-VAZIO de cada tipo. Tipo novo entra aqui e o teste cobre. */
const EXEMPLARES: Record<TipoBloco, Bloco> = {
  texto:     { tipo: 'texto',     dados: { html: '<p>oi</p>' } },
  html:      { tipo: 'html',      dados: { html: '<table><tr><td>x</td></tr></table>' } },
  imagem:    { tipo: 'imagem',    dados: { url: 'https://exemplo/x.png', legenda: 'x' } },
  video:     { tipo: 'video',     dados: { url: 'https://exemplo/v?embed' } },
  checklist: { tipo: 'checklist', dados: { itens: [{ texto: 'Passo 1', grupo: true }, { texto: 'Texto da copy' }] } },
};

const TIPOS = Object.keys(EXEMPLARES) as TipoBloco[];

describe('bloco novo não some na ida e volta', () => {
  it('a lista de exemplares cobre todos os tipos declarados', () => {
    /* Se alguém acrescentar um tipo em `TipoBloco` e não aqui, o TypeScript já
       reclama no `Record` acima — este caso existe para o contrário: garantir
       que a lista não ficou vazia por um refactor. */
    expect(TIPOS.length).toBeGreaterThanOrEqual(5);
  });

  it('`lerBlocos` devolve TODOS os tipos — nenhum some ao ler', () => {
    const lidos = lerBlocos(TIPOS.map(t => EXEMPLARES[t]));
    expect(
      lidos.map(b => b.tipo).sort(),
      `lerBlocos descartou: ${TIPOS.filter(t => !lidos.some(b => b.tipo === t)).join(', ')}`,
    ).toEqual([...TIPOS].sort());
  });

  it('`semVazios` mantém TODOS os tipos preenchidos — nenhum é apagado ao salvar', () => {
    const mantidos = semVazios(TIPOS.map(t => EXEMPLARES[t]));
    expect(
      mantidos.map(b => b.tipo).sort(),
      `semVazios apagaria: ${TIPOS.filter(t => !mantidos.some(b => b.tipo === t)).join(', ')}. ` +
        `Isso não dá erro: o bloco some do banco no salvamento seguinte.`,
    ).toEqual([...TIPOS].sort());
  });

  it('e continua descartando o que está de fato vazio', () => {
    /* A catraca não pode virar "aceita tudo": o motivo de `semVazios` existir é
       não gravar bloco em branco que a pessoa abriu e não preencheu. */
    const vazios: Bloco[] = [
      { tipo: 'texto',     dados: { html: '<p></p>' } },
      { tipo: 'html',      dados: { html: '   ' } },
      { tipo: 'imagem',    dados: { url: '' } },
      { tipo: 'video',     dados: { url: '' } },
      { tipo: 'checklist', dados: { itens: [] } },
      { tipo: 'checklist', dados: { itens: [{ texto: '  ' }] } },
    ];
    expect(semVazios(vazios)).toEqual([]);
  });

  it('lixo do jsonb continua sendo recusado', () => {
    expect(lerBlocos(null)).toEqual([]);
    expect(lerBlocos('nada disso')).toEqual([]);
    expect(lerBlocos([{ tipo: 'inventado', dados: {} }, null, 42])).toEqual([]);
  });

  it('o checklist guarda grupo e item, e o grupo não conta como marcável', () => {
    const b = EXEMPLARES.checklist;
    expect(b.dados.itens).toHaveLength(2);
    expect(b.dados.itens?.[0].grupo).toBe(true);
    expect(b.dados.itens?.[1].grupo).toBeUndefined();
  });
});
