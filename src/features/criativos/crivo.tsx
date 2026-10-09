/**
 * O CRIVO: a régua que separa validado de escalado, lida do banco.
 *
 * ── Por que ela saiu do código ─────────────────────────────────────────────
 *
 * Era uma constante neste mesmo módulo (`CRIVO` em `AvaliacaoView.tsx:141`) com
 * cinco parágrafos explicando de onde vinha cada número. Enquanto a régua era
 * só lida por gente, funcionava. A partir de 09/10/2026 ela DECIDE sozinha, e
 * duas coisas ficaram insustentáveis:
 *
 * 1. O empate (o ROAS de break-even) aparecia em TRÊS lugares — aqui, em
 *    `vw_ad_morrendo` e em texto corrido na tela do Meta Ads. Havia um teste
 *    (`o-empate-e-um-so`) existindo só para impedir que divergissem.
 * 2. A prosa e os números eram editáveis separadamente. Com a régua no banco,
 *    os dois moram na MESMA LINHA IMUTÁVEL de `crivo_versoes` e não conseguem
 *    mais discordar.
 *
 * ── A margem é DERIVADA, e é por isso que a tela não a guarda ─────────────
 *
 * `margem(R) = fator_midia · (1/empate − 1/R)`, calculada por
 * `vw_crivo_niveis_vigentes`. O `fator_midia` vem de
 * `fn_config('imposto_meta_ads_pct')`. Guardar a margem como número a
 * congelaria — e ela acabou de mudar, porque o Simples foi remedido de 9% para
 * 6,9359% em `20261008i` e o empate caiu de 1,6 para 1,56.
 *
 * ── `medido_em` nulo aparece como tal ─────────────────────────────────────
 *
 * A régua de 06/09/2026 foi MEDIDA sobre 782 ADs e R$ 242.143. A de 09/10/2026
 * foi DECIDIDA. A tela diz qual é qual, porque inventar uma data de medição
 * para uma escolha é apresentar palpite como apuração — e é o tipo de coisa em
 * que quem lê acredita.
 *
 * Régua ausente mostra texto mudo. **Nenhum número de fallback no código**: um
 * fallback aqui seria a terceira armadilha voltando pela porta dos fundos,
 * agora com a agravante de que a máquina escreveria por ele.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Ruler } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';
import { MarkdownRenderer } from '@/features/processos/components/MarkdownRenderer';
/* A cor de cada nível vem de `avaliacao.ts`, o mesmo mapa dos selos da lista:
   dois mapas de cor para os mesmos valores divergiriam, e o antigo já tinha
   esquecido o "Escalado". */
import { corDaAvaliacao } from './avaliacao';

export interface CrivoVigente {
  id: string;
  vigente_de: string;
  medido_em: string | null;
  empate: number;
  verba_min: number;
  base_ads: number | null;
  base_investimento: number | null;
  base_ini: string | null;
  base_fim: string | null;
  nivel_sem_verba: string;
  nivel_reprovado: string;
  justificativa: string[];
  fator_midia: number;
}

export interface CrivoNivel {
  nivel: string;
  clausula: number;
  vendas_min: number;
  roas_min: number;
  roas_inclusivo: boolean;
  ordem: number;
  significa: string;
  margem: number;
}

/** A régua em vigor e suas cláusulas, numa chamada só. */
export function useCrivo() {
  const [crivo, setCrivo] = useState<CrivoVigente | null>(null);
  const [niveis, setNiveis] = useState<CrivoNivel[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [v, n] = await Promise.all([
        supabase.from('vw_crivo_vigente').select('*').maybeSingle(),
        supabase.from('vw_crivo_niveis_vigentes').select('*').order('ordem', { ascending: false }),
      ]);
      if (!vivo) return;
      setCrivo((v.data as CrivoVigente) ?? null);
      setNiveis((n.data as CrivoNivel[]) ?? []);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, []);

  return { crivo, niveis, carregandoCrivo: carregando };
}

/** `1,65` com o operador que a régua usa de verdade: `≥` ou `>`. */
function corte(n: CrivoNivel): string {
  return `${n.roas_inclusivo ? '≥' : '>'} ${formatNumber(n.roas_min)}`;
}

/** As cláusulas de um nível, agrupadas — um nível pode ter várias, em OU. */
function porNivel(niveis: CrivoNivel[]): { nivel: string; ordem: number; significa: string; clausulas: CrivoNivel[] }[] {
  const mapa = new Map<string, { nivel: string; ordem: number; significa: string; clausulas: CrivoNivel[] }>();
  for (const n of niveis) {
    const atual = mapa.get(n.nivel);
    if (atual) atual.clausulas.push(n);
    else mapa.set(n.nivel, { nivel: n.nivel, ordem: n.ordem, significa: n.significa, clausulas: [n] });
  }
  return [...mapa.values()].sort((a, b) => b.ordem - a.ordem);
}

export function TabelaDoCrivo() {
  const { crivo, niveis, carregandoCrivo } = useCrivo();
  const [aberto, setAberto] = useState(false);

  if (carregandoCrivo) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando a régua…
      </div>
    );
  }

  /* Régua ausente diz isso com palavras. Sem número de fallback: a régua é
     quem decide a avaliação agora, e um palpite aqui seria lido como regra. */
  if (!crivo || niveis.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span className="text-foreground">Nenhuma régua configurada.</span>{' '}
        A avaliação automática fica parada até existir uma versão vigente em
        <span className="font-mono"> crivo_versoes</span>.
      </div>
    );
  }

  const grupos = porNivel(niveis);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Ruler className="h-3.5 w-3.5" />
          Crivo
        </span>

        {grupos.map(g => (
          <span key={g.nivel} className="flex items-baseline gap-2 text-xs">
            <span className={cn('rounded border px-1.5 py-0.5 font-medium', corDaAvaliacao(g.nivel))}>
              {g.nivel}
            </span>
            {/* As cláusulas separadas por "ou": é a curva de troca entre volume
                e retorno, e escrevê-la como uma linha só esconderia que há
                duas portas de entrada para o mesmo nível. */}
            <span className="tabular-nums text-foreground">
              {g.clausulas
                .sort((a, b) => b.vendas_min - a.vendas_min)
                .map(c => `${c.vendas_min} vendas · ROAS ${corte(c)}`)
                .join('  ou  ')}
            </span>
            <span className="text-muted-foreground">{g.significa}</span>
          </span>
        ))}

        <button
          onClick={() => setAberto(v => !v)}
          className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          de onde vem
          <ChevronDown className={cn('h-3 w-3 transition-transform', aberto && 'rotate-180')} />
        </button>
      </div>

      {aberto && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {/* A margem de cada cláusula, que é como ela raciocina sobre a régua:
              "margem boa com poucas vendas, ou margem pequena com volume". O
              número sai do empate, não de uma coluna gravada. */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
            <span className="text-muted-foreground">
              Empate (break-even):{' '}
              <span className="tabular-nums text-foreground">ROAS {formatNumber(crivo.empate)}</span>
            </span>
            <span className="text-muted-foreground">
              Piso de verba:{' '}
              <span className="tabular-nums text-foreground">
                R$ {formatNumber(crivo.verba_min)}
              </span>{' '}
              — abaixo disso o card fica “{crivo.nivel_sem_verba}”
            </span>
            {niveis.map(n => (
              <span key={`${n.nivel}-${n.clausula}`} className="text-muted-foreground">
                {n.nivel} ({n.vendas_min} vendas):{' '}
                <span className="tabular-nums text-foreground">
                  {formatNumber(n.margem * 100)}% de margem
                </span>
              </span>
            ))}
          </div>

          <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
            {crivo.justificativa.map((p, i) => (
              <MarkdownRenderer key={i} content={p} />
            ))}
          </div>

          <p className="pt-1 text-[11px] text-muted-foreground/60">
            {/* MEDIDA e DECIDIDA são coisas diferentes, e a tela não finge que
                são a mesma. Nulo em `medido_em` não vira data. */}
            {crivo.medido_em ? (
              <>
                Medida em {new Date(crivo.medido_em + 'T00:00:00').toLocaleDateString('pt-BR')}
                {crivo.base_ads != null && crivo.base_investimento != null && (
                  <> sobre {crivo.base_ads} ADs e R$ {formatNumber(crivo.base_investimento)} de mídia</>
                )}
                .
              </>
            ) : (
              <>
                <span className="text-warning">Decidida, não medida.</span> Em vigor desde{' '}
                {new Date(crivo.vigente_de + 'T00:00:00').toLocaleDateString('pt-BR')}. Ela só se
                prova depois de alguns meses de cards novos.
              </>
            )}{' '}
            As margens saem do empate e se refazem sozinhas quando a alíquota mudar.
          </p>
        </div>
      )}
    </div>
  );
}
