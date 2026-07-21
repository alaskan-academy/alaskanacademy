import type { ProducaoNivel, CriativoTipo } from './types';

export type FaseItem = {
  key: string;
  label: string;
  revisao?: true;
};

export const FASES: FaseItem[] = [
  { key: 'producao_copy',  label: 'Produção Copy'    },
  { key: 'revisao_copy',   label: 'Revisão Copy',    revisao: true },
  { key: 'gravacao',       label: 'Gravação'         },
  { key: 'edicao',         label: 'Edição'           },
  { key: 'revisao_edicao', label: 'Revisão Edição',  revisao: true },
  { key: 'alteracao',      label: 'Alteração'        },
  { key: 'aprovado',       label: 'Aprovado'         },
  { key: 'esteira_teste',  label: 'Esteira de Teste' },
  { key: 'postado',        label: 'Postado'          },
  { key: 'na_plataforma',  label: 'Na Plataforma'   },
];

export const FASES_MAP: Record<string, string> = {
  ...Object.fromEntries(FASES.map(f => [f.key, f.label])),
  // chaves legadas para retrocompatibilidade com dados existentes
  programado:         'Programado',
  gravacao_concluida: 'Gravação Concluída',
};

export const FASES_POR_TIPO: Record<CriativoTipo, string[]> = {
  criativo: ['producao_copy','revisao_copy','gravacao','edicao','revisao_edicao','alteracao','aprovado','esteira_teste','postado'],
  vsl:      ['producao_copy','revisao_copy','gravacao','edicao','revisao_edicao','alteracao','aprovado','esteira_teste','postado'],
  aula:     ['gravacao','edicao','revisao_edicao','alteracao','aprovado','na_plataforma'],
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
};

export const AVALIACAO_LABEL: Record<string, string> = {
  sem_dados:    'Sem dados',
  validado:     'Validado',
  nao_validado: 'Não validado',
  arquivado:    'Arquivado',
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

export function getUrgency(data_prazo: string | null): 'ok' | 'warn' | 'late' | null {
  if (!data_prazo) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const prazo = new Date(data_prazo + 'T00:00:00');
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
    copy_url: 'Copy URL', video_gravado_url: 'Vídeo Gravado',
    video_editado_url: 'Vídeo Editado', data_prazo: 'Prazo', notas: 'Notas',
  };
  return map[campo] ?? campo;
}
