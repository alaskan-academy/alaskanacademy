export type ProducaoNivel = 'socio' | 'head' | 'membro';
export type CriativoTipo = 'criativo' | 'vsl' | 'aula';
export type StatusVeiculacao = 'rodando' | 'pausado' | 'encerrado';
export type AvaliacaoStatus = 'sem_dados' | 'validado' | 'nao_validado' | 'arquivado';

export interface Criativo {
  id: string;
  nome: string;
  tipo: CriativoTipo;
  fase: string;
  funil_id: string | null;
  funil_video: string | null;
  projeto_id: string | null;
  responsavel_id: string | null;       // editor
  editor_nome_historico: string | null;
  copy_id: string | null;
  gestor_id: string | null;
  formato: string | null;
  plataforma: string | null;
  tipo_teste: string | null;
  nivel_consciencia: string | null;
  angulo_teste: string | null;
  variacao_de: string | null;
  modulo: string | null;
  ordem: number | null;
  copy_url: string | null;
  video_gravado_url: string | null;
  video_editado_url: string | null;
  data_inicio: string | null;
  data_prazo: string | null;
  notas: string | null;
  status_veiculacao: StatusVeiculacao | null;
  avaliacao: AvaliacaoStatus | null;
  criado_em: string;
  atualizado_em: string;
  funil?: { id: string; nome: string; produto: string } | null;
  projeto?: { id: string; nome: string } | null;
  responsavel?: { id: string; nome: string } | null;
  copy?: { id: string; nome: string } | null;
  gestor?: { id: string; nome: string } | null;
}

export interface HistoricoEntry {
  id: string;
  tipo_alteracao: 'criacao' | 'fase' | 'campo';
  campo_alterado: string | null;
  valor_anterior: string | null;
  valor_novo: string | null;
  criado_em: string;
  usuario?: { nome: string } | null;
}

export interface FunilProducaoInfo {
  funil_id: string;
  descricao: string | null;
  links: Array<{ label: string; url: string }>;
  brand_guidelines_url: string | null;
  status_producao: 'em_construcao' | 'ativo' | 'pausado' | 'encerrado';
  notas: string | null;
}

export interface Perfil {
  id: string;
  nome: string;
  is_admin: boolean;
}

export interface Funil {
  id: string;
  nome: string;
  produto: string;
  ativo: boolean;
}

export interface Comentario {
  id: string;
  criativo_id: string;
  autor_id: string;
  texto: string;
  tipo: 'sistema' | 'comentario' | 'devolucao';
  resposta_a: string | null;
  criado_em: string;
  autor?: { nome: string } | null;
  respostas?: Comentario[];
}
