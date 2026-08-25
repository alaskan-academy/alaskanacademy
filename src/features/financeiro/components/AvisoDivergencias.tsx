import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronDown, ChevronRight, Check, X } from 'lucide-react';

/**
 * Onde uma categoria confirmada discorda da Conta Simples, e o que fazer.
 *
 * "Confirmado" é intocável pela recategorização, e isso é certo — o que passou
 * por olho humano não deve ser sobrescrito por regra. O efeito colateral é que
 * um erro confirmado fica congelado e invisível: as 682 transações de dezembro
 * a junho nunca passaram pela lógica nova.
 *
 * O bloco não decide nada sozinho, de propósito. Nem sempre o CS está certo: as
 * transferências ALASKAN ACADEMY estão lá como "Retirada de Lucro" e são Reserva
 * de Caixa, e foi ela quem soube disso. Por isso cada grupo tem os dois botões —
 * aplicar o que o CS diz, ou marcar que o nosso está certo e parar de perguntar.
 */

interface Divergencia {
  id: string;
  data: string;
  descricao: string;
  fornecedor: string;
  valor: number;
  categoria_dash: string;
  categoria_cs: string;
}

interface Grupo {
  de: string;
  para: string;
  itens: Divergencia[];
  total: number;
}

export function AvisoDivergencias() {
  const [linhas, setLinhas] = useState<Divergencia[]>([]);
  const [aberto, setAberto] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from('vw_divergencias_confirmadas')
      .select('id, data, descricao, fornecedor, valor, categoria_dash, categoria_cs');
    setLinhas(((data ?? []) as Divergencia[]).map(d => ({ ...d, valor: Number(d.valor) })));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, Grupo>();
    for (const d of linhas) {
      const chave = `${d.categoria_dash}→${d.categoria_cs}`;
      const g = mapa.get(chave) ?? { de: d.categoria_dash, para: d.categoria_cs, itens: [], total: 0 };
      g.itens.push(d);
      g.total += Math.abs(d.valor);
      mapa.set(chave, g);
    }
    return Array.from(mapa.entries())
      .map(([chave, g]) => ({ chave, ...g }))
      .sort((a, b) => b.total - a.total);
  }, [linhas]);

  /** Passa o grupo inteiro para a categoria do CS, arrastando o centro junto. */
  async function aplicarCS(grupo: Grupo & { chave: string }) {
    setAplicando(grupo.chave);
    try {
      const { data: destino } = await supabase
        .from('categorias_centro')
        .select('centro_custo')
        .eq('categoria', grupo.para)
        .maybeSingle();

      const ids = grupo.itens.map(i => i.id);
      const { error } = await supabase
        .from('transacoes')
        .update({
          categoria: grupo.para,
          // Sem arrastar o centro, a categoria mudaria e a linha continuaria
          // somando no centro antigo — a matriz de custos ficaria incoerente.
          centro_custo: destino?.centro_custo ?? null,
        })
        .in('id', ids);

      if (error) throw error;
      toast({
        title: 'Aplicado',
        description: `${ids.length} ${ids.length === 1 ? 'transação passou' : 'transações passaram'} para "${grupo.para}"`,
      });
      await carregar();
    } catch (err) {
      toast({
        title: 'Não consegui aplicar',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setAplicando(null);
    }
  }

  /** Marca o nome do CS como grosso: ele para de ser tratado como verdade e a
   *  divergência some da lista sem que nada mude nos lançamentos. É o caminho
   *  para o caso ALASKAN ACADEMY, em que o errado é o CS. */
  async function manterNosso(grupo: Grupo & { chave: string }) {
    setAplicando(grupo.chave);
    const { error } = await supabase
      .from('categorias_mapa')
      .update({
        preciso: false,
        observacao: `Marcado como impreciso na revisão: o CS chama de "${grupo.para}" o que aqui é "${grupo.de}".`,
      })
      .eq('categoria', grupo.para);

    if (error) toast({ title: 'Não consegui salvar', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Anotado', description: `"${grupo.para}" do CS deixa de valer como categoria` });
      await carregar();
    }
    setAplicando(null);
  }

  if (grupos.length === 0) return null;

  const total = linhas.length;

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <span className="flex-1 text-xs">
          <span className="font-medium text-amber-200">
            {total} {total === 1 ? 'transação confirmada discorda' : 'transações confirmadas discordam'} da Conta Simples
          </span>
          <span className="mt-0.5 block text-amber-200/70">
            Confirmado não é mais recategorizado, então um erro aqui fica congelado. Abra para
            decidir caso a caso.
          </span>
        </span>
        {aberto
          ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/70" />
          : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/70" />}
      </button>

      {aberto && (
        <ul className="mt-2.5 space-y-1.5 border-t border-amber-500/20 pt-2.5">
          {grupos.map(g => {
            const abertoAqui = expandido === g.chave;
            return (
              <li key={g.chave} className="rounded border border-amber-500/20 bg-background/30">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setExpandido(abertoAqui ? null : g.chave)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    {abertoAqui
                      ? <ChevronDown className="h-3 w-3 shrink-0 text-amber-400/70" />
                      : <ChevronRight className="h-3 w-3 shrink-0 text-amber-400/70" />}
                    <span className="truncate text-amber-200/90">{g.de}</span>
                    <span className="shrink-0 text-amber-200/50">→</span>
                    <span className="truncate text-amber-200/90">{g.para}</span>
                  </button>

                  <span className="shrink-0 tabular-nums text-amber-200/70 whitespace-nowrap">
                    {g.itens.length} · {formatCurrency(g.total)}
                  </span>

                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => aplicarCS(g)}
                      disabled={aplicando === g.chave}
                      className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-1.5 py-0.5 text-[11px] text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
                      title={`Passar as ${g.itens.length} para "${g.para}"`}
                    >
                      <Check className="h-3 w-3" />
                      usar o CS
                    </button>
                    <button
                      type="button"
                      onClick={() => manterNosso(g)}
                      disabled={aplicando === g.chave}
                      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      title={`Manter "${g.de}" e parar de comparar com este nome do CS`}
                    >
                      <X className="h-3 w-3" />
                      manter
                    </button>
                  </span>
                </div>

                {abertoAqui && (
                  <ul className="border-t border-amber-500/20 px-2 py-1.5">
                    {g.itens.map(i => (
                      <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-[11px]">
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {i.data.split('-').reverse().join('/')}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground" title={i.descricao}>
                          {i.fornecedor}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatCurrency(Math.abs(i.valor))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
