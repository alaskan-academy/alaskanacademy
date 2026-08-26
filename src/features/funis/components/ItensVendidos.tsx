import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

/**
 * O que este REV realmente vendeu de order bump e de upsell.
 *
 * Substitui duas listas de DIGITAR que existiam no cadastro do funil. Elas eram
 * gravadas em `funil_subofertas` e lidas só de volta no próprio formulário —
 * nenhuma tela, nenhum cálculo, nenhum relatório usava. Era trabalho que não
 * virava nada, e envelhecia: dos 36 order bumps digitados, 10 nunca venderam.
 *
 * Aqui os números vêm de `venda_itens` e das vendas com `is_upsell`. Ninguém
 * digita, e o que aparece é o que aconteceu.
 */

interface ItemVendido {
  slot?: string;
  nome: string;
  vendas: number;
  valor_medio: number;
  faturamento: number;
}

interface Props {
  funilId: string | null;
}

export function ItensVendidos({ funilId }: Props) {
  const [bumps, setBumps]     = useState<ItemVendido[]>([]);
  const [upsells, setUpsells] = useState<ItemVendido[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!funilId) { setCarregando(false); return; }
    let cancelado = false;
    (async () => {
      const [b, u] = await Promise.all([
        supabase.from('vw_rev_itens_vendidos')
          .select('slot,nome,vendas,valor_medio,faturamento')
          .eq('funil_id', funilId).eq('familia', 'orderbump')
          .order('vendas', { ascending: false }),
        supabase.from('vw_rev_upsells_vendidos')
          .select('nome,vendas,valor_medio,faturamento')
          .eq('funil_id', funilId)
          .order('vendas', { ascending: false }),
      ]);
      if (cancelado) return;
      setBumps((b.data ?? []) as ItemVendido[]);
      setUpsells((u.data ?? []) as ItemVendido[]);
      setCarregando(false);
    })();
    return () => { cancelado = true; };
  }, [funilId]);

  if (carregando) {
    return <p className="text-xs text-muted-foreground/60 italic">Carregando…</p>;
  }

  return (
    <div className="space-y-3">
      <Lista
        titulo="Order Bumps vendidos"
        itens={bumps}
        funilId={funilId}
        mostraSlot
      />
      <Lista
        titulo="Upsells vendidos"
        itens={upsells}
        funilId={funilId}
      />
    </div>
  );
}

function Lista({ titulo, itens, funilId, mostraSlot }: {
  titulo: string;
  itens: ItemVendido[];
  funilId: string | null;
  mostraSlot?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium">{titulo}</span>
        {itens.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {formatCurrency(itens.reduce((s, i) => s + Number(i.faturamento), 0))}
          </span>
        )}
      </div>

      {itens.length === 0 ? (
        // Vazio aqui tem duas causas com remédios diferentes, e confundi-las faz
        // alguém concluir que o REV não vende bump quando o problema é outro.
        <p className="text-xs text-muted-foreground/60 italic">
          {!funilId
            ? 'Salve o funil para ver o que ele vendeu.'
            : 'Nenhuma venda ligada a este REV ainda — atribua os checkouts na aba Checkouts.'}
        </p>
      ) : (
        <div className="space-y-1">
          {itens.map((i, idx) => (
            <div key={`${i.nome}-${i.slot ?? idx}`} className="flex items-baseline gap-2 text-xs">
              {mostraSlot && i.slot && (
                <span className="text-[10px] text-muted-foreground/70 font-mono shrink-0 w-8">
                  {i.slot.replace('orderbump_', 'OB')}
                </span>
              )}
              <span className="flex-1 truncate" title={i.nome}>{i.nome}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">
                {formatCurrency(Number(i.valor_medio))}
              </span>
              <span className="tabular-nums font-medium shrink-0 w-10 text-right">
                {i.vendas}×
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
