import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { AlertTriangle, AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Alerta {
  codigo: string;
  severidade: 'critico' | 'atencao';
  titulo: string;
  detalhe: string;
  area: string;
}

/**
 * Alertas de saúde e coerência dos dados, na tela onde se resolvem.
 *
 * Existe porque todo defeito encontrado até aqui produziu um número plausível: três
 * fontes paradas por meses, conversões do Meta somadas oito vezes, metade do gasto
 * invisível, juros contados como receita. Nada disso pareceu erro na tela — o
 * dashboard estava confiantemente errado, que é pior que estar quebrado.
 *
 * As checagens ficam em `vw_alertas`, no banco, e não aqui: assim valem para qualquer
 * consumidor dos dados e podem ser conferidas por SQL. Não renderiza nada quando está
 * tudo em ordem.
 *
 * Dois recortes, os dois pedidos por ela depois de ver "1 venda sem categoria de
 * produto" no Financeiro:
 *
 *   por área — o banner mostrava os 13 alertas em TODAS as páginas, e o efeito
 *   era o oposto do pretendido: quem está no Financeiro, onde não há nada a
 *   fazer sobre uma venda, aprende a ignorar a faixa amarela — inclusive quando
 *   ela for sobre o Financeiro.
 *
 *   por permissão — falam de receita, gasto e falha de integração. Para quem não
 *   pode agir é ruído com cara de problema, e ainda expõe número que não é da
 *   conta de todo mundo.
 */

/** Primeiro segmento da rota é a área. '/' é o Início, que recebe também tudo
 *  que não foi mapeado — saúde do sistema não é de ninguém em particular. */
function areaDaRota(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)[0];
  return seg ?? 'inicio';
}

export function IngestStatusBanner() {
  const [todos, setTodos] = useState<Alerta[]>([]);
  const [aberto, setAberto] = useState(false);
  const { pathname } = useLocation();
  const { perfil } = useAuth();

  const podeVer = perfil?.is_admin === true;

  useEffect(() => {
    let ativo = true;
    if (!podeVer) { setTodos([]); return; }

    const carregar = async () => {
      const { data } = await supabase
        .from('vw_alertas_por_area')
        .select('codigo, severidade, titulo, detalhe, area');
      if (ativo) setTodos((data as Alerta[]) ?? []);
    };

    carregar();
    const intervalo = setInterval(carregar, 5 * 60 * 1000);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [podeVer]);

  const alertas = useMemo(
    () => todos.filter(a => a.area === areaDaRota(pathname)),
    [todos, pathname],
  );

  if (alertas.length === 0) return null;

  const criticos = alertas.filter(a => a.severidade === 'critico');
  const grave = criticos.length > 0;
  // Um alerta se explica sozinho; vários viram lista fechada para não empurrar o
  // conteúdo da página para baixo todo dia.
  const expandido = aberto || alertas.length === 1;

  return (
    <div
      className={cn(
        'mb-4 rounded-lg border',
        grave ? 'border-destructive/40 bg-destructive/10' : 'border-amber-500/30 bg-amber-500/10',
      )}
    >
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        disabled={alertas.length === 1}
        className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left"
      >
        {grave ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        )}

        <div className="min-w-0 flex-1 text-xs">
          <p className={cn('font-medium', grave ? 'text-destructive' : 'text-amber-200')}>
            {alertas.length === 1
              ? alertas[0].titulo
              : `${alertas.length} avisos sobre os dados${criticos.length > 0 ? ` · ${criticos.length} crítico${criticos.length > 1 ? 's' : ''}` : ''}`}
          </p>
          {alertas.length === 1 && (
            <p className={cn('mt-0.5', grave ? 'text-destructive/80' : 'text-amber-200/70')}>
              {alertas[0].detalhe}
            </p>
          )}
        </div>

        {alertas.length > 1 && (
          <ChevronDown
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0 transition-transform',
              grave ? 'text-destructive' : 'text-amber-400',
              aberto && 'rotate-180',
            )}
          />
        )}
      </button>

      {expandido && alertas.length > 1 && (
        <ul className="space-y-2 border-t border-border/30 px-3.5 py-2.5 text-xs">
          {alertas.map(a => (
            <li key={a.codigo} className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  a.severidade === 'critico' ? 'bg-destructive' : 'bg-amber-400',
                )}
              />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{a.titulo}</p>
                <p className="mt-0.5 text-muted-foreground">{a.detalhe}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
