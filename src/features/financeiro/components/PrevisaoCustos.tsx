import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { AlertTriangle, CalendarClock, Check } from 'lucide-react';

/**
 * Quanto ainda deve sair este mês, e de onde.
 *
 * Duas perguntas, dois blocos:
 *
 *   1. Por categoria — previsto contra realizado. O previsto é a MEDIANA dos
 *      meses fechados, não a média: agosto teve R$ 12.000 antecipados para a
 *      reserva e o imposto veio dobrado; com média, esses sustos contaminariam
 *      a expectativa de setembro. A mediana ignora o mês esquisito.
 *
 *   2. Por lançamento — as recorrências que o extrato revela sozinho. Isto
 *      substitui a aba "Pagamentos" da planilha, que eram 24 linhas mantidas à
 *      mão. Os valores conferem com o que ela digitava: Google Workspace R$ 98
 *      no dia 1, VTurb R$ 297 no dia 10, Endereço Fiscal R$ 129,20 no dia 17.
 *
 * O mês corrente nunca entra na base da previsão — está incompleto por
 * definição, e incluí-lo faria a previsão perseguir o próprio rabo.
 */

interface Previsao {
  categoria: string;
  previsto: number;
  realizado: number;
  meses_com_dados: number;
  minimo: number;
  maximo: number;
}

interface Recorrencia {
  chave: string;
  descricao: string;
  categoria: string | null;
  valor_tipico: number;
  desvio: number;
  dia_tipico: number;
  meses_vistos: number;
  ja_saiu: boolean;
  valor_no_mes: number;
  data_no_mes: string | null;
}

/** Descritor de extrato é ruído legível: "EBN *CAPCUT CURITIBA BR" ou
 *  "60 063 431 JAQUELINE COELHO SILVA". Tira prefixo de adquirente, CPF
 *  mascarado, praça e telefone para sobrar o nome que ela reconhece. */
function nomeLimpo(descricao: string): string {
  const limpo = descricao
    .replace(/^(DM\*|PG\*|PAG\*|EC\*|MP\*|ASA\*|IG\*|EBN\s+\*?)/i, '')
    .replace(/^[\d\s.\-*]{6,}/, '')
    .replace(/\s+\+?\d[\d\s]*[A-Z]{2}\s*$/i, '')
    .replace(/\s+(SAO PAULO|CURITIBA|CUIABA|GUARATUBA|BARUERI|OSASCO)\s+[A-Z]{2}\s*$/i, '')
    .replace(/\s+[A-Z]{2}\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return limpo || descricao;
}

export function PrevisaoCustos({ ano, mes }: { ano: number; mes: number }) {
  const [previsoes, setPrevisoes] = useState<Previsao[]>([]);
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const mesIso = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);

    Promise.all([
      supabase.rpc('fn_previsao_custos', { p_mes: mesIso, p_meses_base: 3 }),
      supabase.rpc('fn_recorrencias', { p_mes: mesIso, p_meses_base: 6, p_min_meses: 3 }),
    ]).then(([p, r]) => {
      if (!vivo) return;
      const falha = p.error ?? r.error;
      if (falha) setErro(falha.message);
      else {
        setPrevisoes((p.data ?? []).map((x: Previsao) => ({
          ...x,
          previsto: Number(x.previsto),
          realizado: Number(x.realizado),
          minimo: Number(x.minimo),
          maximo: Number(x.maximo),
        })));
        setRecorrencias((r.data ?? []).map((x: Recorrencia) => ({
          ...x,
          valor_tipico: Number(x.valor_tipico),
          desvio: Number(x.desvio),
          valor_no_mes: Number(x.valor_no_mes),
        })));
      }
      setCarregando(false);
    });

    return () => { vivo = false; };
  }, [mesIso]);

  const resumo = useMemo(() => {
    const previsto = previsoes.reduce((a, p) => a + p.previsto, 0);
    const realizado = previsoes.reduce((a, p) => a + p.realizado, 0);
    const pendentes = recorrencias.filter(r => !r.ja_saiu);
    return {
      previsto,
      realizado,
      // Só o que resta das recorrências conhecidas. Nunca `previsto - realizado`:
      // essa conta vira negativa assim que o mês estoura a previsão e passa a
      // dizer "faltam sair menos vinte mil reais", que não quer dizer nada.
      aSair: pendentes.reduce((a, r) => a + r.valor_tipico, 0),
      pendentes,
    };
  }, [previsoes, recorrencias]);

  const hoje = new Date();
  const mesCorrente = hoje.getFullYear() === ano && hoje.getMonth() === mes;
  const diaHoje = hoje.getDate();

  if (carregando) {
    return <Moldura><p className="text-sm text-muted-foreground text-center py-8">Carregando…</p></Moldura>;
  }
  if (erro) {
    return <Moldura><p className="text-sm text-red-400 text-center py-8">Não consegui carregar: {erro}</p></Moldura>;
  }
  if (previsoes.length === 0 && recorrencias.length === 0) {
    return (
      <Moldura>
        <p className="text-sm text-muted-foreground text-center py-8">
          Ainda não há meses fechados suficientes para projetar este período.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura>
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Numero rotulo="Previsto no mês" valor={resumo.previsto} />
        <Numero
          rotulo="Já saiu"
          valor={resumo.realizado}
          cor={resumo.realizado > resumo.previsto ? 'text-red-400' : 'text-foreground'}
        />
        {/* Nomeia o que de fato está sendo contado. Como "Ainda deve sair", o
            número parecia a diferença entre os dois cards ao lado e não fechava
            com eles: em agosto dava R$ 522,30 ao lado de um mês que já tinha
            estourado a previsão em R$ 30 mil. São só as recorrências que ainda
            não caíram — nada sobre o resto. */}
        <Numero
          rotulo={
            resumo.pendentes.length
              ? `${resumo.pendentes.length} recorrências a vencer`
              : 'Recorrências a vencer'
          }
          valor={resumo.aSair}
          cor="text-amber-400"
        />
      </div>

      {/* Por categoria */}
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Categoria</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Previsto</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Já saiu</th>
              <th className="text-right font-medium text-muted-foreground pb-2 pl-2 w-32">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {previsoes.filter(p => p.previsto > 0 || p.realizado > 0).map(p => {
              const dif = p.realizado - p.previsto;
              // 15% de folga antes de gritar. Sem a faixa morta, "estourou" apareceria
              // em toda categoria que variasse um pouco e o alerta perderia o sentido.
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
                      <span className="text-amber-400" title="Gasto novo: não havia base nos meses anteriores">novo</span>
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

      {/* Recorrências */}
      {recorrencias.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Custos que se repetem
          </h3>
          <p className="text-xs text-muted-foreground/70 mb-3">
            Detectados no extrato dos últimos 6 meses. Valor típico é a mediana; o dia é o
            mais frequente.
          </p>
          {/* Lista, não tabela. Em tabela de 4 colunas os nomes longos —
              "GOOGLE WORKSPACE_ACADEMYA", "JESSICA MAIHATO CANDIDO" — quebravam
              em duas linhas e empurravam o status para fora da largura útil,
              que aqui é de uns 560px. Com o nome em cima e os números embaixo,
              cabe sem cortar e sem rolagem lateral. */}
          <ul className="space-y-0">
            {recorrencias.map(r => {
              const atrasado = mesCorrente && !r.ja_saiu && r.dia_tipico < diaHoje;
              const fixo = r.desvio < r.valor_tipico * 0.05;
              return (
                <li
                  key={r.chave}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/50 py-2 last:border-0"
                >
                  <span className="text-foreground min-w-0 flex-1 truncate" title={r.descricao}>
                    {nomeLimpo(r.descricao)}
                  </span>

                  <span className="tabular-nums whitespace-nowrap text-foreground">
                    {formatCurrency(r.valor_tipico)}
                    {!fixo && (
                      <span
                        className="ml-0.5 text-muted-foreground"
                        title={`Varia entre os meses — desvio de ${formatCurrency(r.desvio)}`}
                      >
                        ~
                      </span>
                    )}
                  </span>

                  <span className="w-14 shrink-0 text-right text-xs text-muted-foreground whitespace-nowrap">
                    dia {r.dia_tipico}
                  </span>

                  <span className="w-24 shrink-0 text-right whitespace-nowrap">
                    {r.ja_saiu ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-green-400"
                        title={`Saiu ${r.data_no_mes ? `em ${r.data_no_mes.split('-').reverse().join('/')}` : 'neste mês'}`}
                      >
                        <Check className="h-3 w-3 shrink-0" />
                        {formatCurrency(r.valor_no_mes)}
                      </span>
                    ) : atrasado ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs text-amber-400"
                        title="Costuma cair antes de hoje e ainda não apareceu no extrato"
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        não veio
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarClock className="h-3 w-3 shrink-0" />
                        previsto
                      </span>
                    )}
                  </span>

                  {r.categoria && (
                    <span className="w-full text-[11px] text-muted-foreground/70">{r.categoria}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Previsibilidade dos custos
      </h2>
      {children}
    </div>
  );
}

function Numero({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div className="bg-muted/30 rounded-md px-3 py-2.5">
      <div className="text-xs text-muted-foreground mb-1 min-h-[2rem]">{rotulo}</div>
      <div className={cn('text-lg font-bold tabular-nums whitespace-nowrap', cor ?? 'text-foreground')}>
        {formatCurrency(valor)}
      </div>
    </div>
  );
}
