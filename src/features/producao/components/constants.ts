import type { ProducaoNivel, CriativoTipo } from './types';

export type FaseItem = {
  key: string;
  label: string;
  revisao?: true;
  somente_socio?: true;
};

export const FASES: FaseItem[] = [
  { key: 'producao_copy',      label: 'Produção Copy'                                           },
  { key: 'revisao_copy',       label: 'Revisão Copy',      revisao: true                        },
  { key: 'gravacao',           label: 'Gravação'                                                },
  { key: 'revisao_gravacao',   label: 'Revisão Gravação',  revisao: true, somente_socio: true   },
  { key: 'edicao',             label: 'Edição'                                                  },
  { key: 'revisao_edicao', label: 'Revisão Edição',  revisao: true },
  { key: 'alteracao',      label: 'Alteração'        },
  { key: 'aprovado',       label: 'Aprovado'         },
  { key: 'esteira_teste',  label: 'Esteira de Teste' },
  { key: 'postado',        label: 'Postado'          },
  { key: 'na_plataforma',  label: 'Na Plataforma'   },
  { key: 'bloqueado',      label: 'Bloqueado'        },
  { key: 'arquivado',      label: 'Arquivado'        },
];

export const FASES_MAP: Record<string, string> = {
  ...Object.fromEntries(FASES.map(f => [f.key, f.label])),
  // chaves legadas para retrocompatibilidade com dados existentes
  programado:         'Programado',
  gravacao_concluida: 'Gravação Concluída',
  // `briefing` existe em 2 cards e em nenhum outro lugar: não está em `FASES`,
  // não é o que `getDefaultFase` devolve, e NUNCA aparece numa troca de fase no
  // histórico inteiro — nada jamais moveu um card para lá pela tela. Está aqui
  // só para o valor não aparecer cru enquanto os dois cards existirem. Sem
  // coluna no Kanban, eles são invisíveis lá.
  briefing:           'Briefing',
};

export const FASES_POR_TIPO: Record<CriativoTipo, string[]> = {
  criativo: ['producao_copy','revisao_copy','gravacao','revisao_gravacao','edicao','revisao_edicao','alteracao','aprovado','esteira_teste','postado'],
  vsl:      ['producao_copy','revisao_copy','gravacao','revisao_gravacao','edicao','revisao_edicao','alteracao','aprovado','esteira_teste','postado'],
  aula:     ['gravacao','revisao_gravacao','edicao','revisao_edicao','alteracao','aprovado','na_plataforma'],
};

export const TIPOS_LABEL: Record<CriativoTipo, string> = {
  criativo: 'Criativo',
  vsl: 'VSL',
  aula: 'Aula',
};

export const NIVEL_LABEL: Record<ProducaoNivel, string> = {
  socio:  'Admin',
  head:   'Head / Líder',
  membro: 'Membro',
};

export const TIPO_COR: Record<string, string> = {
  criativo: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  vsl:      'bg-purple-500/15 text-purple-300 border-purple-500/25',
  aula:     'bg-green-500/15 text-green-300 border-green-500/25',
};

export const STATUS_VEICULACAO_LABEL: Record<string, string> = {
  rodando:   'Rodando',
  pausado:   'Pausado',
  encerrado: 'Encerrado',
  bloqueado: 'Bloqueado',
  arquivado: 'Arquivado',
};

export const AVALIACAO_LABEL: Record<string, string> = {
  sem_dados:    'Sem dados',
  validado:     'Validado',
  nao_validado: 'Não validado',
};

export const STATUS_PRODUCAO_LABEL: Record<string, string> = {
  em_construcao: 'Em construção',
  ativo: 'Ativo',
  pausado: 'Pausado',
  encerrado: 'Encerrado',
};

export function getDefaultFase(tipo: CriativoTipo): string {
  return tipo === 'aula' ? 'gravacao' : 'producao_copy';
}

// Fases consideradas "concluídas" — prazo vencido não conta como atraso
export const FASES_CONCLUIDAS = new Set([
  'aprovado', 'esteira_teste', 'postado', 'na_plataforma', 'arquivado',
]);

/**
 * O prazo que vale, quando `data_prazo` está vazio.
 *
 * Vazio não quer dizer "sem prazo" — quer dizer "no mesmo dia". A entrega da
 * equipe é same-day, e por isso só 4,9% dos cards têm `data_prazo` preenchido:
 * quem faz e entrega no mesmo dia não digita a data duas vezes.
 *
 * Lendo esse silêncio como ausência, o sistema de urgência ficava decorativo —
 * as cores de atrasado e de atenção rodavam sobre 5% da base. Com `?? início`
 * ele passa a valer para 90%, sem migrar um único registro. E 30 cards em
 * andamento aparecem como atrasados, que é a informação que a tela não estava
 * dando.
 */
export function prazoEfetivo(
  data_prazo: string | null,
  data_inicio?: string | null,
): string | null {
  return data_prazo ?? data_inicio ?? null;
}

/**
 * O texto de uma data ou período — "26/08/2026", "24/08 → 28/08/2026" ou
 * "Sem data".
 *
 * Mora aqui junto de `prazoEfetivo` porque três telas mostram essa mesma
 * informação: o seletor, o drawer em leitura e o card. Escrita em cada uma,
 * ela divergiria — foi exatamente o que aconteceu com a regra de atraso.
 */
export function rotuloDoPrazo(inicio: string | null, prazo: string | null): string {
  const dia       = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const diaComAno = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString('pt-BR');
  const de  = inicio ?? prazo;
  const ate = prazo  ?? inicio;
  if (!de || !ate) return 'Sem data';
  if (de === ate)  return diaComAno(de);
  return `${dia(de)} → ${diaComAno(ate)}`;
}

export function getUrgency(
  data_prazo: string | null,
  fase?: string,
  data_inicio?: string | null,
): 'ok' | 'warn' | 'late' | null {
  const efetivo = prazoEfetivo(data_prazo, data_inicio);
  if (!efetivo) return null;
  if (fase && FASES_CONCLUIDAS.has(fase)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const prazo = new Date(efetivo + 'T00:00:00');
  const diffDays = Math.floor((prazo.getTime() - now.getTime()) / 86400000);
  if (diffDays < 0) return 'late';
  if (diffDays <= 2) return 'warn';
  return 'ok';
}

export function canMoveFaseOut(currentFase: string, nivel: ProducaoNivel): boolean {
  const faseInfo = FASES.find(f => f.key === currentFase);
  if (faseInfo?.revisao) return nivel === 'socio' || nivel === 'head';
  return true;
}

export function getAdjacentFases(tipo: CriativoTipo, currentFase: string) {
  const validKeys = FASES_POR_TIPO[tipo] ?? FASES.map(f => f.key);
  const idx = validKeys.indexOf(currentFase);
  return {
    prev: idx > 0 ? validKeys[idx - 1] : null,
    next: idx >= 0 && idx < validKeys.length - 1 ? validKeys[idx + 1] : null,
  };
}

export function formatFieldName(campo: string): string {
  const map: Record<string, string> = {
    nome: 'Nome', tipo: 'Tipo', fase: 'Fase', funil_id: 'Funil',
    responsavel_id: 'Responsável', formato: 'Formato', plataforma: 'Plataforma',
    tipo_teste: 'Tipo de Teste', nivel_consciencia: 'Nível de Consciência',
    angulo_teste: 'Ângulo de Teste', modulo: 'Módulo', ordem: 'Ordem',
    copy_url: 'Copy URL', video_gravado_url: 'Vídeo Gravado', data_inicio: 'Data',
    video_editado_url: 'Vídeo Editado', data_prazo: 'Prazo', notas: 'Notas',
  };
  return map[campo] ?? campo;
}
