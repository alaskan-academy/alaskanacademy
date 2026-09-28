/**
 * Passo 3: a ficha de editor nasce sozinha — e o que não pode regredir nisso.
 *
 * ── O que custou 69 dias ───────────────────────────────────────────────────
 *
 * A ligação entre `perfis` e `editores` existia e morava só no TypeScript.
 * Sumiu num merge em 18/07/2026. Desde então nenhum editor novo ganhou ficha:
 * o Gabriel Nartey (28/09) e a Bruna Leopoldo, que fez 709 cards e recebeu
 * R$ 3.677,50 sem nunca aparecer na tela de Editores.
 *
 * O que mora só no TypeScript morre num merge de TypeScript. Agora mora numa
 * migração — e este arquivo existe para que ela continue lá, inteira.
 *
 * ── O que um ataque adversarial achou ANTES de aplicar ─────────────────────
 *
 * A primeira versão desta migração tinha cinco defeitos, três deles graves:
 *
 *   1. a carga do passado fazia `UPDATE perfis SET id = id`, e o gatilho é
 *      `UPDATE OF nome, cargo_id, setor_id, ativo`. O Postgres decide se
 *      dispara pela LISTA DO SET, não pelo valor ter mudado — a carga rodaria
 *      em silêncio sem criar ficha nenhuma;
 *   2. a prova exigia `data_inicio <= primeiro card` de TODA ficha, e a
 *      Jaqueline tem 02/10/2025 contra um card de 20/05/2024 — a migração
 *      abortaria por um dado de 2024 que ela nem toca;
 *   3. o gatilho espelhava `cargo_id`, e `PerfisTab.tsx:307` grava promoção
 *      direto em `editores.cargo_id`. Medido no ensaio: "promoção gravada =
 *      Sênior (x1.3); depois de um toque no perfil = Pleno (x1.2)". A promoção
 *      seria desfeita em silêncio.
 *
 * Por isso o gatilho CRIA e não espelha, e por isso as guardas abaixo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const ORIGEM = '20260928c';
const FUNCAO = 'fn_editor_nasce_do_perfil';
const GATILHO = 'trg_editor_nasce_do_perfil';

const arquivos = readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort();
const origem = arquivos.find(n => n.startsWith(ORIGEM));
const semComentarios = (s: string) =>
  s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const sql = () => semComentarios(readFileSync(join(MIGRACOES, origem!), 'utf8'));

const lerCodigo = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('a ficha de editor nasce sozinha', () => {
  it('a migração continua no repositório', () => {
    expect(origem, `sumiu a migração ${ORIGEM}`).toBeTruthy();
  });

  it('a condição sai de `pagina_key`, não de um nome de setor no código', () => {
    /* Terceira armadilha: lista fixa envelhece em silêncio. A regra tem que ser
       derivada da tabela — no dia em que Copy for avaliado, é UMA LINHA. */
    expect(sql(), 'a derivação por pagina_key sumiu').toMatch(/pagina_key\s*=\s*'editores'/i);
    expect(
      /s\.nome\s*(=|in)\s*\(?\s*'Editor'/i.test(sql()),
      'o setor virou nome literal — marcar um setor novo passaria a exigir migração',
    ).toBe(false);
  });

  it('a carga do passado toca uma coluna que o gatilho VIGIA', () => {
    /*
     * Este é o defeito mais silencioso dos três: `UPDATE perfis SET id = id`
     * não dispara um gatilho declarado como `UPDATE OF nome, ...`, porque o
     * Postgres olha a LISTA DO SET. A carga rodaria, não criaria nada, e só a
     * prova seguinte acusaria — sem dizer por quê.
     */
    const s = sql();
    const vigiadas = (s.match(/UPDATE\s+OF\s+([^\n]+?)\s+ON\s+perfis/i) ?? [])[1];
    expect(vigiadas, 'não achei a lista de colunas vigiadas pelo gatilho').toBeTruthy();
    const colunas = vigiadas.split(',').map(c => c.trim().toLowerCase());

    const carga = s.match(/UPDATE\s+perfis\s+SET\s+(\w+)\s*=\s*\w+\s*;/i);
    expect(carga, 'não achei a carga do passado (UPDATE perfis SET x = x)').toBeTruthy();
    expect(
      colunas,
      `a carga toca \`${carga![1]}\`, que NÃO está entre as colunas vigiadas ` +
        `[${colunas.join(', ')}]. O gatilho não dispararia e a carga criaria zero fichas, em silêncio.`,
    ).toContain(carga![1].toLowerCase());
  });

  it('os três carimbos continuam na criação da ficha', () => {
    /* Cada um foi medido: sem `ativo` a Bruna nasce ativa; sem `data_inicio` a
       aba de NF cobra meses de antes da entrada; sem `cargo_id` o Novato com
       multiplicador ZERO paga comissão cheia — o conserto do dia não valeria
       para a primeira pessoa que ele deveria atender. */
    const s = sql();
    const insert = s.match(/INSERT\s+INTO\s+editores\s*\(([^)]*)\)/i);
    expect(insert, 'não achei o INSERT em editores').toBeTruthy();
    const colunas = insert![1].split(',').map(c => c.trim().toLowerCase());
    for (const c of ['nome', 'usuario_id', 'cargo_id', 'data_inicio', 'ativo']) {
      expect(colunas, `o INSERT da ficha não carimba \`${c}\``).toContain(c);
    }
    expect(s, 'a data de início deixou de sair do primeiro card').toMatch(
      /min\(p\.criado_em\)::date/i,
    );
  });

  it('o gatilho NÃO espelha ficha que já existe', () => {
    /*
     * Medido no ensaio adversarial: com o espelho ligado, uma promoção gravada
     * na linha do tempo do editor (PerfisTab.tsx:307 escreve direto em
     * `editores.cargo_id`) era desfeita no próximo toque qualquer no perfil —
     * Sênior x1.3 voltava para Pleno x1.2.
     *
     * Enquanto as duas telas escreverem na ficha, espelhar aqui é escolher um
     * vencedor em silêncio. A troca de dono do cargo é decisão de produto, não
     * de migração: `perfis.cargo_id` manda na RLS, então promover passaria a
     * conceder permissão.
     */
    const s = sql();
    const corpo = s.match(new RegExp(`FUNCTION\\s+public\\.${FUNCAO}[\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$`, 'i'));
    expect(corpo, 'não achei o corpo da função').toBeTruthy();

    /* O único UPDATE de editores permitido para ficha já existente é o de
       DESATIVAR quem saiu do setor — ali não há tela competindo. */
    const updates = corpo![1].match(/UPDATE\s+editores\s+SET\s+([^;]*)/gi) ?? [];
    const proibidos = updates.filter(u => /\bnome\s*=\s*NEW\.nome/i.test(u));
    expect(
      proibidos,
      'a função voltou a espelhar `nome` para a ficha: uma promoção ou um toggle ' +
        'gravado pela tela seria desfeito no próximo toque no perfil.',
    ).toEqual([]);
  });

  it('a adoção de ficha órfã vale só durante a carga', () => {
    /* Fora da carga, `usuario_id` nulo quer dizer "desvincularam de propósito"
       (PermissoesTab.tsx:232). Readotar desfaria a desvinculação no toque
       seguinte — medido: "após desvincular = DESVINCULADA; após um toque no
       perfil = <id de volta>". */
    const s = sql();
    expect(s, 'a adoção por nome deixou de ser condicionada à carga').toMatch(
      /current_setting\('ponte\.carga'[\s\S]{0,200}?usuario_id IS NULL/i,
    );
    expect(s, 'a carga não liga o sinalizador `ponte.carga`').toMatch(
      /SET\s+LOCAL\s+ponte\.carga\s*=\s*'on'/i,
    );
  });

  it('a prova das fichas novas não pune ficha antiga', () => {
    /* A versão anterior abortava a migração por causa da Jaqueline:
       data_inicio 02/10/2025 contra um card de 20/05/2024. Consertar dado
       antigo é tarefa própria — não carona dentro de uma migração de
       estrutura. */
    expect(sql(), 'a prova voltou a cobrir todas as fichas, e não só as novas').toMatch(
      /NOT IN \(SELECT id FROM _ponte3_antes\)/i,
    );
  });

  it('nenhuma migração posterior derruba o gatilho sem recriá-lo', () => {
    const posteriores = arquivos.filter(n => n.slice(0, 9) > ORIGEM);
    const culpadas: string[] = [];
    for (const nome of posteriores) {
      const s = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));
      const derruba = new RegExp(`drop\\s+trigger[^;]*${GATILHO}`, 'i').test(s)
        || new RegExp(`drop\\s+function[^;]*${FUNCAO}`, 'i').test(s);
      if (derruba && !new RegExp(`create\\s+trigger\\s+${GATILHO}`, 'i').test(s)) {
        culpadas.push(nome);
      }
    }
    expect(
      culpadas,
      `${culpadas.join(', ')} derruba \`${GATILHO}\` e não o recria — editor novo ` +
        `volta a não ganhar ficha, e ninguém percebe até alguém perguntar.`,
    ).toEqual([]);
  });
});

describe('a aba de Notas Fiscais não escolhe pessoa sozinha', () => {
  const TELA = 'src/features/editores/components/NotasFiscaisTab.tsx';

  it('só escolhe automaticamente quando há uma pessoa só', () => {
    /*
     * O upload grava `fornecedor: editorAtual.nome`, monta o nome do arquivo
     * com ele, e dispara direto do seletor de arquivo, sem confirmação. Com o
     * Gabriel na lista, o padrão deixaria de ser "Jaqueline Coelho" e a nota
     * dela seria arquivada no nome dele — com sucesso na tela.
     */
    const tsx = lerCodigo(TELA);
    expect(
      tsx,
      'a aba voltou a escolher a primeira pessoa da lista sozinha',
    ).toMatch(/lista\.length === 1\s*\?\s*lista\[0\]\.id\s*:\s*''/);
    expect(
      /setEditorId\(prev => prev \|\| \(data\?\.\[0\]\?\.id/.test(tsx),
      'voltou o `data?.[0]?.id`: a ordem alfabética escolhe por você',
    ).toBe(false);
  });

  it('tem estado vazio quando ninguém está escolhido', () => {
    /* Tela em branco se lê como "não tem nota nenhuma este mês", que é outra
       coisa. Estado vazio é obrigatório para lista, diz o CLAUDE.md. */
    expect(lerCodigo(TELA), 'não há estado vazio para "nenhum editor escolhido"')
      .toMatch(/!editorId \?[\s\S]{0,300}?Escolha o editor/);
  });

  it('o seletor continua aparecendo quando ninguém está escolhido', () => {
    /* O retorno antecipado sumia com a tela inteira, seletor junto — e aí a
       escolha ficaria impossível de fazer. */
    expect(lerCodigo(TELA), 'o retorno antecipado voltou a depender só de `editorId`')
      .toMatch(/nadaParaEscolher\s*=\s*ehAdmin\s*\?\s*editores\.length === 0/);
  });
});
