import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';

/**
 * O que saiu para a Meta contra o que a Meta diz ter gasto em campanha.
 *
 * Separar campanha de automação de WhatsApp não sai do texto: são 540
 * lançamentos "FACEBK *<id aleatório>", sem MCC, com valores de R$ 0,19 a
 * R$ 5.275. Quem separa é o CARTÃO — a empresa usa um cartão virtual por
 * finalidade, e •••• 4353 e •••• 7488 são os do WhatsApp. Isso estava no
 * payload em `card.maskedNumber` o tempo todo.
 *
 * O resultado desmonta a hipótese que motivou este bloco: o WhatsApp é da ordem
 * de R$ 280 por mês, não os R$ 9.500 que faltavam. O que sobra é um acréscimo
 * de ~14,3% sobre o que a Meta reporta, estável quando o período cresce
 * (1,158 → 1,179 → 1,166 → 1,143 no acumulado) — o imposto que a Meta cobra na
 * fatura e que a API de insights não devolve.
 *
 * Isto NÃO é erro a corrigir no Financeiro: o que o Facebook debita já vem com
 * imposto, então o valor da conta é o custo real e completo. Este bloco mora na
 * tela de Meta Ads justamente por isso — no Financeiro a regra é trabalhar só
 * com movimentação bancária, e aqui se compara o banco com uma fonte de fora.
 *
 * A quem serve: quem lê ROAS e CPA nesta tela está dividindo por um
 * investimento ~14% menor do que o que de fato saiu da conta.
 */

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface Linha {
  mes: string;
  ads_meta: number | null;
  ads_banco: number;
  whatsapp: number;
  saiu_banco: number | null;
  residuo: number | null;
  pct_residuo: number | null;
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

  const { empresaId } = useFilters();

  useEffect(() => {
    let vivo = true;
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
    const inicioIso = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`;

    /* Aqui a empresa vem do carimbo, e não do projeto: os dois lados deste
       painel são dinheiro — o gasto que a Meta reporta e o que saiu da conta
       bancária. Conferir o cartão de uma empresa contra a campanha da outra
       não erraria por pouco: erraria por inteiro. */
    let q = supabase
      .from('vw_conciliacao_meta')
      .select('*')
      .gte('mes', inicioIso)
      .order('mes');
    if (empresaId) q = q.eq('empresa_id', empresaId);
    q
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else setLinhas((data ?? []).map((l: Linha) => ({
          ...l,
          ads_meta: l.ads_meta == null ? null : Number(l.ads_meta),
          ads_banco: Number(l.ads_banco),
          whatsapp: Number(l.whatsapp),
          residuo: l.residuo == null ? null : Number(l.residuo),
          pct_residuo: l.pct_residuo == null ? null : Number(l.pct_residuo),
        })));
        setCarregando(false);
      });

    return () => { vivo = false; };
  }, [meses, empresaId]);

  // Só meses com as duas pontas: comparar contra um lado ausente não é
  // diferença, é falta de dado — e apareceria como se tudo fosse resíduo.
  const comparaveis = linhas.filter(l => l.ads_meta != null && l.saiu_banco != null);

  // O acréscimo médio do período. Mês a mês ele oscila porque a Meta cobra por
  // limite atingido e não por virada de mês; no acumulado, converge.
  const somaMeta  = comparaveis.reduce((a, l) => a + (l.ads_meta ?? 0), 0);
  const somaBanco = comparaveis.reduce((a, l) => a + l.ads_banco, 0);
  const acrescimo = somaMeta > 0 ? ((somaBanco / somaMeta) - 1) * 100 : 0;

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
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Mês</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Campanha (Meta)</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">Saiu (cartões de ads)</th>
              <th className="text-right font-medium text-muted-foreground pb-2 px-2">WhatsApp</th>
              <th className="text-right font-medium text-muted-foreground pb-2 pl-2">Acréscimo</th>
            </tr>
          </thead>
          <tbody>
            {comparaveis.map(l => (
              <tr key={l.mes} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <span className="text-foreground">{rotulo(l.mes)}</span>
                  {l.mes_em_curso && (
                    <span
                      className="ml-1.5 text-[11px] text-muted-foreground"
                      title="Parte do gasto já aconteceu e ainda não foi cobrada — este mês ainda vai mudar"
                    >
                      em curso
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(l.ads_meta ?? 0)}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-foreground">
                  {formatCurrency(l.ads_banco)}
                </td>
                <td className={cn(
                  'py-1.5 px-2 text-right tabular-nums',
                  l.whatsapp > 0 ? 'text-foreground' : 'text-muted-foreground/40',
                )}>
                  {l.whatsapp > 0 ? formatCurrency(l.whatsapp) : '—'}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums whitespace-nowrap text-amber-400">
                  {formatCurrency(l.residuo ?? 0)}
                  <span className="ml-1 text-[11px] text-muted-foreground">
                    {l.pct_residuo?.toFixed(0)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          A conta cobra <strong className="font-medium text-foreground">
            {acrescimo.toFixed(1)}%
          </strong>{' '}
          a mais do que a Meta reporta como campanha no período — o percentual oscila mês a mês
          porque a Meta cobra por limite atingido, não por virada de mês. É imposto sobre a compra
          de mídia, que a API de insights não devolve. O dashboard está configurado com{' '}
          <span className="text-foreground">12,5%</span> em{' '}
          <code className="text-[11px] text-foreground">imposto_meta_ads_pct</code>.
          {' '}O <strong className="font-medium text-foreground">WhatsApp</strong> vem separado
          pelos cartões •••• 4353 e •••• 7488.
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
        O cartão separa o que o descritor não separa — um cartão virtual por finalidade.
      </p>
      {children}
    </div>
  );
}
