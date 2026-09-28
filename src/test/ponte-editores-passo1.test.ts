/**
 * Passo 1 da ponte perfis → editores: o que não pode regredir.
 *
 * ── O que aconteceu ────────────────────────────────────────────────────────
 *
 * Adicionar alguém em Usuários cria linha em `perfis`; /editores lê `editores`.
 * A ligação existia e morava só no TypeScript — sumiu num merge em 18/07/2026.
 * Gabriel Nartey (28/09) não foi o primeiro: a Bruna Leopoldo entrou três dias
 * depois daquele merge, fez 709 cards, recebeu R$ 3.677,50, e nunca apareceu.
 * **69 dias**, porque nada na tela mostrava a ausência.
 *
 * ── O limite honesto deste arquivo ─────────────────────────────────────────
 *
 * Teste de repositório não prova estado de banco. As provas de verdade rodam
 * dentro da migração `20260928b` — inclusive a que quase passou pelo motivo
 * errado, porque a chave estrangeira de `documentos_fiscais` barraria o DELETE
 * mesmo com a RLS aberta.
 *
 * O que este arquivo guarda é a forma: que a regra continue derivada de tabela,
 * que os dois consertos de número não sejam desfeitos, e que o painel não perca
 * o canário.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACOES = join(process.cwd(), 'supabase', 'migrations');
const ORIGEM = '20260928b';

const arquivos = readdirSync(MIGRACOES).filter(n => n.endsWith('.sql')).sort();
const origem = arquivos.find(n => n.startsWith(ORIGEM));
const semComentarios = (sql: string) =>
  sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/*
 * Sem comentários, e isto não é detalhe: três verificações deste arquivo liam o
 * .tsx inteiro, comentários junto. Comentar o componente — que é o jeito mais
 * comum de desligar algo "só por um minuto" — deixava as três verdes. Achado em
 * revisão adversarial em 28/09, no mesmo dia em que nasceram.
 */
const lerCodigo = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

describe('passo 1 da ponte perfis → editores', () => {
  it('a migração continua no repositório', () => {
    expect(origem, `sumiu a migração ${ORIGEM}`).toBeTruthy();
  });

  it('quem é editor sai de TABELA, não de uma lista no código', () => {
    /*
     * Terceira armadilha do CLAUDE.md: lista fixa no código envelhece em
     * silêncio — o DRE escondeu R$ 10.065 exatamente assim.
     *
     * A regra tem que ser `setores.pagina_key = 'editores'`, que já existia no
     * banco e ninguém lia. No dia em que Copy virar setor avaliado, é UMA LINHA
     * na tabela de setores, não uma migração nova.
     */
    const sql = semComentarios(readFileSync(join(MIGRACOES, origem!), 'utf8'));
    expect(sql, 'a derivação por pagina_key sumiu').toMatch(/pagina_key\s*=\s*'editores'/i);
    expect(
      /s\.nome\s*(=|in)\s*\(?\s*'Editor'/i.test(sql),
      'o setor virou nome literal no SQL — no dia em que Copy for avaliado, isso exige migração em vez de uma linha',
    ).toBe(false);
  });

  it('o ranking de desempenho continua peneirando editor inativo nos DOIS ramos', () => {
    /* A tela mede a PESSOA e já dizia em prosa que quer só ativo; o filtro
       estava só na lista de nomes, e as linhas do RPC vinham inteiras — um
       inativo aparecia como travessão, somando no denominador de uma tela que
       apoia decisão de bônus. */
    const sql = semComentarios(readFileSync(join(MIGRACOES, origem!), 'utf8'));
    const ocorrencias = sql.match(/join\s+editores\s+e\s+on[^\n]*and\s+e\.ativo/gi) ?? [];
    expect(
      ocorrencias.length,
      'o filtro `and e.ativo` tem que estar nos dois ramos: o novo (producoes) e o legado (avaliacoes_criativos)',
    ).toBe(2);
  });

  it('a cobrança de nota fiscal continua respeitando a data de entrada', () => {
    /* Medido antes: um editor recém-criado abria a aba com 3 cobranças
       vermelhas, uma de competência agosto/2026 — mês em que não existia. */
    const sql = semComentarios(readFileSync(join(MIGRACOES, origem!), 'utf8'));
    expect(sql, 'o piso por data_inicio sumiu de fn_nfs_do_editor').toMatch(
      /date_trunc\('month',\s*ed\.data_inicio\)/i,
    );
    expect(sql, 'o piso não está sendo aplicado na competência').toMatch(
      /competencia\s*>=\s*coalesce\(\s*\(select piso from inicio\)/i,
    );
  });

  it('nenhuma migração posterior devolve o poder de apagar editor', () => {
    /* 6 das 7 tabelas filhas somem em CASCADE — 61 linhas de avaliações, notas
       e remuneração. E nada no sistema apaga editor: 13 chamadas no front,
       todas leitura ou update, e zero nas edge functions. */
    const posteriores = arquivos.filter(n => n.slice(0, 9) >= ORIGEM);
    const culpadas: string[] = [];
    for (const nome of posteriores) {
      const sql = semComentarios(readFileSync(join(MIGRACOES, nome), 'utf8'));
      /*
       * `(?:public\.)?` não é enfeite: a policy que ESTA migração removeu está
       * escrita na baseline como `create policy authenticated_write on
       * public.editores for ALL ...`. Sem o prefixo opcional, colar exatamente
       * ela de volta passava batido — a guarda vigiava uma grafia que metade do
       * repositório não usa. Encontrado por revisão adversarial em 28/09, no
       * mesmo dia em que a guarda nasceu.
       *
       * O `\b` no fim impede casar com `ofertas_editores`, que é outra tabela.
       */
      if (/create\s+policy[^;]*\bon\s+(?:public\.)?editores\b[^;]*for\s+(all|delete)/i.test(sql)) {
        culpadas.push(nome);
      }
    }
    expect(
      culpadas,
      `${culpadas.join(', ')} devolve DELETE (ou FOR ALL) em \`editores\` para ` +
        `\`authenticated\`. Qualquer pessoa logada voltaria a poder apagar um ` +
        `editor, levando 61 linhas filhas junto em CASCADE.`,
    ).toEqual([]);
  });

  it('o painel mostra o canário quando nenhum setor está marcado', () => {
    /*
     * A parte menos óbvia e mais importante: a lista de pendentes sai de
     * `pagina_key`. Se alguém limpar essa configuração, a lista fica VAZIA — e
     * vazio aqui se lê como "está tudo certo". É a quarta armadilha invertida:
     * o retrato continua bonito porque parou de ser tirado.
     */
    const tsx = lerCodigo('src/features/admin/components/PonteEditoresAviso.tsx');
    expect(tsx, 'o componente não olha setores_marcados').toMatch(/setores_marcados\s*===?\s*0/);
    expect(tsx, 'a view de saúde não é consultada').toMatch(/vw_ponte_editores_saude/);
    expect(tsx, 'a lista de pendentes não é consultada').toMatch(/vw_ponte_editores_pendente/);
  });

  it('o painel trata erro em vez de sumir calado', () => {
    /* `|| []` transformando falha em lista vazia é o defeito que já apagou o
       calendário da Produção e os gráficos de Desempenho. Numa faixa cujo
       trabalho é DENUNCIAR ausência, sumir em silêncio é o pior desfecho. */
    const tsx = lerCodigo('src/features/admin/components/PonteEditoresAviso.tsx');
    expect(tsx, 'o componente não trata erro da consulta').toMatch(/\.error/);
    expect(tsx, 'o erro não chega à tela').toMatch(/setErro/);
  });

  it('a faixa está montada na tela de Usuários', () => {
    /* Componente que ninguém monta é a tela de cadastro sem a de resultado —
       exatamente o que deixou isso invisível por 69 dias. */
    const tab = lerCodigo('src/features/admin/components/GerenciarUsuariosTab.tsx');
    expect(tab, 'PonteEditoresAviso não está montado em GerenciarUsuariosTab').toMatch(
      /<PonteEditoresAviso\s*\/>/,
    );
  });
});
