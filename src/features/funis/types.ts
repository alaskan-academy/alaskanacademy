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
  produto: string | null;
  ativo: boolean;
  status: 'ativo' | 'pausado' | 'arquivado';
  oferta_id: string | null;
  preco: number | null;
  link_checkout: string | null;
  metodo: string | null;
  notas: string | null;
  criado_em: string | null;
}

export interface FunilSuboferta {
  id: string;
  funil_id: string;
  oferta_id: string;
}

export interface Dominio {
  id: string;
  nome: string;
  funil_id: string | null;
  ativo: boolean;
  vencimento: string | null;
  registrador: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export interface TesteFunil {
  id: string;
  funil_id: string;
  titulo: string;
  tipo: 'funil_novo' | 'ab_interno';
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
}

export type StatusDisplay = 'ativo' | 'em_teste' | 'pausado' | 'arquivado';

export function getStatusDisplay(funil: Funil, testes: TesteFunil[]): StatusDisplay {
  const emTeste = testes.some(
    t => t.funil_id === funil.id && t.tipo === 'funil_novo' && !t.data_fim,
  );
  if (emTeste) return 'em_teste';
  return funil.status ?? 'ativo';
}

export function daysUntilExpiry(vencimento: string | null): number | null {
  if (!vencimento) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(vencimento + 'T00:00:00');
  return Math.floor((expiry.getTime() - today.getTime()) / 86_400_000);
}
