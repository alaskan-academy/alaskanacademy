import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { BlocoMetricas } from '../metricas';
import { ListaMetricas, LinhaMetrica } from './ListaMetricas';

/**
 * O upsell ao lado do resultado do front, e nunca dentro dele.
 *
 * Somar o upsell esconde front doente: um funil com ROAS de front 1,00 e 10% de
 * adesão aparece saudável, e ninguém volta para consertar a página. Tirar o
 * upsell mata funil lucrativo: esse mesmo funil põe mais dinheiro no bolso que
 * um de ROAS 1,40 com 2% de adesão.
 *
 * Não é escolher o melhor dos dois — é que a pergunta é outra em cada caso.
 * "A página precisa de ajuste?" se responde só com o front, que é a superfície
 * onde se mexe. "Esse funil dá dinheiro?" se responde com o total, que é o que
 * entra no caixa. As duas ficam na tela, com nomes diferentes.
 *
 * E o que decide entre os dois exemplos não é nenhum ROAS isolado: é se o
 * FRONT SE PAGA. Por isso a frase no topo do bloco, que é a única leitura que
 * a tela faz sozinha em todo o módulo.
 */

const num2 = (n: number) => n.toFixed(2);
const pct  = (n: number) => `${n.toFixed(1)}%`;
const pct2 = (n: number) => `${n.toFixed(2)}%`;

export function BlocoUpsell({ a, ant }: { a: BlocoMetricas; ant: BlocoMetricas }) {
  // Sem upsell nos dois períodos o bloco inteiro seria cinco tracinhos.
  if (a.upsell_qtd === 0 && ant.upsell_qtd === 0) return null;

  const sustentadoPeloUp = a.front_se_paga === false;

  return (
    <div className="space-y-1.5">
      {a.front_se_paga != null && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
          sustentadoPeloUp
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300',
        )}>
          {sustentadoPeloUp
            ? <AlertTriangle className="h-4 w-4 mt-px shrink-0" />
            : <CheckCircle2 className="h-4 w-4 mt-px shrink-0" />}
          <span>
            {sustentadoPeloUp ? (
              <>
                <strong>O front não se paga.</strong> Quem sustenta este REV é o upsell
                {a.roas != null && a.roas_com_upsell != null &&
                  ` — ROAS ${num2(a.roas)} sobe para ${num2(a.roas_com_upsell)} com ele`}.{' '}
                {/* Dizer "o total pode estar no azul" quando ele está no
                    vermelho seria consolo falso — e o REV5 é exatamente esse
                    caso: 0,88 vira 0,97, ainda abaixo de 1. */}
                {a.lucro_com_upsell < 0
                  ? 'E nem com ele o REV fecha no azul: aqui o ajuste da página não é opção.'
                  : 'O total fecha no azul, mas a página ainda precisa de ajuste.'}
              </>
            ) : (
              <>
                <strong>O front se paga.</strong> O upsell aqui é lucro em cima
                {a.roas != null && a.roas_com_upsell != null &&
                  ` — ROAS ${num2(a.roas)} vira ${num2(a.roas_com_upsell)}`}.
              </>
            )}
            {/* Adesão, montante e quantidade NÃO se repetem aqui: estão nas
                três primeiras linhas do bloco logo abaixo. A frase é o
                veredito; o bloco é a evidência. */}
          </span>
        </div>
      )}

      <ListaMetricas
        titulo="Com upsell"
        // A ressalva precisa vir junto do número, toda vez: assinatura anual
        // contada numa quinzena é caixa, não economia recorrente.
        nota="assinatura anual — é caixa que entrou, não receita recorrente do período"
      >
        <LinhaMetrica
          rotulo="Adesão ao upsell" valor={a.upsell_adesao_pct} anterior={ant.upsell_adesao_pct}
          formato={pct2} destaque
          detalhe={`${a.upsell_qtd} de ${a.vendas} vendas do front`}
        />
        <LinhaMetrica
          rotulo="Faturamento do upsell" valor={a.upsell_faturamento} anterior={ant.upsell_faturamento}
          formato={formatCurrency}
        />
        <LinhaMetrica
          rotulo="ROAS com upsell" valor={a.roas_com_upsell} anterior={ant.roas_com_upsell}
          formato={num2}
          detalhe={a.roas != null ? `só front: ${num2(a.roas)}` : undefined}
        />
        <LinhaMetrica
          rotulo="Lucro com upsell" valor={a.lucro_com_upsell} anterior={ant.lucro_com_upsell}
          formato={formatCurrency} destaque
          detalhe={
            <>
              só front: {formatCurrency(a.lucro_liquido)}
              {a.margem_com_upsell_pct != null && ` · margem de ${pct(a.margem_com_upsell_pct)}`}
            </>
          }
        />
      </ListaMetricas>
    </div>
  );
}
