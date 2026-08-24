import { useEffect, useMemo, useState } from 'react';
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
      .select('mes, categoria, gasto, lancamentos')
      .gte('mes', inicioIso)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else setLinhas((data ?? []) as LinhaView[]);
        setCarregando(false);
      });

    return () => { vivo = false; };
  }, [meses]);

  const { colunas, matriz, totalGeral } = useMemo(() => {
    const cols = Array.from(new Set(linhas.map(l => l.mes))).sort();

    const porCategoria = new Map<string, Map<string, number>>();
    for (const l of linhas) {
      if (!porCategoria.has(l.categoria)) porCategoria.set(l.categoria, new Map());
      porCategoria.get(l.categoria)!.set(l.mes, Number(l.gasto));
    }

    const mat = Array.from(porCategoria.entries())
      .map(([categoria, porMes]) => {
        const valores = cols.map(c => porMes.get(c) ?? 0);
        return {
          categoria,
          valores,
          total: valores.reduce((a, b) => a + b, 0),
          pico: Math.max(...valores),
        };
      })
      .sort((a, b) => b.total - a.total);

    return {
      colunas: cols,
      matriz: mat,
      totalGeral: mat.reduce((a, m) => a + m.total, 0),
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

  if (matriz.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-5">
        <Titulo />
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum custo lançado nos últimos {meses} meses.
        </p>
      </div>
    );
  }

  const totaisPorMes = colunas.map((_, i) => matriz.reduce((a, m) => a + m.valores[i], 0));

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <Titulo />
      {/* A matriz cresce com o número de meses; o scroll fica nela para a
          página nunca rolar de lado. */}
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Categoria</th>
              {colunas.map(c => (
                <th key={c} className="text-right font-medium text-muted-foreground pb-2 px-2 whitespace-nowrap">
                  {rotuloMes(c)}
                </th>
              ))}
              <th className="text-right font-medium text-muted-foreground pb-2 pl-3 whitespace-nowrap">Total</th>
              <th className="pb-2 pl-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {matriz.map(linha => {
              const fatia = totalGeral > 0 ? (linha.total / totalGeral) * 100 : 0;
              return (
                <tr key={linha.categoria} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-3 text-foreground">{linha.categoria}</td>
                  {linha.valores.map((v, i) => (
                    <td
                      key={colunas[i]}
                      title={v ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'sem lançamento'}
                      className={cn(
                        'py-1.5 px-2 text-right tabular-nums',
                        v ? 'text-foreground' : 'text-muted-foreground/40',
                      )}
                      style={
                        // Intensidade relativa ao pico da própria linha: mostra o
                        // mês em que a categoria fugiu do padrão dela mesma.
                        v && linha.pico > 0
                          ? { backgroundColor: `rgb(248 113 113 / ${(v / linha.pico) * 0.13})` }
                          : undefined
                      }
                    >
                      {num(v)}
                    </td>
                  ))}
                  <td className="py-1.5 pl-3 text-right tabular-nums font-medium text-foreground">
                    {num(linha.total)}
                  </td>
                  <td className="py-1.5 pl-2">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-red-400/70" style={{ width: `${fatia}%` }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">
                        {fatia.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
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

function Titulo() {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Onde estão os custos
      </h2>
      <p className="text-xs text-muted-foreground/70 mt-0.5">
        Valores em reais, sem centavos. Sócios e reserva de caixa ficam de fora — são
        movimentação, não custo.
      </p>
    </div>
  );
}
