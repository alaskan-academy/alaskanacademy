import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';

/**
 * O funil de uma campanha, conjunto ou anúncio — impressões até vendas.
 *
 * Veio da página Funil, que foi apagada. Ela tinha 15 colunas por campanha e
 * as 15 já existiam no Meta Ads, com mais companhia; a única coisa própria era
 * este desenho, e ele nunca precisou de página: precisa da linha a que se
 * refere. Aqui ele abre embaixo dela.
 *
 * Os números são os do Meta, os mesmos da linha de cima — não há uma segunda
 * fonte silenciosa por trás. A página antiga tentava casar as vendas reais da
 * Payt por `utm_campaign` e, em agosto, não enxergava 40% do faturamento; um
 * desenho que mostra zero para campanha que vendeu é pior que desenho nenhum.
 */
export function FunilDaLinha({
  impressoes, cliques, visualizacoes_pagina, initiate_checkout, compras_meta,
}: {
  impressoes: number;
  cliques: number;
  visualizacoes_pagina: number;
  initiate_checkout: number;
  compras_meta: number;
}) {
  const etapas = [
    { rotulo: 'Impressões',   valor: impressoes,           cor: 'bg-primary/70' },
    { rotulo: 'Cliques',      valor: cliques,              cor: 'bg-primary/60' },
    { rotulo: 'Vis. de pág.', valor: visualizacoes_pagina, cor: 'bg-primary/50' },
    { rotulo: 'ICs',          valor: initiate_checkout,    cor: 'bg-primary/40' },
    { rotulo: 'Vendas',       valor: compras_meta,         cor: 'bg-success/70' },
  ];

  const topo = Math.max(...etapas.map(e => e.valor), 1);

  if (topo <= 1) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">Sem entregas no período.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      {etapas.map((e, i) => {
        const anterior = i > 0 ? etapas[i - 1].valor : 0;
        // A queda de uma etapa para a outra é o que se procura num funil: onde
        // some a maior parte das pessoas. Sem ela, são cinco números soltos.
        const queda = i > 0 && anterior > 0 ? (e.valor / anterior) * 100 : null;

        return (
          <div key={e.rotulo} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{e.rotulo}</span>

            <div className="h-4 min-w-0 flex-1 rounded bg-muted/40">
              <div
                className={cn('h-full rounded transition-all', e.cor)}
                style={{ width: `${Math.max((e.valor / topo) * 100, e.valor > 0 ? 1.5 : 0)}%` }}
              />
            </div>

            {/*
              Número e queda na mesma coluna.

              Em colunas separadas a linha ficava larga demais para caber na
              parte visível de uma tabela que rola de lado — e a queda, que é o
              que se procura num funil, era justamente a que saía da tela.
            */}
            <span className="w-28 shrink-0 text-right text-xs tabular-nums text-foreground">
              {formatNumber(e.valor)}
              {queda !== null && (
                <span className="ml-1.5 text-[11px] text-muted-foreground">{queda.toFixed(1)}%</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
