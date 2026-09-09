import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { RetencaoVsl, emMinutos } from '../retencao';
import { variacao } from '../metricas';
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

/**
 * As linhas do bloco do VTurb, na ordem em que a pessoa decide.
 *
 * A CONVERSÃO vem primeiro, e não junto do resto da retenção: num teste A/B ela
 * é a métrica que decide — retenção diz se o vídeo segura, conversão diz se ele
 * vende, e é a segunda que escolhe o lado vencedor. Nos outros marcos a ordem é
 * a do roteiro.
 */
const MARCOS: { rotulo: string; campo: keyof RetencaoVsl }[] = [
  { rotulo: 'Conversão',    campo: 'conversao_pct' },
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
 * A diferença sai em VARIAÇÃO PERCENTUAL, pela mesma `variacao()` que o resto
 * da tela usa — inclusive a folga de 1% para não pintar seta em ruído de
 * arredondamento e o corte em "×" acima de 1000%.
 *
 * A primeira versão mostrava pontos percentuais ("−44,4 pp"), que é a leitura
 * mais honesta de duas taxas. Mas era a ÚNICA coluna da página falando essa
 * língua: Resultado, Ofertas, Funil e Por visitante todos dizem "↓12,8%". Uma
 * unidade diferente no meio de uma tela inteira obriga a parar e traduzir, e
 * isso custa mais do que a precisão ganha.
 */
function Comparacao({ rs }: { rs: RetencaoVsl[] }) {
  const dois = rs.length === 2;
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="flex items-center gap-2">
          <span className="h-3.5 w-1 rounded-full bg-primary shrink-0 self-center" />
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-foreground">
            A VSL
          </h3>
        </span>
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
            {dois && <span className="w-20 shrink-0 text-right">B vs A</span>}
          </div>

          {MARCOS.map(({ rotulo, campo }) => {
            const vals = rs.map(r => r[campo] as number | null);
            // B contra A, na mesma conta do resto da página: o "anterior" aqui
            // é o lado A. Retenção maior é melhor, então subir é verde.
            const v = dois ? variacao(vals[1], vals[0]) : null;
            const Seta = v?.direcao === 'subiu' ? ArrowUp : ArrowDown;
            const destaque = campo === 'conversao_pct';
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
                  <span className="w-20 shrink-0 text-right">
                    {v?.pct != null && v.direcao !== 'igual' ? (
                      <span className={cn(
                        'inline-flex items-center gap-0.5 text-[13px] font-medium tabular-nums',
                        v.direcao === 'subiu' ? 'text-emerald-400' : 'text-red-400',
                      )}>
                        <Seta className="h-3 w-3" />
                        {/* Mesma regra do resto da tela: acima de 10× o
                            percentual vira ruído e o múltiplo diz o mesmo. */}
                        {Math.abs(v.pct) >= 1000
                          ? `${(Math.abs(v.pct) / 100).toFixed(0)}×`
                          : `${Math.abs(v.pct).toFixed(1)}%`}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
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

/** O que `fn_vsl_do_rev` devolve por período. */
export interface VendasDaVsl {
  tem_checkout: boolean;
  checkouts: string[];
  /** Os checkouts do REV que ainda NAO foram marcados como o da VSL. */
  candidatos: string[];
  pedidos: number;
  vendas: number;
  faturamento: number;
  conv_checkout_pct: number | null;
}

/**
 * O que a VSL vendeu — pela PAYT, isolada pelo checkout dela.
 *
 * A retenção diz se o vídeo segura; isto diz se ele vende, que é outra
 * pergunta. Fica logo acima da retenção porque é a resposta que se procura
 * primeiro: "quanto a VSL trouxe".
 *
 * A conversão aqui é a DO CHECKOUT (aprovadas ÷ pedidos), e a outra — quantos
 * dos que deram play compraram — está no bloco "A VSL", logo abaixo. São duas
 * perguntas, e cada uma vive no bloco da fonte que a responde inteira: a do
 * checkout é toda da Payt, a do vídeo é toda do VTurb. Misturar venda da Payt
 * com view do VTurb num mesmo número foi o que já produziu "conversão de
 * checkout: 202,9%" neste projeto.
 */
function VendasVsl({ v, anterior }: { v: VendasDaVsl | null; anterior: VendasDaVsl | null }) {
  if (!v) return null;

  /*
    Faltar MARCACAO e faltar CHECKOUT sao coisas diferentes, e o aviso dizia as
    duas com a mesma frase.

    "Nenhum checkout marcado como o da VSL" num REV que tem dois checkouts
    vinculados foi lido como "este REV nao tem checkout" — e mandava procurar o
    que falta no lugar errado. Agora o aviso NOMEIA o que esta la, porque a
    acao pedida e sobre um deles.

    O que ele nao faz e escolher: um checkout chamado "VSL 01" quase certamente
    e o da VSL, mas deduzir do titulo e a armadilha 3 — basta alguem chamar o
    checkout do front de "VSL" e as vendas inteiras do REV viram vendas da VSL
    sem ninguem ver.
  */
  if (!v.tem_checkout) {
    const tem = v.candidatos.length > 0;
    return (
      <ListaMetricas titulo="O que a VSL vendeu">
        <p className="px-3 py-3 text-sm text-muted-foreground/70">
          {tem ? (
            <>
              Este REV tem {v.candidatos.length === 1 ? 'um checkout' : `${v.candidatos.length} checkouts`},
              e nenhum está marcado como o da VSL:{' '}
              <span className="text-foreground/80">{v.candidatos.join(' · ')}</span>.{' '}
              <Link to="/funis-gestao" className="text-primary hover:underline">
                Marque em Funis
              </Link>
              , no botão VSL da linha do checkout, e a Payt passa a separar o
              que a VSL trouxe do resto do funil.
            </>
          ) : (
            <>
              Este REV não tem checkout vinculado, então não há o que marcar
              como o da VSL.{' '}
              <Link to="/funis-gestao" className="text-primary hover:underline">
                Vincule em Funis
              </Link>
              , na lista de checkouts do REV.
            </>
          )}
        </p>
      </ListaMetricas>
    );
  }

  return (
    <ListaMetricas
      titulo="O que a VSL vendeu"
      nota={<>pela Payt · {v.checkouts.join(' · ')}</>}
    >
      <LinhaMetrica rotulo="Vendas" valor={v.vendas} anterior={anterior?.vendas ?? null}
        formato={formatNumber} destaque
        base={formatNumber(v.pedidos) + ' pedidos'} />
      <LinhaMetrica rotulo="Faturamento" valor={v.faturamento} anterior={anterior?.faturamento ?? null}
        formato={formatCurrency} />
      <LinhaMetrica rotulo="Conversão do checkout" valor={v.conv_checkout_pct}
        anterior={anterior?.conv_checkout_pct ?? null} formato={pct}
        detalhe="pedido iniciado que virou venda" />
    </ListaMetricas>
  );
}

export function BlocoVsl({ rs, anteriores, vendas, vendasAntes }: {
  rs: RetencaoVsl[]; anteriores: RetencaoVsl[];
  vendas: VendasDaVsl | null; vendasAntes: VendasDaVsl | null;
}) {
  if (rs.length === 0) {
    return (
      <ListaMetricas titulo="A VSL">
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

  /* Teste A/B: a Payt manda os dois lados para o MESMO checkout, então ela não
     tem como saber qual VSL a pessoa viu. Não é limitação do painel — é o que
     existe. Ali a única medida possível é a do próprio VTurb, e o bloco de
     vendas por checkout sai de cena em vez de mostrar um número que não separa
     o que se está comparando. */
  if (rs.length > 1) return <Comparacao rs={rs} />;

  const r = rs[0];
  const anterior = anteriores[0] ?? null;

  return (
    <>
    <VendasVsl v={vendas} anterior={vendasAntes} />
    <ListaMetricas
      titulo="A VSL"
      nota={<>ao vivo do VTurb{r.nome ? ` · ${r.nome}` : ''}</>}
    >
      {/* A conversão DA VSL, que é outra pergunta que a do checkout logo
          acima: aquela mede o checkout (pedido iniciado que virou venda), esta
          mede o vídeo (quem viu e comprou). Não são versões do mesmo número, e
          por isso estão em blocos separados — um da Payt, outro do VTurb. */}
      <LinhaMetrica rotulo="Conversão" valor={r.conversao_pct} anterior={anterior?.conversao_pct ?? null}
        formato={pct} destaque
        detalhe="de quem deu play, quantos compraram"
        base={r.plays != null ? `${formatNumber(r.plays)} deram play` : undefined} />
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
    </>
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
