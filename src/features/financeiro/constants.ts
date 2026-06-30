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
