import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/**
 * Onde o dinheiro sai, mês a mês.
 *
 * É a aba "Dashboard" da planilha "Fluxo de Caixa Alaskan 2026" — categoria nas
 * linhas, mês nas colunas — só que lida do extrato em vez de digitada. Os
 * números conferem: janeiro fechou R$ 55.640,27 de saída na planilha e no banco,
 * fevereiro R$ 81.875,02 nos dois.
 *
 * Duas leituras no mesmo quadro, de propósito:
 *   - a coluna "Total" com a barra responde "qual categoria pesa mais";
 *   - o sombreado dentro da linha responde "em que mês esta categoria disparou".
 * Uma escala só não daria as duas: normalizada pelo geral, tudo que não é
 * Anúncios vira uma faixa cinza uniforme e some.
 */

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface LinhaView {
  mes: string;
  centro_custo: string;
  categoria: string;
  gasto: number;
  lancamentos: number;
}

/** Sem "R$" e sem centavos: numa matriz de 7 colunas o prefixo repetido rouba a
 *  largura que os dígitos precisam, e o centavo não muda nenhuma decisão. */
function num(v: number): string {
  if (!v) return '—';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split('-');
  return `${MESES_CURTOS[Number(mes) - 1]}/${ano.slice(2)}`;
}

export function MapaCustos({ meses = 6 }: { meses?: number }) {
  const [linhas, setLinhas] = useState<LinhaView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
    const inicioIso = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`;

    supabase
      .from('vw_custos_categoria_mes')
      .select('mes, centro_custo, categoria, gasto, lancamentos')
      .gte('mes', inicioIso)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else setLinhas((data ?? []) as LinhaView[]);
        setCarregando(false);
      });

    return () => { vivo = false; };
  }, [meses]);

  const { colunas, grupos, totalGeral } = useMemo(() => {
    const cols = Array.from(new Set(linhas.map(l => l.mes))).sort();

    /** Soma por chave e devolve a série alinhada com `cols`. */
    const serie = (mapa: Map<string, number>) => {
      const valores = cols.map(c => mapa.get(c) ?? 0);
      return { valores, total: valores.reduce((a, b) => a + b, 0), pico: Math.max(...valores, 0) };
    };

    // Centro de custo é o nível que a Conta Simples preenche e que o DRE soma;
    // a categoria mora dentro dele. Duas Maps em vez de uma estrutura aninhada
    // porque a soma do centro tem de contar TODOS os lançamentos dele, e não
    // apenas os que caíram numa categoria conhecida.
    const porCentro = new Map<string, Map<string, number>>();
    const porCentroCategoria = new Map<string, Map<string, Map<string, number>>>();

    for (const l of linhas) {
      const gasto = Number(l.gasto);

      if (!porCentro.has(l.centro_custo)) porCentro.set(l.centro_custo, new Map());
      const mCentro = porCentro.get(l.centro_custo)!;
      mCentro.set(l.mes, (mCentro.get(l.mes) ?? 0) + gasto);

      if (!porCentroCategoria.has(l.centro_custo)) porCentroCategoria.set(l.centro_custo, new Map());
      const cats = porCentroCategoria.get(l.centro_custo)!;
      if (!cats.has(l.categoria)) cats.set(l.categoria, new Map());
      const mCat = cats.get(l.categoria)!;
      mCat.set(l.mes, (mCat.get(l.mes) ?? 0) + gasto);
    }

    const gs = Array.from(porCentro.entries())
      .map(([centro, mapa]) => ({
        centro,
        ...serie(mapa),
        categorias: Array.from(porCentroCategoria.get(centro)!.entries())
          .map(([categoria, m]) => ({ categoria, ...serie(m) }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      colunas: cols,
      grupos: gs,
      totalGeral: gs.reduce((a, g) => a + g.total, 0),
    };
  }, [linhas]);

  if (carregando) {
    return (
      <div className="bg-card border border-border rounded-lg p-5">
        <Titulo />
        <p className="text-sm text-muted-foreground text-center py-8">Carregando…</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="bg-card border border-border rounded-lg p-5">
        <Titulo />
        <p className="text-sm text-red-400 text-center py-8">Não consegui carregar: {erro}</p>
      </div>
    );
  }

  if (grupos.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-5">
        <Titulo />
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum custo lançado nos últimos {meses} meses.
        </p>
      </div>
    );
  }

  const totaisPorMes = colunas.map((_, i) => grupos.reduce((a, g) => a + g.valores[i], 0));

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <Titulo />
      {/* A matriz cresce com o número de meses; o scroll fica nela para a
          página nunca rolar de lado. */}
      <div className="overflow-x-auto -mx-5 px-5">
        {/* `table-fixed` com a primeira coluna presa: sem isso a coluna de nomes
            ficava com o que sobrasse (~120px) e "Aplicativos e Ferramentas"
            quebrava em três linhas. Cada linha ganhava uma altura e a tabela
            virava um serrilhado impossível de percorrer com o olho. */}
        <table className="w-full min-w-[780px] table-fixed text-sm">
          <colgroup>
            <col className="w-[210px]" />
            {colunas.map(c => <col key={c} className="w-[68px]" />)}
            <col className="w-[80px]" />
            <col className="w-[84px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Centro de custo</th>
              {colunas.map(c => (
                <th key={c} className="text-right font-medium text-muted-foreground pb-2 px-2 whitespace-nowrap">
                  {rotuloMes(c)}
                </th>
              ))}
              <th className="text-right font-medium text-muted-foreground pb-2 pl-3 whitespace-nowrap">Total</th>
              <th className="pb-2 pl-2" />
            </tr>
          </thead>
          <tbody>
            {grupos.map(g => (
              <Fragment key={g.centro}>
                <tr className="border-t border-border/70">
                  <td className="pt-2.5 pb-1 pr-3 font-medium text-foreground">{g.centro}</td>
                  {g.valores.map((v, i) => (
                    <Celula key={colunas[i]} valor={v} pico={g.pico} forte />
                  ))}
                  <td className="pt-2.5 pb-1 pl-3 text-right tabular-nums font-semibold text-foreground">
                    {num(g.total)}
                  </td>
                  <td className="pt-2.5 pb-1 pl-2">
                    <Fatia valor={g.total} total={totalGeral} />
                  </td>
                </tr>

                {/* A categoria só ganha linha própria quando o centro tem mais de
                    uma. "Anúncios" com uma categoria só repetiria os mesmos
                    números duas vezes seguidas e não diria nada. */}
                {g.categorias.length > 1 && g.categorias.map(c => (
                  <tr key={c.categoria}>
                    <td className="py-1 pl-4 pr-3 text-muted-foreground">{c.categoria}</td>
                    {c.valores.map((v, i) => (
                      <Celula key={colunas[i]} valor={v} pico={c.pico} />
                    ))}
                    <td className="py-1 pl-3 text-right tabular-nums text-muted-foreground">
                      {num(c.total)}
                    </td>
                    <td />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="pt-2 pr-3">Total</td>
              {totaisPorMes.map((t, i) => (
                <td key={colunas[i]} className="pt-2 px-2 text-right tabular-nums">{num(t)}</td>
              ))}
              <td className="pt-2 pl-3 text-right tabular-nums">{num(totalGeral)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Celula({ valor, pico, forte }: { valor: number; pico: number; forte?: boolean }) {
  return (
    <td
      title={valor ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'sem lançamento'}
      className={cn(
        'px-2 text-right tabular-nums',
        forte ? 'pt-2.5 pb-1 font-medium' : 'py-1',
        valor ? (forte ? 'text-foreground' : 'text-muted-foreground') : 'text-muted-foreground/40',
      )}
      style={
        // Intensidade relativa ao pico da PRÓPRIA linha: mostra o mês em que
        // aquela linha fugiu do padrão dela mesma. Normalizado pelo total geral,
        // tudo que não é Anúncios viraria uma faixa cinza uniforme.
        valor && pico > 0
          ? { backgroundColor: `rgb(248 113 113 / ${(valor / pico) * (forte ? 0.13 : 0.07)})` }
          : undefined
      }
    >
      {num(valor)}
    </td>
  );
}

function Fatia({ valor, total }: { valor: number; total: number }) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-red-400/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function Titulo() {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Onde estão os custos
      </h2>
      <p className="text-xs text-muted-foreground/70 mt-0.5">
        Centro de custo vem da Conta Simples; a categoria é o detalhe dentro dele. Valores
        em reais, sem centavos. Sócios e reserva ficam de fora — são movimentação, não custo.
      </p>
    </div>
  );
}
