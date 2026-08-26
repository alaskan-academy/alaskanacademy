export interface Projeto {
  id: string;
  nome: string;
  empresa_id: string | null;
  ativo: boolean;
}

export interface SubOferta {
  id: string;
  nome: string;
  tipo: string;
}

export interface Funil {
  id: string;
  nome: string;
  /** Derivado do nome do projeto pelo banco; não editar direto. */
  produto: string | null;
  /** @deprecated Derivado de `status`. Ler `status` — este campo só existe até
   *  o código que faz `.eq('ativo', true)` migrar. */
  ativo: boolean;
  status: 'planejado' | 'ativo' | 'pausado' | 'pausado_analise' | 'arquivado';
  /** Projeto (`ofertas_editores`) dono deste REV. */
  projeto_id: string | null;
  /** @deprecated Nome antigo de `projeto_id`; o banco mantém os dois iguais. */
  oferta_id: string | null;
  /** Player do VTurb que roda neste REV. */
  vsl_id: string | null;
  preco: number | null;
  link_checkout: string | null;
  url_page: string | null;
  metodo: string | null;
  notas: string | null;
  criado_em: string | null;
  criado_por: string | null;
}

export interface PerfilSimples {
  id: string;
  nome: string;
}

export interface FunilSuboferta {
  id: string;
  funil_id: string;
  oferta_id: string | null;
  nome: string | null;
  tipo: string | null;
  preco: number | null;
  link: string | null;
}

export interface Dominio {
  id: string;
  nome: string;
  funil_id: string | null;
  funil_ids: string[];
  ativo: boolean;
  vencimento: string | null;
  registrador: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export type PipelineStatus = 'planejado' | 'produzindo' | 'pronto_para_teste' | 'rodando' | 'concluido';
export type CategoriaTest = string;
export type ImpactoTest = 'alto' | 'medio' | 'baixo';
export type DificuldadeTest = 'facil' | 'media' | 'dificil';

/** Um lado de um teste A/B, como o VTurb devolve. */
export interface LadoVturb {
  player_id: string;
  vsl: string;
  views: number;
  plays: number;
  conversoes: number;
  faturamento_brl: number;
  /** Guardada junto do numerador e do denominador, para dar para conferir. */
  taxa_conversao: number | null;
}

export interface MetricasVturb {
  sincronizado_em: string;
  lados: LadoVturb[];
}

export interface TesteFunil {
  id: string;
  funil_id: string | null;
  funil_ids: string[] | null;
  titulo: string;
  tipo: 'funil_novo' | 'ab_interno' | 'ad';
  variante_a: string | null;
  variante_b: string | null;
  metrica: string | null;
  resultado_a: string | null;
  resultado_b: string | null;
  vencedor: 'a' | 'b' | 'inconclusivo' | null;
  validado: boolean;
  data_inicio: string | null;
  data_fim: string | null;
  notas: string | null;
  created_at: string;
  // Esteira
  pipeline_status: PipelineStatus;
  categoria: CategoriaTest | null;
  impacto: ImpactoTest | null;
  dificuldade: DificuldadeTest | null;
  kpi: string | null;
  link_ad: string | null;
  comentario_ad: string | null;
  nome_ad: string | null;
  data_prevista: string | null;
  // Vindo do VTurb
  /** Id do comparison group. Presente só nos testes sincronizados de lá. */
  vturb_comparison_id: string | null;
  /** Retrato dos números dos dois lados no momento da sincronização. */
  metricas_vturb: MetricasVturb | null;

  // Sync Radar
  radar_teste_id: string | null;
  criado_por: string | null;
  arquivado: boolean;
}

export type StatusDisplay = 'planejado' | 'ativo' | 'em_teste' | 'pausado' | 'pausado_analise' | 'arquivado';

/**
 * A VSL só é obrigatória em REV de VSL.
 *
 * Num funil de TSL a venda é feita por texto: a VSL, se existir, é acessório —
 * cobrar por ela ali é ruído. Antes o aviso contava qualquer REV sem VSL, e dos
 * 3 que apontava, 2 eram TSL e 1 estava sem método definido: **nenhum era
 * problema de verdade**, e um aviso que aponta só falso positivo é pior que
 * nenhum aviso, porque ensina a ignorar.
 *
 * Sem `metodo` definido, NÃO cobra. Deixar de avisar num caso indefinido custa
 * menos que avisar errado — o REV recém-criado costuma estar nesse estado, e
 * seria cobrado antes de a pessoa terminar de preenchê-lo.
 */
export function vslEhObrigatoria(funil: Pick<Funil, 'metodo'>): boolean {
  return (funil.metodo ?? '').trim().toUpperCase() === 'VSL';
}

export function getStatusDisplay(funil: Funil, testes: TesteFunil[]): StatusDisplay {
  // Pausado sempre tem prioridade — mesmo que um teste ainda esteja marcado como rodando
  if (funil.status === 'pausado_analise' || funil.status === 'pausado') return funil.status;
  const emTeste = testes.some(
    t => (t.funil_id === funil.id || t.funil_ids?.includes(funil.id)) && t.pipeline_status === 'rodando',
  );
  if (emTeste) return 'em_teste';
  return (funil.status ?? 'ativo') as StatusDisplay;
}


export function daysUntilExpiry(vencimento: string | null): number | null {
  if (!vencimento) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(vencimento + 'T00:00:00');
  return Math.floor((expiry.getTime() - today.getTime()) / 86_400_000);
}
