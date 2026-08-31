import { cn } from '@/lib/utils';
import type { CriativoTipo } from './types';
import { TIPOS_LABEL, TIPO_COR } from './constants';

/**
 * A etiqueta de tipo — Criativo, VSL, Aula.
 *
 * Morava em `CriativoCard.tsx`, que foi apagado em 31/08/2026 junto com o
 * Kanban: o card era renderizado só por ele, e sumiu do produto quando a
 * Produção virou abas em julho. Este badge era a única parte ainda viva do
 * arquivo — o drawer o usa no cabeçalho.
 *
 * Ele veio para um arquivo com o próprio nome porque `CriativoCard.tsx` sem
 * `CriativoCard` dentro é o tipo de coisa que faz alguém procurar um componente
 * que não existe mais.
 */
export function TipoBadge({ tipo }: { tipo: string }) {
  return (
    <span className={cn(
      'text-[10px] font-semibold px-1.5 py-0.5 rounded border',
      TIPO_COR[tipo] ?? 'bg-muted text-muted-foreground border-transparent',
    )}>
      {TIPOS_LABEL[tipo as CriativoTipo] ?? tipo}
    </span>
  );
}
