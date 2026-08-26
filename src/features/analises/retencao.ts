import { supabase } from '@/lib/supabase';

/**
 * As cinco linhas de VSL da planilha, lidas ao vivo do VTurb.
 *
 * Play Rate, 1 minuto, Pitch e Final saem da API. O "Fim da Lead" não: é uma
 * marca editorial do roteiro, e mora em `vsls.lead_fim_seg`, preenchida uma vez
 * por VSL. Enquanto estiver vazia a tela mostra tracinho e diz onde preencher,
 * em vez de fingir um número.
 *
 * Não gravamos retenção em tabela nossa: ela muda todo dia e retrato velho é
 * pior que consulta ao vivo. O que fica gravado é o retrato da rodada, junto da
 * leitura — mas isso é a tela que faz, não este módulo.
 */

export interface RetencaoVsl {
  play_rate_pct: number | null;
  um_minuto_pct: number | null;
  fim_da_lead_pct: number | null;
  pitch_pct: number | null;
  final_pct: number | null;
  /** Segundos, para a tela dizer "Pitch (aos 13min21)". */
  lead_fim_seg: number | null;
  pitch_seg: number | null;
  duracao_seg: number | null;
  nome: string | null;
}

interface Vsl {
  id: string;
  nome: string | null;
  duracao_seg: number | null;
  pitch_seg: number | null;
  lead_fim_seg: number | null;
}

interface Balde { total_users: number; timed: number }

/**
 * `grouped_timed` é um HISTOGRAMA, não uma curva.
 *
 * Cada balde diz quantas pessoas PARARAM ali, não quantas chegaram. Lido
 * direto, dava 6% de retenção em 1 minuto e 47% no fim — e retenção não sobe.
 * A curva é a soma acumulada de trás para frente: quem chegou ao segundo `t` é
 * todo mundo que parou em `t` ou depois.
 *
 * O denominador é quem DEU PLAY (o balde inclui `timed: 0`), então a curva
 * mede retenção entre quem começou, não entre quem viu a página — o Play Rate
 * ao lado cobre essa outra metade.
 *
 * Conferido contra `over_pitch_rate`, o único ponto da curva que a própria API
 * também calcula por conta dela.
 */
function retencaoEm(hist: Balde[], seg: number | null): number | null {
  if (seg == null || !hist.length) return null;
  const total = hist.reduce((s, b) => s + b.total_users, 0);
  if (total === 0) return null;
  const chegaram = hist.filter(b => b.timed >= seg).reduce((s, b) => s + b.total_users, 0);
  return (chegaram / total) * 100;
}

/**
 * A API do VTurb recusa data sem hora — devolve "must be a valid datetime with
 * hours, minutes, and seconds". E o fim é inclusivo até o último segundo do
 * dia, senão a janela perde o dia inteiro do `fim`.
 */
const desde = (d: string) => `${d} 00:00:00`;
const ate   = (d: string) => `${d} 23:59:59`;

/** A API devolve percentual como string ("63.98"), e já em pontos percentuais. */
function comoPct(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function buscarRetencao(
  vslId: string, inicio: string, fim: string,
): Promise<RetencaoVsl | null> {
  const { data: vsl } = await supabase
    .from('vsls')
    .select('id,nome,duracao_seg,pitch_seg,lead_fim_seg')
    .eq('id', vslId)
    .maybeSingle<Vsl>();

  if (!vsl) return null;

  // Os parâmetros vão dentro de `params`: é o contrato da edge function, e
  // mandá-los soltos no corpo faz a API responder "Player can't be blank".
  const chamar = (acao: string, extra: Record<string, unknown>) =>
    supabase.functions.invoke('vturb', {
      body: {
        acao,
        params: {
          player_id: vslId,
          inicio: desde(inicio),
          fim: ate(fim),
          duracao: vsl.duracao_seg,
          ...extra,
        },
      },
    });

  const [stats, curva] = await Promise.all([
    chamar('stats', { pitch: vsl.pitch_seg }),
    chamar('retencao', {}),
  ]);

  const s = (stats.data?.dados ?? {}) as Record<string, unknown>;
  const hist = ((curva.data?.dados as { grouped_timed?: Balde[] })?.grouped_timed ?? []);

  return {
    play_rate_pct: comoPct(s.play_rate),
    um_minuto_pct: retencaoEm(hist, 60),
    fim_da_lead_pct: retencaoEm(hist, vsl.lead_fim_seg),
    // Prefere o número que a própria API calcula, e só cai para a curva se ele
    // não vier: duas fontes para o mesmo ponto, a delas ganha.
    pitch_pct: comoPct(s.over_pitch_rate) ?? retencaoEm(hist, vsl.pitch_seg),
    final_pct: retencaoEm(hist, vsl.duracao_seg),
    lead_fim_seg: vsl.lead_fim_seg,
    pitch_seg: vsl.pitch_seg,
    duracao_seg: vsl.duracao_seg,
    nome: vsl.nome,
  };
}

/** "13min21" em vez de "801s" — é como ela fala do roteiro. */
export function emMinutos(seg: number | null): string {
  if (seg == null) return '—';
  const m = Math.floor(seg / 60);
  const s = Math.round(seg % 60);
  return m > 0 ? `${m}min${String(s).padStart(2, '0')}` : `${s}s`;
}
