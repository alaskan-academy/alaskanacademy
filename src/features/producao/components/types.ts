export type ProducaoNivel = 'socio' | 'head' | 'membro';
export type CriativoTipo = 'criativo' | 'vsl' | 'aula';
export type StatusVeiculacao = 'Rodando' | 'Pausado' | 'Encerrado' | 'Bloqueado' | 'Arquivado';
export type AvaliacaoStatus = 'sem_dados' | 'validado' | 'nao_validado';

export interface Criativo {
  id: string;
  nome: string;
  tipo: CriativoTipo;
  fase: string;
  /* `funil_id` e `funil_ids` sairam em 21/09/2026: os dois estavam vazios em
     4.098 de 4.098 cards, e os filtros que liam deles esvaziavam a tela sem
     erro nenhum. De qual REV o criativo veio agora sai de `vw_criativo_funil`,
     derivado da venda. Ver a migracao 20260921c. */
  /** TSL / VSL / QUIZ. E METODO, nao funil — o nome e divida antiga. */
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
  video_story_url: string | null;
  data_inicio: string | null;
  data_prazo: string | null;
  notas: string | null;
  status_veiculacao: string | null;
  avaliacao: string | null;
  criado_em: string;
  atualizado_em: string;
  /**
   * VESTIGIAL: hoje sempre `undefined`.
   *
   * Vinha do embed `funil:funis(...)`, que só existia por causa da chave
   * estrangeira de `producoes.funil_id` — coluna apagada em 21/09/2026 porque
   * estava vazia em 4.098 de 4.098 linhas. O embed já devolvia `null` em toda
   * linha antes disso; quando a coluna caiu, a chave caiu junto e o PostgREST
   * passou a recusar a consulta inteira, derrubando cinco telas.
   *
   * O campo continua no tipo, opcional, porque `CriativoCard.tsx` lê
   * `criativo.funil?.nome` e é um arquivo não commitado — tirar daqui quebraria
   * trabalho que ainda não está no git. Sai junto com o rename de
   * `funil_video` para `metodo_video`, quando aquele arquivo entrar.
   */
  funil?: { id: string; nome: string; produto: string } | null;
  projeto?: { id: string; nome: string } | null;
  responsavel?: { id: string; nome: string } | null;
  copy?: { id: string; nome: string } | null;
  gestor?: { id: string; nome: string } | null;
  especialista_id?: string | null;
  especialista?: { id: string; nome: string } | null;
}

export interface HistoricoEntry {
  id: string;
  tipo_alteracao: 'criacao' | 'fase' | 'campo';
  campo_alterado: string | null;
  valor_anterior: string | null;
  valor_novo: string | null;
  /** Por que este movimento aconteceu, quando a fase de destino exige. */
  motivo: string | null;
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
