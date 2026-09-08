import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { RetencaoVsl, emMinutos } from '../retencao';
import { ListaMetricas, LinhaMetrica } from './ListaMetricas';

/**
 * A etapa do meio do funil: como a página segura a pessoa depois do clique.
 *
 * Fica entre "Cliques" e "Checkouts iniciados" porque é onde ela acontece de
 * verdade — a pessoa chega, assiste (ou rola), e só então vai para o checkout.
 *
 * Muda conforme o método do REV: VSL tem retenção de vídeo, TSL tem rolagem de
 * página. Mostrar os dois blocos sempre encheria metade da tela de tracinhos.
 */

const pct = (n: number) => `${n.toFixed(1)}%`;

/** Os cinco marcos, na ordem em que a pessoa lê o roteiro. */
const MARCOS: { rotulo: string; campo: keyof RetencaoVsl }[] = [
  { rotulo: 'Play Rate',    campo: 'play_rate_pct' },
  { rotulo: '1 minuto',     campo: 'um_minuto_pct' },
  { rotulo: 'Fim da Lead',  campo: 'fim_da_lead_pct' },
  { rotulo: 'Pitch',        campo: 'pitch_pct' },
  { rotulo: 'Final da VSL', campo: 'final_pct' },
];

/**
 * Duas ou mais VSLs no mesmo REV: o teste A/B do VTurb.
 *
 * A comparação aqui é entre os LADOS, e não com a quinzena passada. Num teste
 * A/B a pergunta é "A ou B" — pôr os dois eixos juntos daria quatro números por
 * linha e nenhum deles seria lido. Por isso a página nem busca o período
 * anterior quando há mais de uma VSL.
 *
 * A diferença sai em PONTOS PERCENTUAIS, não em porcentagem de porcentagem:
 * 40% contra 30% é +10 pp. Dizer "+33%" ali seria verdade aritmética e mentira
 * de leitura — ninguém escala uma VSL por "33% melhor" que é 10 pontos.
 */
function Comparacao({ rs }: { rs: RetencaoVsl[] }) {
  const dois = rs.length === 2;
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Retenção da VSL
        </h3>
        <div className="h-px flex-1 min-w-4 bg-border" />
        <span className="text-xs text-muted-foreground/80">
          teste A/B · {rs.length} VSLs · ao vivo do VTurb
        </span>
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className="flex items-start gap-3 px-3 py-1.5 border-b border-border bg-secondary/40
                          text-xs uppercase tracking-wide text-muted-foreground">
            <span className="flex-1 min-w-0" />
            {rs.map((r, i) => (
              <span key={i} className="w-36 shrink-0 text-right">
                <span className="block font-semibold text-foreground">
                  {String.fromCharCode(65 + i)}
                </span>
                {/* O nome inteiro no title: os players do VTurb têm nomes quase
                    idênticos, e truncado "MicroLead 1" e "MicroLead 2" viram a
                    mesma coisa. */}
                <span className="block truncate normal-case tracking-normal" title={r.nome ?? undefined}>
                  {r.nome ?? '—'}
                </span>
              </span>
            ))}
            {dois && <span className="w-20 shrink-0 text-right">B − A</span>}
          </div>

          {MARCOS.map(({ rotulo, campo }) => {
            const vals = rs.map(r => r[campo] as number | null);
            const delta = dois && vals[0] != null && vals[1] != null ? vals[1]! - vals[0]! : null;
            const destaque = campo === 'pitch_pct';
            return (
              <div key={campo} className={cn(
                'flex items-baseline gap-3 px-3 py-2 border-b border-border/40 last:border-0',
                destaque && 'bg-secondary/30',
              )}>
                <span className="flex-1 min-w-0">
                  <span className={cn('block text-base leading-tight', destaque && 'font-semibold')}>
                    {rotulo}
                  </span>
                  {campo === 'fim_da_lead_pct' && rs.some(r => r.lead_fim_seg == null) && (
                    <span className="block text-xs leading-tight text-amber-400/80 mt-0.5">
                      defina o fim da lead na VSL
                    </span>
                  )}
                </span>
                {vals.map((v, i) => (
                  <span key={i} className={cn(
                    'w-36 shrink-0 text-right tabular-nums',
                    destaque ? 'text-lg font-semibold' : 'text-base font-semibold',
                  )}>
                    {v == null ? '—' : pct(v)}
                  </span>
                ))}
                {dois && (
                  <span className="w-20 shrink-0 text-right tabular-nums text-[13px] font-medium">
                    {delta == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={cn(
                        Math.abs(delta) < 0.05 ? 'text-muted-foreground'
                          : delta > 0 ? 'text-emerald-400' : 'text-red-400',
                      )}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)} pp
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Um teste A/B não se decide por diferença pequena, e a tela não deve
          sugerir que sim. Ela mostra os dois lados e cala o veredito — a mesma
          regra da sincronização de testes do VTurb. */}
      <p className="text-xs text-muted-foreground/70 px-0.5">
        Os dois lados, sem veredito: diferença pequena em poucos dias é ruído, e
        significância não é calculada aqui.
      </p>
    </section>
  );
}

export function BlocoVsl({ rs, anteriores }: { rs: RetencaoVsl[]; anteriores: RetencaoVsl[] }) {
  if (rs.length === 0) {
    return (
      <ListaMetricas titulo="Retenção da VSL">
        <p className="px-3 py-3 text-sm text-muted-foreground/70">
          Este REV não tem VSL vinculada.{' '}
          <Link to="/funis-gestao" className="text-primary hover:underline">
            Vincule em Funis
          </Link>{' '}
          para a retenção aparecer aqui sozinha.
        </p>
      </ListaMetricas>
    );
  }

  if (rs.length > 1) return <Comparacao rs={rs} />;

  const r = rs[0];
  const anterior = anteriores[0] ?? null;

  return (
    <ListaMetricas
      titulo="Retenção da VSL"
      nota={<>ao vivo do VTurb{r.nome ? ` · ${r.nome}` : ''}</>}
    >
      <LinhaMetrica rotulo="Play Rate" valor={r.play_rate_pct} anterior={anterior?.play_rate_pct ?? null} formato={pct}
        detalhe="quem deu play" />
      <LinhaMetrica rotulo="1 minuto" valor={r.um_minuto_pct} anterior={anterior?.um_minuto_pct ?? null} formato={pct}
        detalhe="dos que deram play" />
      <LinhaMetrica rotulo="Fim da Lead" valor={r.fim_da_lead_pct} anterior={anterior?.fim_da_lead_pct ?? null} formato={pct}
        detalhe={r.lead_fim_seg == null
          // O único número desta tela que o banco não sabe: é marca de roteiro.
          ? <span className="text-amber-400/80">defina o fim da lead na VSL</span>
          : `aos ${emMinutos(r.lead_fim_seg)}`} />
      <LinhaMetrica rotulo="Pitch" valor={r.pitch_pct} anterior={anterior?.pitch_pct ?? null} formato={pct} destaque
        detalhe={r.pitch_seg != null ? `aos ${emMinutos(r.pitch_seg)}` : undefined} />
      <LinhaMetrica rotulo="Final da VSL" valor={r.final_pct} anterior={anterior?.final_pct ?? null} formato={pct}
        detalhe={r.duracao_seg != null ? `aos ${emMinutos(r.duracao_seg)}` : undefined} />
    </ListaMetricas>
  );
}

export function BlocoTsl() {
  return (
    <ListaMetricas titulo="Rolagem da página">
      <p className="px-3 py-3 text-sm text-muted-foreground/70">
        Topo, 20%, 30%, Oferta e Final da página ainda não são medidos — dependem
        do Clarity, que não está integrado. Enquanto isso, esta parte continua na
        planilha; é o único pedaço dela que ainda não vive aqui.
      </p>
    </ListaMetricas>
  );
}
