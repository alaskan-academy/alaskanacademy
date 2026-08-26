import { describe, it, expect } from 'vitest';
import {
  STATUS_OFERTA, STATUS_PADRAO, statusDaOferta, opcoesComAtual,
} from '@/features/copywriters/components/copytrack/statusDaOferta';

/**
 * O status da oferta do CopyTrack, preso contra o banco.
 *
 * O defeito real: o mesmo campo estava escrito em quatro listas — o CHECK do
 * banco, o modal de editar, o filtro da tabela e o mapa de badges — e as quatro
 * discordavam. Salvar uma oferta como "Ativo" dava
 * `violates check constraint "copytrack_offers_status_check"` na cara de quem
 * usa, porque `ativo` só existia naquele dropdown.
 */

// Copiado de `pg_get_constraintdef` em 26/08/2026:
//   CHECK (status = ANY (ARRAY['monitorando', 'acompanhando', 'descartada']))
// Se o banco ganhar um valor, é aqui e na constante que ele entra — este teste
// é o lugar onde as duas pontas se encontram enquanto a lista não vier de uma
// tabela.
const ACEITOS_PELO_BANCO = ['monitorando', 'acompanhando', 'descartada'];

describe('status da oferta contra o CHECK do banco', () => {
  it('não oferece nada que o banco recuse', () => {
    // Era este o erro na tela: `ativo`, `pausado` e `arquivado` no dropdown, e
    // nenhum deles storable.
    for (const s of STATUS_OFERTA) {
      expect(ACEITOS_PELO_BANCO).toContain(s.valor);
    }
  });

  it('não esconde nada que o banco tenha', () => {
    // O outro lado do mesmo defeito: 7 ofertas `descartada` sem badge, fora do
    // filtro e impossíveis de escolher no modal.
    for (const valor of ACEITOS_PELO_BANCO) {
      expect(STATUS_OFERTA.map(s => s.valor)).toContain(valor);
    }
  });

  it('usa um padrão que o banco aceita', () => {
    // O padrão era `ativo` em dois lugares — um valor que nem existe.
    expect(ACEITOS_PELO_BANCO).toContain(STATUS_PADRAO);
  });

  it('destaca exatamente um status, que é o do banner e da borda', () => {
    expect(STATUS_OFERTA.filter(s => s.destaque).map(s => s.valor)).toEqual(['acompanhando']);
  });
});

describe('valor que a lista não conhece', () => {
  it('continua visível em vez de sumir da tela', () => {
    // A rede de proteção contra repetir o defeito: se alguém acrescentar um
    // status no banco e esquecer daqui, a linha ainda aparece com o valor cru.
    const s = statusDaOferta('escalando');
    expect(s.valor).toBe('escalando');
    expect(s.label).toBe('escalando');
  });

  it('entra nas opções do seletor, para editar não trocar o status sem querer', () => {
    // Sem isto o Select abriria vazio, e salvar gravaria outra coisa por cima.
    expect(opcoesComAtual('escalando').map(s => s.valor)).toContain('escalando');
  });

  it('não duplica o que já está na lista', () => {
    expect(opcoesComAtual('monitorando')).toHaveLength(STATUS_OFERTA.length);
    expect(opcoesComAtual(null)).toHaveLength(STATUS_OFERTA.length);
  });

  it('trata linha sem status como o padrão', () => {
    expect(statusDaOferta(null).valor).toBe(STATUS_PADRAO);
  });
});
