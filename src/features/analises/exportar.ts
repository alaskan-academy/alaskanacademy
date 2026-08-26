import { supabase } from '@/lib/supabase';
import { MetricasDoRev } from './metricas';
import { RetencaoVsl } from './retencao';
import { formatarData } from './periodo';

/**
 * Espelha a rodada no Obsidian e numa planilha, a cada salvar.
 *
 * Disparar no salvar só é possível porque as duas pontas SOBRESCREVEM: o
 * Obsidian recebe `PUT` no mesmo caminho e o Sheets reescreve as abas inteiras.
 * Salvar vinte vezes deixa o mesmo resultado de salvar uma. Se qualquer das
 * duas passasse a acrescentar, viraria vinte cópias da mesma análise — que é o
 * defeito clássico de exportação automática.
 *
 * As duas são ACESSÓRIAS e falham em silêncio de propósito: o Obsidian roda na
 * máquina de quem está usando e pode simplesmente não estar aberto. A análise
 * não pode depender delas, e um toast de erro a cada tecla seria pior que a
 * falta da exportação.
 */

const OBSIDIAN = 'http://127.0.0.1:27123';
const PASTA = 'Análises Alaskan';

export interface AcaoParaExportar {
  texto: string;
  expectativa: string | null;
  feita: boolean;
  feita_em: string | null;
  feita_por_nome: string | null;
}

export interface RodadaParaExportar {
  dataRodada: string;
  projeto: string | null;
  rev: string;
  metodo: string | null;
  metricas: MetricasDoRev | null;
  retencao: RetencaoVsl | null;
  leitura: string;
  acoes: AcaoParaExportar[];
}

const slug = (s: string) => s
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);

const brl = (v: number | null | undefined) => v == null ? '—'
  : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null | undefined, casas = 2) => v == null ? '—' : `${v.toFixed(casas)}%`;
const num = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('pt-BR');

/** Markdown da rodada, no formato que o Obsidian lê como nota. */
export function montarNota(r: RodadaParaExportar): string {
  const a = r.metricas?.atual;
  const ant = r.metricas?.anterior;
  const janela = r.metricas?.inicio && r.metricas?.fim
    ? `${formatarData(r.metricas.inicio)} a ${formatarData(r.metricas.fim)}`
    : '';

  // Frontmatter com os números que valem filtro e gráfico no Obsidian. Texto
  // longo fica no corpo: frontmatter com parágrafo dentro quebra o parser.
  const fm = [
    '---',
    `rev: "${r.rev}"`,
    `projeto: "${r.projeto ?? ''}"`,
    `metodo: ${r.metodo ?? ''}`,
    `data: ${r.dataRodada}`,
    `periodo: "${janela}"`,
    `investimento: ${a?.investimento ?? ''}`,
    `faturamento: ${a?.faturamento ?? ''}`,
    `roas: ${a?.roas ?? ''}`,
    `roas_com_upsell: ${a?.roas_com_upsell ?? ''}`,
    `lucro: ${a?.lucro_liquido ?? ''}`,
    `lucro_com_upsell: ${a?.lucro_com_upsell ?? ''}`,
    `front_se_paga: ${a?.front_se_paga ?? ''}`,
    'tags: [analise, alaskan]',
    '---',
  ].join('\n');

  const linha = (rot: string, agora: string, antes: string) => `| ${rot} | ${agora} | ${antes} |`;

  const corpo: string[] = [
    `# ${r.projeto ? `${r.projeto} · ` : ''}${r.rev}`,
    '',
    `Rodada de ${formatarData(r.dataRodada)}${janela ? ` · período ${janela}` : ''}`,
    '',
  ];

  if (a && ant) {
    // A frase que a tela diz sozinha vai junto: sem ela a nota é só uma tabela,
    // e a leitura de "o front se paga?" teria que ser refeita de cabeça.
    if (a.front_se_paga != null) {
      corpo.push(a.front_se_paga
        ? `> ✅ **O front se paga.** O upsell aqui é lucro em cima — ROAS ${a.roas?.toFixed(2)} vira ${a.roas_com_upsell?.toFixed(2)}.`
        : `> ⚠️ **O front não se paga.** Quem sustenta este REV é o upsell — ROAS ${a.roas?.toFixed(2)} sobe para ${a.roas_com_upsell?.toFixed(2)}.`);
      corpo.push('');
    }

    corpo.push('## Resultado', '', '| | Agora | Anterior |', '|---|---:|---:|',
      linha('Investimento', brl(a.investimento), brl(ant.investimento)),
      linha('Faturamento', brl(a.faturamento), brl(ant.faturamento)),
      linha('Resultado', brl(a.resultado), brl(ant.resultado)),
      linha('Vendas', num(a.vendas), num(ant.vendas)),
      linha('ROAS', a.roas?.toFixed(2) ?? '—', ant.roas?.toFixed(2) ?? '—'),
      linha('Imposto', brl(a.imposto_simples + a.imposto_meta), brl(ant.imposto_simples + ant.imposto_meta)),
      linha('Taxa da plataforma', brl(a.taxa_plataforma), brl(ant.taxa_plataforma)),
      linha('Lucro líquido', brl(a.lucro_liquido), brl(ant.lucro_liquido)),
      linha('Margem', pct(a.margem_pct, 1), pct(ant.margem_pct, 1)),
      '');

    if (a.upsell_qtd > 0 || ant.upsell_qtd > 0) {
      corpo.push('## Com upsell', '',
        '_Assinatura anual: é caixa que entrou, não receita recorrente do período._', '',
        '| | Agora | Anterior |', '|---|---:|---:|',
        linha('Adesão ao upsell', pct(a.upsell_adesao_pct), pct(ant.upsell_adesao_pct)),
        linha('Faturamento do upsell', brl(a.upsell_faturamento), brl(ant.upsell_faturamento)),
        linha('ROAS com upsell', a.roas_com_upsell?.toFixed(2) ?? '—', ant.roas_com_upsell?.toFixed(2) ?? '—'),
        linha('Lucro com upsell', brl(a.lucro_com_upsell), brl(ant.lucro_com_upsell)),
        '');
    }

    if ((a.itens ?? []).length > 0) {
      corpo.push('## Ofertas', '', '| Oferta | Adesão | Valor | Qtd |', '|---|---:|---:|---:|',
        `| **Oferta principal** | — | ${brl(a.oferta_principal_valor)} | ${num(a.oferta_principal_qtd)} |`,
        ...a.itens.map(i => `| ${i.nome} | ${pct(i.adesao_pct)} | ${brl(i.faturamento)} | ${num(i.qtd)} |`),
        '');
    }

    corpo.push('## Funil', '', '| Etapa | Custo | Quantidade | Taxa |', '|---|---:|---:|---:|',
      `| Cliques no link | ${brl(a.cpc)} | ${num(a.cliques)} | — |`,
      `| Checkouts iniciados | ${brl(a.cpi)} | ${num(a.checkouts_iniciados)} | ${pct(a.taxa_checkout_pct)} |`,
      `| Vendas | ${brl(a.cpa)} | ${num(a.vendas)} | ${pct(a.conv_checkout_pct)} |`,
      `| Conversão do funil | — | — | ${pct(a.conv_funil_pct)} |`,
      '',
      '## Por visitante', '', '| | Agora | Anterior |', '|---|---:|---:|',
      linha('CPV', brl(a.cpv), brl(ant.cpv)),
      linha('EPC', brl(a.epc), brl(ant.epc)),
      linha('EPC − CPV', brl(a.epc_menos_cpv), brl(ant.epc_menos_cpv)),
      linha('AOV', brl(a.aov), brl(ant.aov)),
      '');
  }

  if (r.retencao) {
    const t = r.retencao;
    corpo.push('## Retenção da VSL', '',
      t.nome ? `_${t.nome}_` : '', '',
      '| Marco | Retenção |', '|---|---:|',
      `| Play Rate | ${pct(t.play_rate_pct, 1)} |`,
      `| 1 minuto | ${pct(t.um_minuto_pct, 1)} |`,
      `| Fim da lead | ${pct(t.fim_da_lead_pct, 1)} |`,
      `| Pitch | ${pct(t.pitch_pct, 1)} |`,
      `| Final da VSL | ${pct(t.final_pct, 1)} |`,
      '');
  }

  if (r.leitura.trim()) {
    // `==destaque==` é o formato que ela já usa nos PDFs do Obsidian.
    corpo.push('## O que eu leio nisso', '', `==${r.leitura.trim()}==`, '');
  }

  if (r.acoes.length > 0) {
    corpo.push('## Ações', '');
    for (const ac of r.acoes) {
      // Checkbox de markdown: o Obsidian marca e desmarca nativamente, então a
      // nota continua útil mesmo lida fora do dashboard.
      corpo.push(`- [${ac.feita ? 'x' : ' '}] ${ac.texto}`);
      if (ac.expectativa) corpo.push(`    - 🎯 ${ac.expectativa}`);
      if (ac.feita && ac.feita_em) {
        const q = new Date(ac.feita_em).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        corpo.push(`    - ✅ feita em ${q}${ac.feita_por_nome ? ` por ${ac.feita_por_nome}` : ''}`);
      }
    }
    corpo.push('');
  }

  return `${fm}\n\n${corpo.join('\n')}`;
}

/**
 * Manda a nota para o Obsidian local.
 *
 * `PUT` no mesmo caminho sobrescreve — é o que torna seguro chamar a cada
 * salvar. O caminho é derivado da data e do REV, nunca de um id: assim a nota
 * tem nome legível no vault e continua a mesma entre salvamentos.
 */
async function paraObsidian(r: RodadaParaExportar, chave: string): Promise<void> {
  const nome = slug(`${r.projeto ?? ''} ${r.rev}`) || 'rev';
  const caminho = `${PASTA}/${r.dataRodada}/${nome}.md`;

  const res = await fetch(`${OBSIDIAN}/vault/${encodeURIComponent(caminho)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'text/markdown' },
    body: montarNota(r),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Obsidian respondeu ${res.status}`);
}

async function chaveDoObsidian(): Promise<string | null> {
  const { data } = await supabase
    .from('configuracoes_texto').select('valor')
    .eq('chave', 'obsidian_api_key').maybeSingle();
  return (data?.valor ?? '').trim() || null;
}

/** Como cada ponta terminou. A tela usa para dizer o que ficou de fora. */
export interface ResultadoEspelho {
  obsidian: 'ok' | 'fora' | 'sem-chave';
  sheets: 'ok' | 'pulado' | 'erro';
}

/**
 * Dispara as duas exportações e esquece.
 *
 * Nunca lança: o `void` do chamador não teria onde tratar, e uma exportação que
 * derruba o salvamento seria pior que exportação nenhuma.
 */
export function exportarRodada(
  r: RodadaParaExportar, aoTerminar?: (res: ResultadoEspelho) => void,
): void {
  exportarVarias([r], aoTerminar);
}

/**
 * Espelha uma ou várias rodadas, e conta como cada ponta terminou.
 *
 * As duas em paralelo e com `allSettled`: o Obsidian fora do ar não pode
 * impedir a planilha de atualizar, nem o contrário.
 *
 * O RESULTADO importa. Antes disto as duas falhavam em silêncio absoluto, e
 * com o Obsidian fechado dava para percorrer uma rodada inteira sem nenhuma
 * nota ser escrita e sem nada na tela dizendo isso. Silêncio serve para não
 * atrapalhar; não serve para esconder.
 *
 * Nada se perde de verdade: a nota é derivada do banco, então basta reenviar
 * quando o Obsidian voltar — é o que `reenviarTudoParaObsidian` faz.
 */
export function exportarVarias(
  rodadas: RodadaParaExportar[], aoTerminar?: (res: ResultadoEspelho) => void,
): void {
  void (async () => {
    const chave = await chaveDoObsidian();

    const [obs, sheets] = await Promise.allSettled([
      chave
        ? Promise.all(rodadas.map(r => paraObsidian(r, chave)))
        : Promise.reject(new Error('sem chave')),
      supabase.functions.invoke('analises-sheets-sync', { body: {} }),
    ]);

    aoTerminar?.({
      obsidian: obs.status === 'fulfilled' ? 'ok' : chave ? 'fora' : 'sem-chave',
      sheets: sheets.status !== 'fulfilled' ? 'erro'
        : (sheets.value.data as { pulado?: boolean; erro?: string })?.pulado ? 'pulado'
        : (sheets.value.data as { erro?: string })?.erro ? 'erro'
        : 'ok',
    });
  })().catch(() => { /* acessório: segue o jogo */ });
}

/**
 * Reescreve TODAS as notas do Obsidian a partir do banco.
 *
 * É o que transforma "o Obsidian estava fechado" de perda em atraso. A nota
 * nunca foi a fonte — é um retrato do que está em `analise_itens`, então dá
 * para refazê-la inteira a qualquer momento sem consultar nada além do banco.
 */
export async function reenviarTudoParaObsidian(): Promise<{ notas: number }> {
  const chave = await chaveDoObsidian();
  if (!chave) throw new Error('Chave do Obsidian não configurada.');

  const [{ data: rodadas }, { data: acoes }, { data: revs }, { data: metodos }] = await Promise.all([
    supabase.from('analises')
      .select('id,data,analise_itens(funil_id,leitura,metricas,retencao)')
      .order('data', { ascending: false }),
    supabase.from('analise_acoes')
      .select('funil_id,analise_id,texto,expectativa,feita,feita_em,perfis:feita_por(nome)')
      .order('criada_em'),
    supabase.from('vw_mapa_revs').select('id,rev,projeto'),
    supabase.from('funis').select('id,metodo'),
  ]);

  const metodoPor = Object.fromEntries(
    ((metodos ?? []) as Array<{ id: string; metodo: string | null }>).map(f => [f.id, f.metodo]));
  const revPor = Object.fromEntries(
    ((revs ?? []) as Array<{ id: string; rev: string; projeto: string | null }>).map(r => [r.id, r]));

  type LinhaAcao = {
    funil_id: string; analise_id: string | null; texto: string;
    expectativa: string | null; feita: boolean; feita_em: string | null;
    perfis: { nome: string | null } | { nome: string | null }[] | null;
  };
  const todasAcoes = (acoes ?? []) as unknown as LinhaAcao[];

  let notas = 0;
  for (const rodada of (rodadas ?? []) as unknown as Array<{
    id: string; data: string;
    analise_itens: Array<{
      funil_id: string; leitura: string | null;
      metricas: MetricasDoRev | null; retencao: RetencaoVsl | null;
    }>;
  }>) {
    const daRodada = todasAcoes.filter(a => a.analise_id === rodada.id);
    const ids = [...new Set([
      ...rodada.analise_itens.map(i => i.funil_id),
      ...daRodada.map(a => a.funil_id),
    ])];

    for (const funilId of ids) {
      const rev = revPor[funilId];
      if (!rev) continue;
      const item = rodada.analise_itens.find(i => i.funil_id === funilId) ?? null;
      await paraObsidian({
        dataRodada: rodada.data,
        projeto: rev.projeto, rev: rev.rev, metodo: metodoPor[funilId] ?? null,
        metricas: item?.metricas ?? null,
        retencao: item?.retencao ?? null,
        leitura: item?.leitura ?? '',
        acoes: daRodada.filter(a => a.funil_id === funilId).map(a => ({
          texto: a.texto, expectativa: a.expectativa, feita: a.feita,
          feita_em: a.feita_em,
          feita_por_nome: (Array.isArray(a.perfis) ? a.perfis[0] : a.perfis)?.nome ?? null,
        })),
      }, chave);
      notas++;
    }
  }

  return { notas };
}
