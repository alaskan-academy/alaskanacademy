/**
 * Uma parcela não fecha o mês do Simples.
 *
 * ── O que a tela mostrava em 12/10/2026 ───────────────────────────────────
 *
 * Financeiro → Resultado, setembro/2026:
 *
 *     Simples sobre a receita deste mês    R$ 575,54    fonte: extrato
 *
 * Sobre uma base de R$ 215.315,73. Uma alíquota de **0,27%**, apresentada
 * como fato consumado porque a fonte dizia "extrato". O correto é ~R$ 14,9
 * mil, e o resultado de setembro aparecia cerca de **R$ 14 mil maior do que
 * é** — numa tela usada para decidir contratação.
 *
 * A causa era uma linha: `if (pago > 0) return fato`. Qualquer lançamento de
 * "Impostos e Tributos" no mês seguinte fechava a conta. Em 06/10 saiu um de
 * R$ 575,54, e pronto. E não era um caso: TODO mês, do dia 1 até o DAS cair,
 * o mês anterior mostrava lucro que não existe.
 *
 * Ela deu as duas peças que faltavam, nas palavras dela:
 *
 *     "setembro - imposto ainda não foi pago, por isso, falta pagar
 *      este valor foi apenas uma parcela"
 *     "Imposto é sempre pago no mês seguinte dia 20"
 *
 * ── Por que são DUAS condições e não uma ──────────────────────────────────
 *
 * A regra do dia 20 sozinha consertaria hoje e criaria um defeito pior em
 * nove dias: em 21/10 setembro passaria a "vencido", os R$ 575,54 virariam o
 * DAS inteiro, e uma alíquota de 0,27% entraria na média de três meses —
 * contaminando a estimativa de outubro, novembro e dezembro.
 *
 * Por isso o piso: 4% é o primeiro degrau do Anexo I, e nenhum anexo do
 * Simples começa abaixo. Alíquota implícita menor que isso não é alíquota, é
 * pagamento incompleto.
 *
 * ── Por que este teste lê SQL e não roda a conta ─────────────────────────
 *
 * A primeira versão deste arquivo exercitava `simplesDoMes`, em TypeScript.
 * Em 12/10, à tarde, a conta inteira mudou-se para `fn_resultado_mes` e
 * `vw_aliquota_simples_mes`, porque o módulo de Metas precisava do mesmo
 * número e tê-lo em dois lugares já tinha produzido dois lucros diferentes.
 *
 * O caso concreto de setembro continua provado — mas na migração
 * `20261012w`, contra os números que a tela realmente mostrava. Aqui ficam
 * as regras, para que ninguém as desfaça sem reprovar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

const arquivos = readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort()
  .map(n => ({ nome: n, sql: readFileSync(join(MIGRACOES, n), 'utf8') }));

function semComentarios(bruto: string) {
  return bruto.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Só o corpo da última definição da view, sem o cabeçalho nem a prova.
 *
 * As provas das migrações citam de propósito a regra que estão derrubando —
 * casar com o arquivo inteiro encontra o texto da prova em vez do código, e
 * foi assim que um teste deste projeto passou verde sobre o próprio defeito.
 */
function soAView(): string {
  const arquivo = arquivos
    .filter(a => /create or replace view public\.vw_aliquota_simples_mes/i.test(a.sql))
    .pop();
  expect(arquivo, 'nenhuma migração define vw_aliquota_simples_mes').toBeTruthy();

  const sql = arquivo!.sql;
  const i = sql.search(/create or replace view public\.vw_aliquota_simples_mes/i);
  const j = sql.indexOf('comment on view public.vw_aliquota_simples_mes', i);
  const def = semComentarios(sql.slice(i, j > i ? j : undefined));
  expect(def.length, 'não consegui recortar a definição da view').toBeGreaterThan(500);
  return def;
}

describe('o DAS vence dia 20 do mês seguinte', () => {
  it('a view calcula o vencimento como dia 20, não como virada do mês', () => {
    /* `mes` é sempre dia 1, então dia 20 do mês seguinte é +1 mês +19 dias.
       Antes a view esperava o MÊS do pagamento acabar, o que atrasava a
       medida em dez dias à toa. */
    expect(soAView(), 'a view deixou de calcular o vencimento como dia 20')
      .toMatch(/\+\s*interval\s*'1 month'\s*\)::date\s*\+\s*19/);
  });

  it('o que fecha o mês é ter vencido, não ter chegado dinheiro', () => {
    const def = soAView();
    expect(def).toMatch(/pagamento_fechado/);
    expect(def, 'não há comparação com hoje para saber se já venceu')
      .toMatch(/now\(\)\s*at\s*time\s*zone/i);
  });
});

describe('uma parcela não fecha o mês', () => {
  it('o piso vem de configuracoes, por fn_config, e não escrito na view', () => {
    /* Parâmetro fiscal neste projeto sai de tabela: se a lei mudar o
       primeiro degrau, muda uma linha e não um deploy. */
    const def = soAView();
    expect(def, 'a view não consulta o piso legal').toMatch(/simples_aliquota_minima_pct/);
    expect(def, 'o piso foi escrito dentro da view em vez de lido por fn_config')
      .toMatch(/fn_config\(\s*'simples_aliquota_minima_pct'/);

    const semeia = arquivos.some(a =>
      /insert into public\.configuracoes[\s\S]*simples_aliquota_minima_pct/i.test(a.sql));
    expect(semeia, 'ninguém semeia simples_aliquota_minima_pct em configuracoes').toBe(true);
  });

  it('o piso semeado é o primeiro degrau do Anexo I', () => {
    const sql = arquivos.map(a => a.sql).find(s => s.includes("'simples_aliquota_minima_pct'"));
    const valor = sql?.match(/'simples_aliquota_minima_pct'\s*,\s*([\d.]+)/)?.[1];
    expect(valor, 'não achei o valor semeado').toBeTruthy();
    expect(
      Number(valor),
      'o piso saiu de 4%. Nenhum anexo do Simples começa abaixo disso, e abaixo ' +
      'do piso um pagamento é parcela, não alíquota.',
    ).toBe(4);
  });

  it('a média de três meses só conta mês fechado', () => {
    /* Sem isto a parcela de 0,27% entraria na janela e contaminaria a
       estimativa dos meses seguintes — o defeito deixaria de ser de um mês
       e viraria de três. */
    const def = soAView();
    expect(def, 'a janela deixou de ser de três meses')
      .toMatch(/rows between 2 preceding and current row/i);
    expect(def, 'a janela parou de filtrar por pagamento_fechado')
      .toMatch(/case when c\.pagamento_fechado then/i);
  });
});

describe('quem usa o número respeita o estado dele', () => {
  it('fn_resultado_mes presume quando o mês não fechou, e usa o pago quando fechou', () => {
    const arquivo = arquivos
      .filter(a => /create\s+or\s+replace\s+function\s+public\.fn_resultado_mes/i.test(a.sql))
      .pop();
    expect(arquivo, 'nenhuma migração define fn_resultado_mes').toBeTruthy();

    const c = semComentarios(arquivo!.sql);
    expect(c, 'a cascata deixou de distinguir pago de presumido')
      .toMatch(/case when coalesce\(q\.pagamento_fechado,\s*false\) then coalesce\(q\.imposto_pago,\s*0\)/);
    expect(c, 'a cascata não expõe quanto já saiu em parcela')
      .toMatch(/simples_pago_parcial/);
    expect(c, 'a cascata não expõe o vencimento')
      .toMatch(/simples_vencimento/);
  });

  it('a tela mostra quanto falta, não só "presumido"', () => {
    /* O que ela precisa ver não é o rótulo: é o buraco. Em 12/10 a tela
       passou a dizer "Já saíram R$ 575,54 em parcela; falta R$ 13.883,45". */
    const tela = readFileSync(join(process.cwd(), 'src', 'features', 'financeiro',
      'pages', 'FinanceiroResultadoPage.tsx'), 'utf8');
    expect(tela, 'a tela deixou de mostrar a parcela já paga').toMatch(/pagoParcial/);
    expect(tela, 'a tela deixou de mostrar quanto falta').toMatch(/falta /);
  });
});
