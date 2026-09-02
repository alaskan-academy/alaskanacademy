/**
 * A taxa da Payt é medida POR DIFERENÇA, e isso não é um detalhe de estilo.
 *
 * O array `commission` do postback tem uma linha `platform`, e a leitura óbvia
 * seria "a taxa é essa linha". Ela está errada, e o jeito como está errada é o
 * pior possível: silenciosamente, e cada vez mais.
 *
 * A Payt parou de declarar a taxa inteira em `platform`. Medido nas 4.848
 * vendas pagas com `commission` no payload:
 *
 *   cartão      platform    o que sobra   TOTAL RETIDO
 *   mai/2026     6,26%        0,00%         6,26%
 *   jun/2026     5,59%        0,72%         6,31%
 *   jul/2026     1,41%        4,68%         6,08%
 *   ago/2026     1,81%        4,19%         6,00%
 *   set/2026     1,04%        4,81%         5,84%
 *
 * A coluna da direita não se mexe. O que a Payt cobra continua sendo ~6% —
 * só deixou de caber numa linha só. No cartão a separação segue o
 * parcelamento: à vista `platform` ainda carrega 3,31%, em 7x carrega 0,00%
 * e o total retido continua 5,99%.
 *
 * Ou seja: quem lesse `platform` veria a taxa da Payt CAINDO de 6,26% para
 * 1,04% entre maio e setembro, e o painel mostraria lucro nascendo do nada,
 * crescendo mês a mês, sem nenhum erro visível em lugar nenhum.
 *
 * A conta certa é a que o banco faz: `sem_juros − produtor − coprodutor`.
 * Ela não depende de a Payt manter o nome das linhas, só de o dinheiro fechar.
 *
 * Este teste existe para que "simplificar somando a linha platform" quebre a
 * verificação em vez de quebrar o resultado. É primo do
 * `configuracoes-por-empresa.test.ts`: lê o CÓDIGO, porque contra o banco de
 * hoje as duas contas dariam números plausíveis — só um deles seria verdade.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');

/** A migração mais recente que (re)define a função da taxa. É ela que vale. */
function definicaoVigente(): { arquivo: string; sql: string } {
  const arquivos = readdirSync(MIGRACOES)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .filter((n) =>
      readFileSync(join(MIGRACOES, n), 'utf8').includes(
        'FUNCTION public.fn_atualizar_taxa_plataforma',
      ),
    );
  const arquivo = arquivos[arquivos.length - 1];
  return { arquivo, sql: readFileSync(join(MIGRACOES, arquivo), 'utf8') };
}

/** SQL sem comentários: um `--` explicando a regra não pode passar por código. */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

describe('a taxa da Payt', () => {
  const { arquivo, sql } = definicaoVigente();
  const codigo = semComentarios(sql);

  it('é calculada por diferença, não pela linha `platform`', () => {
    expect(codigo).toContain('v_sem_juros - v_produtor - v_copro');
  });

  it('não lê `type` = `platform` em lugar nenhum', () => {
    /* Se um dia precisar ler (para EXIBIR o quanto a Payt declara, por
       exemplo), que seja numa coluna própria — nunca como fonte da taxa. */
    expect(codigo).not.toMatch(/'platform'/);
    expect(arquivo).toMatch(/\.sql$/);
  });

  it('desconta o coprodutor antes de chamar o resto de taxa', () => {
    expect(codigo).toContain("c.v->>'type' = 'coproducer'");
    expect(codigo).toContain("c.v->>'type' = 'producer'");
  });
});

describe('a diferença entre as duas contas', () => {
  /* Agosto/2026, cartão, o mês inteiro. Números reais do payload. */
  const base = 71_307.9;
  const platform = 1_290.22; // o que a Payt declarou na linha `platform`
  const produtor = 66_796.31;
  const copro = 231.2;

  const porDiferenca = base - produtor - copro;

  it('separa 1,81% de 6,00% — a conta ingênua acha um terço da taxa', () => {
    expect((platform / base) * 100).toBeCloseTo(1.81, 2);
    expect((porDiferenca / base) * 100).toBeCloseTo(6.0, 2);
  });

  it('vira lucro fantasma exatamente do tamanho do buraco', () => {
    // O que a conta ingênua deixaria de descontar cai direto no resultado.
    expect(porDiferenca - platform).toBeCloseTo(2_990.17, 2);
  });
});
