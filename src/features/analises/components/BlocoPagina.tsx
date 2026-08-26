import { Link } from 'react-router-dom';
import { RetencaoVsl, emMinutos } from '../retencao';
import { CartaoMetrica } from './CartaoMetrica';
import { SecaoMetricas } from './SecaoMetricas';

/**
 * O fim da planilha: como a página segura a pessoa.
 *
 * Muda conforme o método do REV, porque as duas coisas medem o mesmo e por
 * instrumentos diferentes — VSL tem retenção de vídeo, TSL tem rolagem de
 * página. Mostrar os dois blocos sempre encheria metade da tela de tracinhos.
 */

const pct = (n: number) => `${n.toFixed(1)}%`;

export function BlocoVsl({ r, anterior }: { r: RetencaoVsl | null; anterior: RetencaoVsl | null }) {
  if (!r) {
    return (
      <SecaoMetricas titulo="Retenção da VSL">
        <p className="col-span-full text-xs text-muted-foreground/70">
          Este REV não tem VSL vinculada.{' '}
          <Link to="/funis-gestao" className="text-primary hover:underline">
            Vincule em Funis
          </Link>{' '}
          para a retenção aparecer aqui sozinha.
        </p>
      </SecaoMetricas>
    );
  }

  return (
    <SecaoMetricas
      titulo="Retenção da VSL"
      nota={<>ao vivo do VTurb{r.nome ? ` · ${r.nome}` : ''}</>}
    >
      <CartaoMetrica rotulo="Play Rate" valor={r.play_rate_pct} anterior={anterior?.play_rate_pct ?? null} formato={pct} />
      <CartaoMetrica rotulo="1 minuto" valor={r.um_minuto_pct} anterior={anterior?.um_minuto_pct ?? null} formato={pct} />
      <CartaoMetrica
        rotulo="Fim da Lead" valor={r.fim_da_lead_pct} anterior={anterior?.fim_da_lead_pct ?? null} formato={pct}
        nota={r.lead_fim_seg == null
          // O único número desta tela que o banco não sabe: é marca de roteiro.
          ? 'defina o fim da lead no cadastro da VSL'
          : `aos ${emMinutos(r.lead_fim_seg)}`}
      />
      <CartaoMetrica
        rotulo="Pitch" valor={r.pitch_pct} anterior={anterior?.pitch_pct ?? null} formato={pct} destaque
        nota={r.pitch_seg != null ? `aos ${emMinutos(r.pitch_seg)}` : undefined}
      />
      <CartaoMetrica
        rotulo="Final da VSL" valor={r.final_pct} anterior={anterior?.final_pct ?? null} formato={pct}
        nota={r.duracao_seg != null ? `aos ${emMinutos(r.duracao_seg)}` : undefined}
      />
    </SecaoMetricas>
  );
}

export function BlocoTsl() {
  return (
    <SecaoMetricas titulo="Rolagem da página">
      <p className="col-span-full text-xs text-muted-foreground/70">
        Topo, 20%, 30%, Oferta e Final da página ainda não são medidos — dependem
        do Clarity, que não está integrado. Enquanto isso, esta parte continua na
        planilha; é o único pedaço dela que ainda não vive aqui.
      </p>
    </SecaoMetricas>
  );
}
