import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Onde uma categoria confirmada discorda da Conta Simples.
 *
 * "Confirmado" é intocável pela recategorização, e isso é certo — o que passou
 * por olho humano não deve ser sobrescrito por regra. O efeito colateral é que
 * um erro confirmado fica congelado e invisível: as 682 transações de dezembro
 * a junho nunca passaram pela lógica nova, e ninguém saberia se alguma estava
 * errada.
 *
 * Este bloco não corrige nada. Mostra a discordância para a decisão ser de quem
 * sabe — porque nem sempre o CS é o certo: as transferências ALASKAN ACADEMY
 * estão lá como "Retirada de Lucro" e são Reserva de Caixa.
 */

interface Divergencia {
  id: string;
  data: string;
  fornecedor: string;
  valor: number;
  categoria_dash: string;
  categoria_cs: string;
}

interface Grupo {
  de: string;
  para: string;
  n: number;
  total: number;
}

export function AvisoDivergencias() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    supabase
      .from('vw_divergencias_confirmadas')
      .select('categoria_dash, categoria_cs, valor')
      .then(({ data }) => {
        if (!vivo || !data) return;
        const mapa = new Map<string, Grupo>();
        for (const d of data as Divergencia[]) {
          const chave = `${d.categoria_dash} → ${d.categoria_cs}`;
          const g = mapa.get(chave) ?? { de: d.categoria_dash, para: d.categoria_cs, n: 0, total: 0 };
          g.n += 1;
          g.total += Math.abs(Number(d.valor));
          mapa.set(chave, g);
        }
        setGrupos(Array.from(mapa.values()).sort((a, b) => b.total - a.total));
      });
    return () => { vivo = false; };
  }, []);

  if (grupos.length === 0) return null;

  const totalLancamentos = grupos.reduce((a, g) => a + g.n, 0);

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <span className="flex-1 text-xs">
          <span className="font-medium text-amber-200">
            {totalLancamentos} {totalLancamentos === 1 ? 'transação confirmada discorda' : 'transações confirmadas discordam'} da Conta Simples
          </span>
          <span className="mt-0.5 block text-amber-200/70">
            Confirmado não é mais recategorizado, então um erro aqui fica congelado. Nem sempre o
            CS está certo — decida caso a caso.
          </span>
        </span>
        {aberto
          ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/70" />
          : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/70" />}
      </button>

      {aberto && (
        <ul className="mt-2.5 space-y-1 border-t border-amber-500/20 pt-2.5">
          {grupos.map(g => (
            <li key={`${g.de}-${g.para}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="text-amber-200/90">{g.de}</span>
              <span className="text-amber-200/50">→</span>
              <span className="text-amber-200/90">{g.para}</span>
              <span className="ml-auto tabular-nums text-amber-200/70 whitespace-nowrap">
                {g.n} · {formatCurrency(g.total)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
