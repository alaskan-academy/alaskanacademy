import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

/**
 * Diz o que a tela está fazendo com as transações ainda não revisadas.
 *
 * O Fechamento soma tudo; o Caixa & DRE só conta `confirmado` e `revisado`.
 * As duas leituras são defensáveis — o fechamento quer o retrato completo, o
 * DRE quer só o que passou por olho humano —, mas até aqui nenhuma das duas
 * dizia qual estava usando. O mesmo mês aparecia com números diferentes em
 * telas vizinhas e ninguém conseguia explicar a diferença.
 *
 * Não muda conta nenhuma: só torna a escolha visível, e some quando não há
 * pendência — aviso que aparece sempre vira moldura e ninguém lê.
 */
export function AvisoRevisao({
  inicio, fim, modo,
}: {
  inicio: string;
  fim: string;
  /** `inclui` = os números abaixo já contam as pendentes. `exclui` = não contam. */
  modo: 'inclui' | 'exclui';
}) {
  const navigate = useNavigate();
  const [qtd, setQtd] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let vivo = true;
    // Conta, não soma. A primeira versão somava o valor absoluto das pendentes e
    // exibia "R$ 263.188,85" ao lado de "total de custos R$ 42.488,41" — número
    // maior que a tela inteira, porque juntava entrada com saída e incluía
    // movimentação que não é custo. Parecia contradição e não ajudava ninguém.
    // "187 de 187" diz na hora o tamanho do problema.
    Promise.all([
      supabase
        .from('transacoes')
        .select('id', { count: 'exact', head: true })
        .gte('data', inicio).lte('data', fim)
        .in('status_revisao', ['pendente', 'auto_categorizado']),
      supabase
        .from('transacoes')
        .select('id', { count: 'exact', head: true })
        .gte('data', inicio).lte('data', fim),
    ]).then(([r1, r2]) => {
      if (!vivo) return;
      setQtd(r1.count ?? 0);
      setTotal(r2.count ?? 0);
    });
    return () => { vivo = false; };
  }, [inicio, fim]);

  if (qtd === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/financeiro/revisao')}
      className={cn(
        'mb-4 flex w-full items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left',
        'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/[0.14] transition-colors',
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <span className="text-xs">
        <span className="font-medium text-amber-200">
          {qtd === total
            ? `Nenhuma das ${total} transações do período foi revisada`
            : `${qtd} de ${total} transações do período ainda não foram revisadas`}
        </span>
        <span className="mt-0.5 block text-amber-200/70">
          {modo === 'inclui'
            ? 'Os números abaixo já contam com elas. O Caixa & DRE não conta — por isso os dois podem divergir até a revisão terminar.'
            : 'Os números abaixo não contam com elas. O Fechamento conta — por isso os dois podem divergir até a revisão terminar.'}
          {' '}Ir para a Revisão.
        </span>
      </span>
    </button>
  );
}
