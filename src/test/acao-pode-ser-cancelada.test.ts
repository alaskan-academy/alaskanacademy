/**
 * Desistir de uma ação é um veredito, não um engano.
 *
 * ── O que faltava ─────────────────────────────────────────────────────────
 *
 * A ação só saía da lista de duas formas, e nenhuma servia para "decidimos
 * não fazer":
 *
 *   · marcar como FEITA mente sobre o que aconteceu, e ainda joga a linha no
 *     bloco "O que já foi feito", ao lado dos números que ela não mexeu;
 *   · APAGAR diz, na própria confirmação, "a decisão some do histórico e não
 *     volta".
 *
 * O preço estava na tela em 04/10/2026: "Criar uma Nova VSL de topo" aberta
 * com "desde 08/09/2026" piscando em âmbar havia um mês, porque nenhuma das
 * duas saídas era verdade.
 *
 * ── O estado mora no banco, e o gatilho resolve o conflito ────────────────
 *
 * `cancelada_em` é excludente com `feita`, e há um CHECK dizendo isso. Mas o
 * CHECK é a rede, não a regra: medido em 04/10/2026, mandar `feita = true` e
 * `cancelada_em = now()` no MESMO update faz o gatilho normalizar para FEITA
 * antes de o CHECK ser consultado, partindo de aberta ou de cancelada. O
 * estado inválido nunca chega a existir.
 *
 * Marcar um lado LIMPA o outro em vez de recusar: quem cancelou e depois fez
 * quer o segundo estado, não um erro na cara.
 *
 * ── O motivo reusa `resultado` ────────────────────────────────────────────
 *
 * Um campo próprio de "motivo do cancelamento" seria o mesmo fato em dois
 * lugares — a primeira armadilha do CLAUDE.md. `resultado` já é "o que ficou
 * dessa ação", e serve aos dois destinos: o que deu, ou por que não fizemos.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarNota } from '@/features/analises/exportar';

const ler = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/\/\/[^\n]*/g, '');

const LISTA    = 'src/features/analises/components/ListaAcoes.tsx';
const EDITAVEL = 'src/features/analises/components/AcaoEditavel.tsx';

const nota = (acao: Record<string, unknown>) => montarNota({
  dataRodada: '2026-10-04', projeto: null, rev: 'REV1', metodo: null,
  metricas: null, retencao: null, leitura: '',
  acoes: [acao],
} as never);

describe('uma ação pode ser cancelada', () => {
  it('cancelada sai das pendentes', () => {
    // Era isto que fazia "desde 08/09" piscar por um mês depois de a equipe
    // já ter desistido da ação.
    expect(ler(LISTA), `${LISTA}: cancelada voltou a contar como aberta`).toMatch(
      /acoes\.filter\(a => !a\.feita && a\.cancelada_em == null\)/,
    );
  });

  it('cancelada continua na tela, recolhida', () => {
    // Sumir de vez apagaria da tela a decisão de desistir, tomada ali mesmo.
    // "Linha visível numa tela e invisível na outra é pior que linha apagada."
    const codigo = ler(LISTA);
    expect(codigo, `${LISTA}: sumiu a lista das canceladas`).toMatch(
      /const canceladas = acoes\.filter\(a => a\.cancelada_em != null\)/,
    );
    expect(codigo, `${LISTA}: as canceladas deixaram de ser mostradas`).toMatch(
      /canceladas\.map\(/,
    );
  });

  it('a caixinha some quando cancelada', () => {
    // Marcar como feita o que foi cancelado precisaria desfazer o cancelamento
    // antes, e caixinha que faz duas coisas num clique ninguém entende.
    expect(ler(EDITAVEL), `${EDITAVEL}: a caixinha voltou na linha cancelada`).toMatch(
      /cancelada \? \(/,
    );
  });

  it('o motivo reusa o campo do veredito', () => {
    // Campo próprio de motivo seria o mesmo fato em dois lugares.
    const codigo = ler(EDITAVEL);
    expect(codigo, 'o resultado precisa valer para a cancelada também').toMatch(
      /\(acao\.feita \|\| cancelada\) && onResultado/,
    );
    expect(codigo, `${EDITAVEL}: apareceu um campo separado de motivo`).not.toMatch(
      /motivo_cancelamento/,
    );
  });

  it('na nota do Obsidian a cancelada não parece aberta', () => {
    // `[ ]` diria que continua em aberto, e o vault passaria a discordar do
    // painel sem nada denunciando. `[-]` é a convenção que o Obsidian risca.
    const md = nota({
      texto: 'Criar uma Nova VSL de topo',
      expectativa: 'Aumentar o frescor da oferta',
      resultado: 'Decidimos focar na margem antes de mexer no topo.',
      cancelada: true, feita: false, feita_em: null, feita_por_nome: null,
    });
    expect(md).toContain('- [-] Criar uma Nova VSL de topo');
    expect(md).not.toContain('- [ ] Criar uma Nova VSL de topo');
    expect(md).toContain('📊 Decidimos focar na margem antes de mexer no topo.');
  });

  it('feita e aberta continuam com as caixas de antes', () => {
    const feita = nota({
      texto: 'Trocar a headline', expectativa: null, resultado: null,
      cancelada: false, feita: true,
      feita_em: '2026-09-08T18:02:00-03:00', feita_por_nome: 'Lucas Veiga',
    });
    expect(feita).toContain('- [x] Trocar a headline');

    const aberta = nota({
      texto: 'Subir o preço', expectativa: null, resultado: null,
      cancelada: false, feita: false, feita_em: null, feita_por_nome: null,
    });
    expect(aberta).toContain('- [ ] Subir o preço');
  });
});
