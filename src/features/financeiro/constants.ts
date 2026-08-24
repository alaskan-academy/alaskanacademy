export const CATEGORIAS = [
  // Receitas
  'Produtos',
  'Coprodução',
  'Serviços',
  'Marketplace',
  'Ofertas',
  'Receita Financeira',
  // Custos operacionais
  'Anúncios (Facebook ADs)',
  'Aplicativos e Ferramentas',
  'IAs',
  'WhatsApp',
  'Departamento Pessoal',
  'Freelancer',
  'Contabilidade',
  'Impostos e Tributos',
  'Jurídico',
  'Endereço Fiscal',
  'Cursos e Formações',
  'Meios de Pagamento',
  'Material de Escritório',
  'Eletrônicos',
  'Eventos',
  'Registros e Documentos',
  'Recarga e Chip',
  'Doações',
  'Outros',
  // Sócios
  'Pró-labore',
  'Retirada de Lucro',
  'Sócios',
  // Reserva
  'Reserva de Caixa',
  'Investimentos Futuros',
] as const;

export const CENTROS_CUSTO = [
  'Anúncios',
  'Cursos e Formações',
  'Funcionários',
  'Jurídico',
  'Outros',
  'Reserva de Caixa',
  'Sócios',
  'Softwares e Ferramentas',
] as const;

export type Categoria = typeof CATEGORIAS[number];
export type CentroCusto = typeof CENTROS_CUSTO[number];

/* ---------------------------------------------------------------------------
 * Como cada categoria entra no resultado.
 *
 * Vivia dentro do FinanceiroCaixaPage, em cópia local. O Fechamento não usava
 * essa classificação e chegava a outro número para o mesmo mês — em agosto/2026
 * a tela mostrava 57,1% de margem enquanto o extrato dizia 3,2%, porque ela
 * somava receita da Payt com custo do banco e ainda excluía anúncios.
 *
 * O Financeiro trabalha só com extrato bancário. Venda, atribuição e ROAS têm
 * outras telas; aqui é o que entrou e o que saiu da Conta Simples.
 * ------------------------------------------------------------------------- */

export const CAT_RECEITAS = [
  'Produtos', 'Coprodução', 'Serviços', 'Marketplace', 'Ofertas',
  'Receita Financeira', 'Expansão', 'Investimentos Futuros',
] as const;

/** Inclui anúncios: é a maior saída do mês e é custo como qualquer outro. */
export const CAT_CUSTOS_OPERACIONAIS = [
  'Anúncios (Facebook ADs)', 'Aplicativos e Ferramentas', 'IAs', 'WhatsApp',
  'Departamento Pessoal', 'Freelancer', 'Contabilidade', 'Impostos e Tributos',
  'Jurídico', 'Endereço Fiscal', 'Cursos e Formações', 'Meios de Pagamento',
  'Material de Escritório', 'Eletrônicos', 'Eventos', 'Registros e Documentos',
  'Recarga e Chip', 'Doações', 'Outros',
] as const;

/** Retirada e aporte de sócio não são custo operacional nem receita. */
export const CAT_SOCIOS = ['Pró-labore', 'Retirada de Lucro', 'Sócios'] as const;

/** Transferência entre contas próprias — não é resultado, é caixa mudando de lugar. */
export const CAT_RESERVA = ['Reserva de Caixa'] as const;

export const CAT_ANUNCIOS = 'Anúncios (Facebook ADs)';
