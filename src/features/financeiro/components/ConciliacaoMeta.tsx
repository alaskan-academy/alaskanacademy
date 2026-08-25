import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

/**
 * O que saiu para a Meta contra o que a Meta diz ter gasto em campanha.
 *
 * Anúncios são 77% dos custos e chegam como um número só. Separar campanha de
 * automação de WhatsApp não sai do extrato: são 540 lançamentos
 * "FACEBK *<id aleatório>", sem MCC, com distribuição de valor contínua de
 * R$ 0,19 a R$ 5.275 — nem o descritor nem a faixa separam.
 *
 * Quem separa é a categorização que a Conta Simples já tem, e o resultado é
 * forte: em agosto, o que está marcado como campanha fecha com a Meta com
 * R$ 380 de resíduo sobre R$ 90 mil. Sem separar, a diferença era de 9,9%.
 *
 * O que a tela NÃO faz é dizer que o grupo sem categoria é o WhatsApp. Ele
 * começa em 21/07 e é o candidato óbvio, mas está sem categoria porque ninguém
 * categorizou — e maio e junho têm 13% a 18% de resíduo sem um único lançamento
 * nesse grupo. Correlação forte não é atribuição, e um rateio inventado entraria
 * no DRE parecendo apurado.
 */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface Linha {
  mes: string;
  ads_meta: number | null;
  marcado_campanha: number;
  sem_categoria_cs: number;
  saiu_banco: number | null;
  lancamentos: number | null;
  diferenca: number | null;
  residuo_campanha: number | null;
  pct_diferenca: number | null;
  mes_em_curso: boolean;
}

function rotulo(iso: string): string {
  const [ano, mes] = iso.split('-');
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}

export function ConciliacaoMeta({ meses = 6 }: { meses?: number }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
    const inicioIso = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`;

    supabase
      .from('vw_conciliacao_meta')
      .select('*')
      .gte('mes', inicioIso)
      .order('mes')
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else setLinhas((data ?? []).map((l: Linha) => ({
          ...l,
          ads_meta: l.ads_meta == null ? null : Number(l.ads_meta),
          marcado_campanha: Number(l.marcado_campanha),
          sem_categoria_cs: Number(l.sem_categoria_cs),
          residuo_campanha: l.residuo_campanha == null ? null : Number(l.residuo_campanha),
        })));
        setCarregando(false);
      });

    return () => { vivo = false; };
  }, [meses]);

  // Só meses com as duas pontas: comparar contra um lado ausente não é
  // diferença, é falta de dado — e apareceria como se tudo fosse resíduo.
  const comparaveis = linhas.filter(l => l.ads_meta != null && l.saiu_banco != null);

  if (carregando) {
    return <Moldura><p className="text-sm text-muted-foreground text-center py-8">Carregando…</p></Moldura>;
  }
  if (erro) {
    return <Moldura><p className="text-sm text-red-400 text-center py-8">Não consegui carregar: {erro}</p></Moldura>;
  }
  if (comparaveis.length === 0) {
    return (
      <Moldura>
        <p className="text-sm text-muted-foreground text-center py-8">
          Ainda não há mês com dado das duas fontes para comparar.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Mês</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Campanha (Meta)</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Marcado como ads</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Sem categoria</th>
              <th className="text-right font-medium text-muted-foreground pb-2 pl-2">Resíduo</th>
            </tr>
          </thead>
          <tbody>
            {comparaveis.map(l => {
              const residuo = l.residuo_campanha ?? 0;
              const base = l.ads_meta ?? 0;
              // 3% de folga: cobrança da Meta não cai no mesmo dia do gasto, e
              // um resíduo pequeno é atravessamento de mês, não divergência.
              const fecha = base > 0 && Math.abs(residuo) <= base * 0.03;
              return (
                <tr key={l.mes} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="text-foreground">{rotulo(l.mes)}</span>
                    {l.mes_em_curso && (
                      <span
                        className="ml-1.5 text-[11px] text-muted-foreground"
                        title="Parte do gasto já aconteceu e ainda não foi cobrada — o resíduo deste mês ainda vai mudar"
                      >
                        em curso
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                    {formatCurrency(l.ads_meta ?? 0)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-foreground">
                    {formatCurrency(l.marcado_campanha)}
                  </td>
                  <td className={cn(
                    'py-1.5 px-2 text-right tabular-nums',
                    l.sem_categoria_cs > 0 ? 'text-amber-400' : 'text-muted-foreground/40',
                  )}>
                    {l.sem_categoria_cs > 0 ? formatCurrency(l.sem_categoria_cs) : '—'}
                  </td>
                  <td className={cn(
                    'py-1.5 pl-2 text-right tabular-nums whitespace-nowrap',
                    fecha ? 'text-green-400' : 'text-amber-400',
                  )}>
                    {formatCurrency(residuo)}
                    {base > 0 && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {((residuo / base) * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="font-medium text-foreground">Resíduo</strong> é o que sobra depois de
          tirar o grupo sem categoria: quanto menor, mais a cobrança da Meta bate com a campanha
          que ela reporta. O grupo <strong className="font-medium text-amber-300">sem categoria</strong>{' '}
          começou em 21/07 e não está atribuído a nada — o extrato traz{' '}
          <span className="text-foreground">FACEBK</span> com id aleatório e sem código de categoria,
          então a separação tem de vir da marcação na Conta Simples.
        </p>
      </div>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Meta: campanha x conta
      </h2>
      <p className="text-xs text-muted-foreground/70 mb-4">
        Anúncios são a maior linha de custo e chegam ao extrato como um número só.
      </p>
      {children}
    </div>
  );
}
