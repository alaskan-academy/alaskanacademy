import { supabase } from '@/lib/supabase';

/**
 * Registra no histórico o que mudou num card.
 *
 * Existe porque o Calendário mudava datas em QUATRO caminhos — arrastar um
 * card, arrastar uma seleção inteira, redimensionar a barra e a edição em lote
 * — e nenhum deles gravava nada. O prazo combinado com o editor era reescrito
 * em silêncio, e depois não havia como reconstruir quem mexeu nem quando: em
 * todo o banco existiam 35 registros de mudança de data, todos vindos do
 * drawer, que grava campo a campo ao salvar.
 *
 * Isso importava mais do que parecia. O gestor arrastava os aprovados para
 * datas diferentes só para formar "bloquinhos" e enxergar quantos ADs tinha de
 * cada projeto — e cada arrasto apagava um prazo de produção sem deixar rastro.
 *
 * ── Por que aqui e não num gatilho do banco ────────────────────────────────
 *
 * Um gatilho pareceria mais robusto, mas o `CriativoDrawer` JÁ grava histórico
 * para todo campo alterado, inclusive datas. Com o gatilho ligado, editar uma
 * data pelo card produziria DUAS linhas para o mesmo fato, e passaria a haver
 * dois mecanismos escrevendo a mesma coisa — a primeira armadilha do CLAUDE.md.
 * Melhor uma função só, no mesmo lugar onde a escrita já acontece.
 */

/** Só o que se pretende auditar; o resto do patch é ignorado de propósito. */
const CAMPOS = ['data_inicio', 'data_prazo', 'fase', 'responsavel_id'] as const;

export interface MudancaDeCard {
  id: string;
  /** Como o card estava ANTES — para o histórico ter o valor anterior. */
  antes: Record<string, unknown>;
  /** O que foi gravado. Chaves fora de `CAMPOS` são ignoradas. */
  patch: Record<string, unknown>;
}

const texto = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

export interface LinhaDeHistorico {
  criativo_id: string;
  usuario_id: string | null;
  tipo_alteracao: string;
  campo_alterado: string;
  valor_anterior: string | null;
  valor_novo: string | null;
}

/**
 * Uma linha por campo que REALMENTE mudou.
 *
 * Separada da gravação para poder ser testada sem banco — é aqui que mora a
 * decisão do que vira registro, e ela tem duas regras que erram fácil:
 *
 *  · patch que regrava o mesmo valor NÃO vira linha. Histórico cheio de "mudou
 *    de 12/08 para 12/08" é histórico que ninguém lê.
 *  · campo fora de `CAMPOS` é ignorado, mesmo vindo no patch.
 */
export function linhasDeHistorico(
  mudancas: MudancaDeCard[], usuarioId: string,
): LinhaDeHistorico[] {
  return mudancas.flatMap(m =>
    CAMPOS.flatMap(campo => {
      if (!(campo in m.patch)) return [];
      const de   = texto(m.antes[campo]);
      const para = texto(m.patch[campo]);
      if (de === para) return [];
      return [{
        criativo_id:    m.id,
        usuario_id:     usuarioId || null,
        tipo_alteracao: campo === 'fase' ? 'fase' : 'campo',
        campo_alterado: campo,
        valor_anterior: de,
        valor_novo:     para,
      }];
    }),
  );
}

/**
 * Grava o histórico.
 *
 * Nunca lança. Um card movido e um histórico que falhou é ruim; um card que
 * não se move porque o histórico falhou é pior — e o erro apareceria como se o
 * arrasto não tivesse funcionado.
 */
export async function registrarMudancas(
  mudancas: MudancaDeCard[], usuarioId: string,
): Promise<void> {
  const linhas = linhasDeHistorico(mudancas, usuarioId);
  if (!linhas.length) return;
  const { error } = await supabase.from('criativo_historico').insert(linhas);
  if (error) console.error('histórico não gravado:', error.message);
}
