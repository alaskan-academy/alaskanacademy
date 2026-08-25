import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

/**
 * Onde o mês está fugindo do padrão, por categoria.
 *
 * O previsto é a MEDIANA dos meses fechados, não a média: agosto teve R$ 12.000
 * antecipados para a reserva e o imposto veio dobrado; com média, esses sustos
 * contaminariam a expectativa de setembro. A mediana ignora o mês esquisito.
 *
 * O mês corrente nunca entra na base de cálculo — está incompleto por definição,
 * e incluí-lo faria a previsão perseguir o próprio rabo.
 *
 * Mora em Gastos, e não no Caixa: a pergunta aqui é "estou gastando mais do que
 * de costume, e em quê", que é decisão de corte, não de caixa.
 */

interface Previsao {
  categoria: string;
  previsto: number;
  realizado: number;
  meses_com_dados: number;
  minimo: number;
  maximo: number;
}

export function PrevistoRealizado({ ano, mes }: { ano: number; mes: number }) {
  const [previsoes, setPrevisoes] = useState<Previsao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const mesIso = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);

    supabase
      .rpc('fn_previsao_custos', { p_mes: mesIso, p_meses_base: 3 })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else setPrevisoes((data ?? []).map((x: Previsao) => ({
          ...x,
          previsto: Number(x.previsto),
          realizado: Number(x.realizado),
          minimo: Number(x.minimo),
          maximo: Number(x.maximo),
        })));
        setCarregando(false);
      });

    return () => { vivo = false; };
  }, [mesIso]);

  const linhas = previsoes.filter(p => p.previsto > 0 || p.realizado > 0);

  if (carregando) {
    return <Moldura><p className="text-sm text-muted-foreground text-center py-8">Carregando…</p></Moldura>;
  }
  if (erro) {
    return <Moldura><p className="text-sm text-red-400 text-center py-8">Não consegui carregar: {erro}</p></Moldura>;
  }
  if (linhas.length === 0) {
    return (
      <Moldura>
        <p className="text-sm text-muted-foreground text-center py-8">
          Ainda não há meses fechados suficientes para comparar este período.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Categoria</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">De costume</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Neste mês</th>
              <th className="text-right font-medium text-muted-foreground pb-2 pl-2 w-32">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(p => {
              const dif = p.realizado - p.previsto;
              // 15% de folga antes de gritar. Sem a faixa morta, "estourou"
              // apareceria em toda categoria que variasse um pouco e o alerta
              // perderia o sentido.
              const estourou = p.previsto > 0 && dif > p.previsto * 0.15;
              const magro = p.meses_com_dados < 2;
              return (
                <tr key={p.categoria} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-3">
                    <span className="text-foreground">{p.categoria}</span>
                    {magro && (
                      <span
                        className="ml-1.5 text-[11px] text-muted-foreground"
                        title={`Baseado em ${p.meses_com_dados} mês fechado — pouca base para confiar`}
                      >
                        (1 mês)
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {p.previsto ? formatCurrency(p.previsto) : '—'}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-foreground">
                    {p.realizado ? formatCurrency(p.realizado) : '—'}
                  </td>
                  <td className={cn(
                    'py-1.5 pl-2 text-right tabular-nums',
                    estourou ? 'text-red-400 font-medium' : dif < 0 ? 'text-muted-foreground' : 'text-foreground',
                  )}>
                    {p.previsto === 0 ? (
                      <span className="text-amber-400" title="Gasto novo: não havia base nos meses anteriores">
                        novo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 justify-end">
                        {estourou && <AlertTriangle className="h-3 w-3 shrink-0" />}
                        {dif >= 0 ? '+' : '−'}{formatCurrency(Math.abs(dif))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Fugiu do padrão
      </h2>
      <p className="text-xs text-muted-foreground/70 mb-4">
        "De costume" é a mediana dos três meses fechados anteriores — mediana e não média, para
        um mês atípico não contaminar a expectativa do seguinte.
      </p>
      {children}
    </div>
  );
}
