import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { caminhoDoDocumento } from '@/lib/documentos';

/*
  O caminho de um documento fiscal é `{empresa}/{competência}/{tipo}/{arquivo}`,
  e ele é montado em TRÊS lugares que não se enxergam:

  - `src/lib/documentos.ts` — o que as telas gravam em `storage_path`
  - `supabase/functions/drive-espelho/index.ts` — a cadeia de pastas no Drive
  - a migração que moveu os 212 — o SQL que calculou o destino

  Três cópias da mesma regra é a primeira armadilha do CLAUDE.md em estado puro,
  e ela já cobrou: as duas telas montavam o caminho à mão, uma carimbava a
  empresa, a outra nunca carimbou, e 38 documentos ficaram sem dono até
  07/10/2026. As três cópias não podem virar uma só — uma é TypeScript do
  cliente, uma é Deno, uma é SQL —, então o que amarra as três é este arquivo.

  Ver docs/estrutura-de-pastas-dos-documentos.md.
*/

const raiz = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf-8');

/** Todo `.ts`/`.tsx` sob um diretório, recursivo. A lista de arquivos a
 *  conferir sai do repositório e não de uma enumeração à mão — é a terceira
 *  armadilha, e foi assim que uma edge function escapou da primeira versão
 *  deste teste. */
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

const HELPER  = 'src/lib/documentos.ts';
const ESPELHO = 'supabase/functions/drive-espelho/index.ts';

/** Os tipos que o banco aceita, lidos do `check` da migração que criou a
 *  tabela. Derivado e não listado: um quarto tipo numa migração nova faz este
 *  teste falhar, que é a terceira armadilha ("lista fixa que envelhece em
 *  silêncio") coberta pelo único caminho possível num teste offline. */
function tiposQueOBancoAceita(): string[] {
  const dir = join(raiz, 'supabase', 'migrations');
  const achados = new Set<string>();
  for (const arq of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, arq), 'utf-8');
    // Dentro do `create table ... documentos_fiscais`, e não em qualquer
    // `check (tipo in ...)` do repositório: `caixa_config` tem um também, e sem
    // o recorte o teste passou a exigir que o helper traduzisse "caixa".
    const bloco = sql.match(/create table[^;]*documentos_fiscais[^;]*;/is);
    if (!bloco) continue;
    // `tipo text not null check (tipo in ('ferramenta', 'servico', ...))`
    const m = bloco[0].match(/tipo\s+text[^\n]*check\s*\(\s*tipo\s+in\s*\(([^)]*)\)/i);
    if (!m) continue;
    for (const bruto of m[1].split(',')) {
      const t = bruto.trim().replace(/^'|'$/g, '');
      if (t) achados.add(t);
    }
  }
  return [...achados].sort();
}

describe('o caminho do documento fiscal é um só', () => {
  it('o helper monta empresa/competência/tipo/arquivo, nessa ordem', () => {
    expect(caminhoDoDocumento('alaskan', '2026-09', 'comprovante', 'nf.pdf'))
      .toBe('alaskan/2026-09/comprovantes/nf.pdf');
    expect(caminhoDoDocumento('aeliss', '2026-09-04', 'servico', 'x.pdf'))
      .toBe('aeliss/2026-09/servicos/x.pdf');
    expect(caminhoDoDocumento('alaskan', '2026-08', 'ferramenta', 'capcut.pdf'))
      .toBe('alaskan/2026-08/ferramentas/capcut.pdf');
  });

  it('recusa em vez de improvisar quando falta a empresa ou o tipo é estranho', () => {
    // Improvisar uma pasta "sem-empresa" é o que esconde a nota: ela só
    // apareceria quando a contabilidade reclamasse da que falta.
    expect(() => caminhoDoDocumento('', '2026-09', 'servico', 'x.pdf')).toThrow();
    expect(() => caminhoDoDocumento('  ', '2026-09', 'servico', 'x.pdf')).toThrow();
    expect(() => caminhoDoDocumento('alaskan', '2026-09', 'nota', 'x.pdf')).toThrow();
    expect(() => caminhoDoDocumento('alaskan', 'setembro', 'servico', 'x.pdf')).toThrow();
    expect(() => caminhoDoDocumento('alaskan', '', 'servico', 'x.pdf')).toThrow();
  });

  it('o helper traduz todos os tipos que o banco aceita, e só eles', () => {
    const doBanco = tiposQueOBancoAceita();
    expect(doBanco.length).toBeGreaterThan(0); // achou o check na migração

    for (const tipo of doBanco) {
      expect(
        () => caminhoDoDocumento('alaskan', '2026-09', tipo, 'x.pdf'),
        `tipo "${tipo}" existe no banco e o helper não sabe traduzir`,
      ).not.toThrow();
    }

    const traduzidos = [...ler(HELPER).matchAll(/^\s{2}(\w+):\s*'([\w-]+)',$/gm)]
      .map(m => m[1]).sort();
    expect(traduzidos, 'o mapa do helper tem tipo que o banco não aceita')
      .toEqual(doBanco);
  });

  it('o Drive usa as mesmas pastas que o Storage', () => {
    const noDrive = ler(ESPELHO);
    const tipos = tiposQueOBancoAceita();
    for (const tipo of tipos) {
      const pasta = caminhoDoDocumento('x', '2026-09', tipo, 'a').split('/')[2];
      expect(noDrive, `"${pasta}" não aparece em drive-espelho`).toContain(`'${pasta}'`);
    }
  });

  it('a empresa é o primeiro nível no Drive também', () => {
    const noDrive = ler(ESPELHO);
    // A cadeia é slug -> slug/mes -> slug/mes/pasta. Se alguém voltar a montar
    // `${pasta}/${mes}` a partir da raiz, o Drive e o Storage divergem de novo.
    expect(noDrive).toMatch(/garantirPasta\(\s*token,\s*slug,\s*DRIVE_PASTA_RAIZ\s*\)/);
    expect(noDrive).toContain('`${slug}/${mes}`');
    expect(noDrive).toContain('`${slug}/${mes}/${pasta}`');
    expect(noDrive).not.toMatch(/garantirPasta\(\s*token,\s*pasta,\s*DRIVE_PASTA_RAIZ\s*\)/);
  });

  it('o espelho lê o slug da empresa em todo select de documento', () => {
    const noDrive = ler(ESPELHO);
    // Captura o literal entre as aspas, não "até o primeiro `)`": o `)` de
    // `empresas(slug)` fecharia o grupo no meio e a asserção se auto-sabotava.
    const selects = [...noDrive.matchAll(/from\('documentos_fiscais'\)\s*\n?\s*\.select\('([^']*)'/g)]
      .map(m => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      // `update(...).eq(...)` não lê nada; os que leem precisam do slug, senão
      // a função cai na recusa "documento sem empresa" e não espelha nada.
      if (!s.includes('tipo')) continue;
      expect(s, 'select de documento sem empresas(slug)').toContain('empresas(slug)');
    }
  });

  /*
    Esta é a parte do teste que nasceu de um furo no próprio teste.

    A primeira versão olhava as duas telas React e mais nada, porque a busca que
    a precedeu procurou por `${pasta}/${competencia}` em `src/` e parou ali. Havia
    um TERCEIRO escritor de `storage_path`: `cs-comprovantes`, uma edge function,
    montando `comprovantes/${mes}/${nome}` na linha 174 — e um cron chamando ela
    às 10:30 e às 22:30 todo dia. A migração dos 212 teria começado a se desfazer
    pela beirada no mesmo dia em que foi feita, com o Storage voltando para a
    estrutura antiga e o Drive indo para a nova, em cada comprovante novo.

    Quem achou foi uma revisão adversarial, não eu. A lição que cabe num teste:
    **a varredura tem de cobrir todo lugar que escreve `storage_path`, e não os
    que eu lembro de ter escrito** — derivar a lista do repositório, não da
    memória, que é a terceira armadilha aplicada ao próprio teste.
  */
  it('todo lugar que escreve storage_path usa a estrutura com empresa', () => {
    const fontes = [
      ...varrer(join(raiz, 'src')),
      ...varrer(join(raiz, 'supabase', 'functions')),
    ];
    expect(fontes.length).toBeGreaterThan(50); // a varredura achou o repositório

    const escritores = fontes.filter(f => /storage_path\s*:/.test(ler(f)));
    expect(escritores.length, 'ninguém escreve storage_path — a varredura quebrou')
      .toBeGreaterThan(0);

    for (const f of escritores) {
      const src = ler(f);
      // Um template de caminho que começa pelo nome da pasta é a estrutura
      // antiga, em qualquer linguagem.
      expect(src, `${f} monta o caminho pela pasta, sem a empresa na frente`)
        .not.toMatch(/`(servicos|comprovantes|ferramentas)\/\$\{/);
      expect(src, `${f} monta o caminho pela pasta, sem a empresa na frente`)
        .not.toMatch(/`\$\{(pasta|tipo)\}\//);
    }
  });

  it('nenhuma tela monta o caminho à mão', () => {
    // Foi assim que as duas divergiram. O helper existe para ser o único.
    const telas = [
      'src/features/financeiro/pages/FinanceiroNotasFiscaisPage.tsx',
      'src/features/editores/components/NotasFiscaisTab.tsx',
    ];
    for (const tela of telas) {
      const src = ler(tela);
      expect(src, `${tela} não usa caminhoDoDocumento`).toContain('caminhoDoDocumento(');
      // Um template que começa pela pasta é a montagem antiga. A barra solta
      // depois de `${pasta}` basta, e é o que o teste precisa: exigir
      // `${competencia}` em seguida deixava passar o que estava lá de verdade,
      // `${pasta}/${competencia.slice(0, 7)}/${nome}`.
      expect(src, `${tela} ainda monta o caminho sozinha`)
        .not.toMatch(/`\$\{(pasta|tipo)\}\//);
      expect(src, `${tela} ainda monta o caminho sozinha`)
        .not.toMatch(/`(servicos|comprovantes|ferramentas)\/\$\{/);
    }
  });

  it('upload sem empresa é recusado nas duas telas', () => {
    // A segunda rede: o helper lança sem slug, mas a tela tem de avisar antes
    // de o arquivo subir, não depois.
    for (const tela of [
      'src/features/financeiro/pages/FinanceiroNotasFiscaisPage.tsx',
      'src/features/editores/components/NotasFiscaisTab.tsx',
    ]) {
      expect(ler(tela), `${tela} não recusa upload sem empresa`)
        .toMatch(/if\s*\(\s*!empresaId\s*\)/);
    }
  });
});
