import { Link } from 'react-router-dom';
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

export function BlocoVsl({ r, anterior }: { r: RetencaoVsl | null; anterior: RetencaoVsl | null }) {
  if (!r) {
    return (
      <ListaMetricas titulo="Retenção da VSL">
        <p className="px-3 py-3 text-xs text-muted-foreground/70">
          Este REV não tem VSL vinculada.{' '}
          <Link to="/funis-gestao" className="text-primary hover:underline">
            Vincule em Funis
          </Link>{' '}
          para a retenção aparecer aqui sozinha.
        </p>
      </ListaMetricas>
    );
  }

  return (
    <ListaMetricas
      titulo="Retenção da VSL"
      nota={<>ao vivo do VTurb{r.nome ? ` · ${r.nome}` : ''}</>}
    >
      <LinhaMetrica rotulo="Play Rate" valor={r.play_rate_pct} anterior={anterior?.play_rate_pct ?? null} formato={pct}
        extra="quem deu play" />
      <LinhaMetrica rotulo="1 minuto" valor={r.um_minuto_pct} anterior={anterior?.um_minuto_pct ?? null} formato={pct}
        extra="dos que deram play" />
      <LinhaMetrica rotulo="Fim da Lead" valor={r.fim_da_lead_pct} anterior={anterior?.fim_da_lead_pct ?? null} formato={pct}
        extra={r.lead_fim_seg == null
          // O único número desta tela que o banco não sabe: é marca de roteiro.
          ? <span className="text-amber-400/80">defina o fim da lead na VSL</span>
          : `aos ${emMinutos(r.lead_fim_seg)}`} />
      <LinhaMetrica rotulo="Pitch" valor={r.pitch_pct} anterior={anterior?.pitch_pct ?? null} formato={pct} destaque
        extra={r.pitch_seg != null ? `aos ${emMinutos(r.pitch_seg)}` : undefined} />
      <LinhaMetrica rotulo="Final da VSL" valor={r.final_pct} anterior={anterior?.final_pct ?? null} formato={pct}
        extra={r.duracao_seg != null ? `aos ${emMinutos(r.duracao_seg)}` : undefined} />
    </ListaMetricas>
  );
}

export function BlocoTsl() {
  return (
    <ListaMetricas titulo="Rolagem da página">
      <p className="px-3 py-3 text-xs text-muted-foreground/70">
        Topo, 20%, 30%, Oferta e Final da página ainda não são medidos — dependem
        do Clarity, que não está integrado. Enquanto isso, esta parte continua na
        planilha; é o único pedaço dela que ainda não vive aqui.
      </p>
    </ListaMetricas>
  );
}
