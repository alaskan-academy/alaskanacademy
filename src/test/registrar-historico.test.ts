import { describe, it, expect } from 'vitest';
import { linhasDeHistorico } from '@/features/producao/registrarHistorico';

const CARD = 'c1';
const EU = 'u1';

describe('linhasDeHistorico', () => {
  it('registra a mudança de prazo que o arrastar do calendário faz', () => {
    // O caso que motivou tudo: arrastar um card aprovado reescrevia o prazo
    // combinado com o editor e não deixava rastro nenhum.
    const l = linhasDeHistorico([{
      id: CARD,
      antes: { data_prazo: '2026-08-12', data_inicio: '2026-08-10' },
      patch: { data_prazo: '2026-08-20', data_inicio: '2026-08-18' },
    }], EU);

    expect(l).toHaveLength(2);
    expect(l.find(x => x.campo_alterado === 'data_prazo')).toMatchObject({
      criativo_id: CARD, usuario_id: EU, tipo_alteracao: 'campo',
      valor_anterior: '2026-08-12', valor_novo: '2026-08-20',
    });
  });

  it('não registra quando o valor não mudou', () => {
    // Soltar o card no mesmo dia não é um fato para o histórico.
    expect(linhasDeHistorico([{
      id: CARD,
      antes: { data_prazo: '2026-08-12' },
      patch: { data_prazo: '2026-08-12' },
    }], EU)).toHaveLength(0);
  });

  it('ignora campo que não está na lista de auditados', () => {
    // O patch em lote também carrega `nome` e outros; só o que se pretende
    // auditar entra, senão o histórico vira log de tudo.
    expect(linhasDeHistorico([{
      id: CARD, antes: { nome: 'AD 001' }, patch: { nome: 'AD 002' },
    }], EU)).toHaveLength(0);
  });

  it('trata null, undefined e string vazia como a mesma ausência', () => {
    // Apagar o prazo em lote grava `null`; o card podia ter '' ou undefined.
    // Sem isto, limpar um prazo que já estava vazio viraria registro falso.
    expect(linhasDeHistorico([{
      id: CARD, antes: { data_prazo: null }, patch: { data_prazo: '' },
    }], EU)).toHaveLength(0);

    const apagou = linhasDeHistorico([{
      id: CARD, antes: { data_prazo: '2026-08-12' }, patch: { data_prazo: null },
    }], EU);
    expect(apagou).toHaveLength(1);
    expect(apagou[0].valor_novo).toBeNull();
  });

  it('marca troca de fase como `fase`, e o resto como `campo`', () => {
    // O drawer e o Kanban usam 'fase' para isto; o histórico ficaria com dois
    // rótulos para o mesmo fato se aqui fosse diferente.
    const l = linhasDeHistorico([{
      id: CARD,
      antes: { fase: 'aprovado', responsavel_id: 'a' },
      patch: { fase: 'esteira_teste', responsavel_id: 'b' },
    }], EU);
    expect(l.find(x => x.campo_alterado === 'fase')?.tipo_alteracao).toBe('fase');
    expect(l.find(x => x.campo_alterado === 'responsavel_id')?.tipo_alteracao).toBe('campo');
  });

  it('gera uma linha por card no movimento em lote', () => {
    const l = linhasDeHistorico(
      ['a', 'b', 'c'].map(id => ({
        id, antes: { data_inicio: '2026-08-01' }, patch: { data_inicio: '2026-08-05' },
      })), EU);
    expect(l).toHaveLength(3);
    expect(new Set(l.map(x => x.criativo_id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('aceita usuário vazio sem quebrar', () => {
    // `userId` chega como '' quando a sessão ainda não resolveu; melhor um
    // registro sem autor do que nenhum registro.
    const l = linhasDeHistorico([{
      id: CARD, antes: { data_inicio: '2026-08-01' }, patch: { data_inicio: '2026-08-02' },
    }], '');
    expect(l[0].usuario_id).toBeNull();
  });
});
