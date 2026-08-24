/**
 * Recorrência — um modelo só para o produto inteiro.
 *
 * As colunas (`recorrencia_tipo`, `recorrencia_dias_semana`, `recorrencia_fim`,
 * `recorrencia_pai_id`) nasceram em `copy_rotina_cards` e foram repetidas em
 * `eventos` de propósito: ter dois modelos de recorrência no mesmo sistema é
 * garantir que um deles esteja errado.
 *
 * A expansão acontece aqui, no front, e não no banco — é como o RotinaCalendar
 * já fazia, e evita ter que expandir série em SQL só para desenhar uma semana.
 */

export type TipoRecorrencia = 'diario' | 'semanal' | 'mensal';

export interface RegraRecorrencia {
  /** Data da primeira ocorrência, em `yyyy-MM-dd`. */
  inicio: string;
  recorrencia_tipo: string | null;
  /** 0 = domingo, como `Date.getDay()`. */
  recorrencia_dias_semana: number[] | null;
  recorrencia_fim: string | null;
}

/** Segunda-feira da semana em que `d` cai. */
export function segundaDa(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function toYMD(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function daYMD(s: string): Date {
  // Sem fuso: `new Date('2026-08-24')` vira UTC e volta um dia no Brasil.
  return new Date(s + 'T00:00:00');
}

/**
 * Todas as datas em que a regra cai dentro de [ini, fim], em ordem.
 *
 * Inclui a data de início quando ela própria está no intervalo, a não ser que
 * `incluirBase` seja falso — o RotinaCalendar desenha o card base por fora e
 * só quer as repetições.
 *
 * O laço é limitado a 400 passos: regra malformada (semanal sem dias marcados,
 * por exemplo) não pode travar a tela.
 */
export function ocorrencias(
  regra: RegraRecorrencia,
  ini: string,
  fim: string,
  opcoes: { incluirBase?: boolean } = {},
): string[] {
  const incluirBase = opcoes.incluirBase !== false;
  const datas: string[] = [];

  if (incluirBase && regra.inicio >= ini && regra.inicio <= fim) {
    datas.push(regra.inicio);
  }

  const tipo = regra.recorrencia_tipo as TipoRecorrencia | null;
  if (!tipo || tipo === ('none' as TipoRecorrencia)) return datas;

  const limite = regra.recorrencia_fim && regra.recorrencia_fim < fim ? regra.recorrencia_fim : fim;
  const base = daYMD(regra.inicio);
  const cur = daYMD(regra.inicio);
  const diasSemana = regra.recorrencia_dias_semana ?? [];

  // Semanal sem nenhum dia marcado nunca cairia em lugar nenhum: repete no
  // mesmo dia da semana do início, que é o que a pessoa quis dizer.
  const dias = tipo === 'semanal' && diasSemana.length === 0 ? [base.getDay()] : diasSemana;

  for (let passo = 0; passo < 400; passo++) {
    if (tipo === 'mensal') cur.setMonth(cur.getMonth() + 1);
    else cur.setDate(cur.getDate() + 1);

    const ymd = toYMD(cur);
    if (ymd > limite) break;

    let cai = false;
    if (tipo === 'diario') cai = true;
    else if (tipo === 'semanal') cai = dias.includes(cur.getDay());
    else if (tipo === 'mensal') cai = cur.getDate() === base.getDate();

    if (cai && ymd >= ini) datas.push(ymd);
  }

  return datas;
}
