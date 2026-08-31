import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';

/**
 * Os projetos da empresa em foco — para recortar Produção, Criativos e Copy.
 *
 * POR QUE AQUI A EMPRESA É DERIVADA, E NÃO CARIMBADA
 *
 * Dinheiro carrega `empresa_id` na própria linha, carimbado quando nasce, para
 * o passado nunca mudar de dono. Trabalho é o contrário: quando o Desafios
 * virar Aeliss, os 289 cards dele têm de virar junto — quem editou o vídeo não
 * mudou, mas a empresa dona daquele trabalho mudou.
 *
 * Por isso a empresa do card vem do PROJETO, sempre lida agora. Um
 * `empresa_id` em `producoes` seria um espelho precisando de gatilho, e a
 * quarta armadilha do CLAUDE.md diz o que acontece com espelho sem gatilho.
 *
 * O QUE O RETORNO SIGNIFICA
 *
 *   undefined  ainda não sei — quem chama deve ESPERAR, não consultar
 *   null       "Ambas": sem filtro
 *   string[]   só estes projetos
 *
 * O `undefined` existe para evitar a piscada: sem ele, a primeira busca sairia
 * sem filtro e a tela mostraria as duas empresas por um instante antes de se
 * corrigir — e num painel de produção esse instante é o suficiente para alguém
 * arrastar o card errado.
 *
 * CARD SEM PROJETO SOME QUANDO HÁ EMPRESA ESCOLHIDA
 *
 * São 11 de 3.972 (0,28%). Card sem projeto não tem empresa, e mostrá-lo dentro
 * de uma seria inventar um dono. Ele continua visível em "Ambas", que é onde
 * ele deve ser notado e corrigido.
 */
export function useProjetosDaEmpresa(): string[] | null | undefined {
  const { empresaId } = useFilters();
  const [ids, setIds] = useState<string[] | null | undefined>(
    // Sem empresa escolhida a resposta já é final: não há o que esperar.
    empresaId ? undefined : null,
  );

  useEffect(() => {
    if (!empresaId) { setIds(null); return; }

    let vivo = true;
    setIds(undefined);

    supabase
      .from('ofertas_editores')
      .select('id')
      .eq('empresa_id', empresaId)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          console.error('projetos da empresa:', error.message);
          // Lista vazia, e não "sem filtro": falhar mostrando a empresa errada
          // é pior do que falhar mostrando nada, porque o vazio se percebe.
          setIds([]);
          return;
        }
        setIds((data ?? []).map(p => p.id as string));
      });

    return () => { vivo = false; };
  }, [empresaId]);

  return ids;
}
