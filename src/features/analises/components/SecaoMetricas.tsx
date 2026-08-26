import { ReactNode } from 'react';

/**
 * Um grupo de métricas com título.
 *
 * Existe porque 24 cartões numa grade única não têm ordem de leitura: o olho
 * não sabe onde começa nem o que se compara com o quê. Os grupos seguem o
 * caminho do dinheiro — o resultado primeiro (é o veredito), depois venda,
 * tráfego, conversão etapa a etapa, e por fim os custos que explicam o
 * resultado do topo.
 */

interface Props {
  titulo: string;
  /** Ressalva que vale para o grupo inteiro, não para um cartão só. */
  nota?: ReactNode;
  children: ReactNode;
}

export function SecaoMetricas({ titulo, nota, children }: Props) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {titulo}
        </h3>
        <div className="h-px flex-1 min-w-4 bg-border" />
        {nota && <span className="text-[10px] text-muted-foreground/80">{nota}</span>}
      </div>
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}
