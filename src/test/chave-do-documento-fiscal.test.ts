/**
 * O `onConflict` de quem grava documento fiscal tem de casar com a chave única
 * da tabela — e a chave tem de ter a EMPRESA dentro.
 *
 * ── As duas coisas que já custaram caro aqui ───────────────────────────────
 *
 * 1. **Listar menos colunas que a constraint não degrada: para tudo.** O
 *    PostgREST exige correspondência exata, e declarar quatro das cinco
 *    devolvia "there is no unique or exclusion constraint matching the ON
 *    CONFLICT specification" — *nenhuma nota conseguia ser gravada*. Está
 *    escrito no comentário de `FinanceiroNotasFiscaisPage`, e o mesmo defeito
 *    com `regras_categoria` passou 27 dias sem ninguém saber o que perguntar
 *    (ver `regra-de-categoria-nasce.test.ts`, de onde este teste copia a
 *    ideia).
 *
 * 2. **Sem `empresa_id` na chave, duas empresas colapsam numa linha.** Com
 *    `upsert`, a nota do segundo CNPJ fazia `UPDATE` na do primeiro: trocava a
 *    empresa e o `storage_path`, e o arquivo do primeiro ficava órfão na pasta
 *    do outro. Em silêncio, com sucesso na tela. Nas notas de serviço — as que
 *    o editor manda — a `referencia_externa` é `''` em 10 de 10, então a
 *    colisão era GARANTIDA se as duas pagassem o mesmo editor na mesma
 *    competência. Migração `20261008c`.
 *
 * O que este teste consegue: que os `onConflict` do código e a chave na
 * migração contem a mesma história. Se o banco mudar sem a migração, ele não
 * vê — e é por isso que o CLAUDE.md proíbe migração sem arquivo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const raiz = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf-8');

/** As colunas da chave única de `documentos_fiscais`, lidas da migração mais
 *  recente que cria um índice único sobre a tabela. Derivado, não listado: uma
 *  coluna a mais numa migração nova faz este teste falhar junto. */
function colunasDaChave(): string[] {
  const dir = join(raiz, 'supabase', 'migrations');
  let maisRecente: { arquivo: string; colunas: string[] } | null = null;

  for (const arq of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, arq), 'utf-8');
    // `create unique index ... on public.documentos_fiscais (a, b, c)`
    const m = sql.match(
      /create\s+unique\s+index[^;]*?on\s+(?:public\.)?documentos_fiscais\s*\(([^)]*)\)/is,
    );
    if (m) maisRecente = { arquivo: arq, colunas: colunas(m[1]) };
  }

  expect(maisRecente, 'não achei nenhum índice único de documentos_fiscais nas migrações')
    .not.toBeNull();
  return maisRecente!.colunas;
}

const colunas = (lista: string) =>
  lista.split(',').map(c => c.trim()).filter(Boolean).sort();

/** Todo `.ts`/`.tsx` sob um diretório. A lista sai do repositório, não da
 *  memória de quem escreve o teste — foi um escritor esquecido que deixou o
 *  `cs-comprovantes` fora da unificação dos caminhos. */
function varrer(dir: string): string[] {
  const achados: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const cheio = join(dir, e.name);
    if (e.isDirectory()) achados.push(...varrer(cheio));
    else if (/\.tsx?$/.test(e.name)) achados.push(cheio.slice(raiz.length + 1).replace(/\\/g, '/'));
  }
  return achados;
}

/** Cada `upsert` em `documentos_fiscais` com o `onConflict` que ele declara. */
function upsertsDeDocumento(): { arquivo: string; colunas: string[] }[] {
  const achados: { arquivo: string; colunas: string[] }[] = [];
  /* `src/test` fica fora: teste não grava documento fiscal, e o comentário
     deste arquivo cita um `onConflict: '...'` de exemplo — a primeira versão
     tropeçou na própria documentação. */
  const fontes = [
    ...varrer(join(raiz, 'src')).filter(f => !f.startsWith('src/test/')),
    ...varrer(join(raiz, 'supabase', 'functions')),
  ];

  for (const f of fontes) {
    const src = ler(f);
    // `from('documentos_fiscais').upsert({...}, { onConflict: '...' })` — o
    // bloco é grande e tem chaves dentro, então a busca vai do `from` até o
    // `onConflict` seguinte, sem tentar casar parênteses.
    const re = /from\('documentos_fiscais'\)[\s\S]{0,4000}?\.upsert\([\s\S]{0,4000}?onConflict:\s*'([^']+)'/g;
    for (const m of src.matchAll(re)) achados.push({ arquivo: f, colunas: colunas(m[1]) });
  }
  return achados;
}

describe('a chave do documento fiscal', () => {
  it('a migração cria um índice único e ele tem empresa_id', () => {
    const chave = colunasDaChave();
    expect(chave.length).toBeGreaterThan(1);
    // A coluna que impede duas empresas de colapsarem na mesma linha. Se um dia
    // alguém criar um índice novo sem ela, a colisão silenciosa volta.
    expect(chave, 'o índice único mais recente não tem empresa_id').toContain('empresa_id');
  });

  it('há upserts de documento fiscal no código', () => {
    // Se a varredura quebrar, os testes abaixo passariam vazios — que é o jeito
    // mais calado de um teste deixar de valer.
    expect(upsertsDeDocumento().length).toBeGreaterThanOrEqual(3);
  });

  it('todo onConflict declara EXATAMENTE as colunas da chave', () => {
    const chave = colunasDaChave();
    for (const u of upsertsDeDocumento()) {
      expect(u.colunas, `${u.arquivo}: o onConflict não casa com a chave única`)
        .toEqual(chave);
    }
  });

  it('as três telas/funções que gravam estão cobertas', () => {
    // Nomeadas porque são as que existem, e se uma sumir da lista é porque
    // alguém mexeu em quem grava documento fiscal — o que deve ser deliberado.
    const arquivos = upsertsDeDocumento().map(u => u.arquivo);
    for (const esperado of [
      'src/features/financeiro/pages/FinanceiroNotasFiscaisPage.tsx',
      'src/features/editores/components/NotasFiscaisTab.tsx',
      'supabase/functions/cs-comprovantes/index.ts',
    ]) {
      expect(arquivos, `${esperado} deixou de gravar documento fiscal?`).toContain(esperado);
    }
  });

  it('a nota do editor não tira a empresa do filtro do cabeçalho', () => {
    /* O cabeçalho responde "qual operação estou olhando". Uma nota fiscal é
       emitida PARA um CNPJ, e o padrão do cabeçalho é "Ambas" — então o editor
       anexava a nota e levava uma recusa apontando para um seletor que ele não
       tem por que mexer. A empresa agora é escolhida na própria aba. */
    const src = ler('src/features/editores/components/NotasFiscaisTab.tsx');
    expect(src, 'a aba de NF voltou a usar o filtro do cabeçalho como dono da nota')
      .not.toMatch(/useFilters\(\)/);
    expect(src).toMatch(/from\('empresas'\)[\s\S]{0,200}?eq\('ativo',\s*true\)/);
  });
});
