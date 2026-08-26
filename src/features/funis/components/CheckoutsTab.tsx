import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';
import { Funil, Projeto } from '../types';

/**
 * Atribui cada checkout visto nas vendas ao REV que ele atendia.
 *
 * É a tela que faz `vendas.funil_id` existir — hoje está preenchido em 0 de
 * 13.552 linhas, e sem ele nenhuma métrica por REV é possível.
 *
 * O trabalho é CONFIRMAR, não digitar: a URL, o título, quantas vendas e o
 * período já vêm do webhook da Payt. Ela escolhe o REV, ou marca que aquilo não
 * é funil.
 *
 * A ordem por volume não é estética. A distribuição é muito concentrada — os 5
 * primeiros cobrem 55,7% das vendas e os 30 primeiros cobrem 95,2% —, então a
 * tela precisa deixar claro que parar no meio já resolve quase tudo. É por isso
 * que existe a barra de progresso por VENDAS, e não por número de checkouts:
 * "12 de 97" desanima e mente; "74% das vendas" é a verdade.
 */

interface Linha {
  id: string;
  url: string;
  titulo: string | null;
  funil_id: string | null;
  eh_funil: boolean | null;
  rev_nome: string | null;
  projeto_nome: string | null;
  vendas: number | null;
  vendas_pendentes: number | null;
  primeira_venda: string | null;
  ultima_venda: string | null;
  rev_no_titulo: string | null;
}

type Filtro = 'pendentes' | 'atribuidos' | 'nao_funil' | 'todos';

const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'pendentes',  label: 'A confirmar' },
  { key: 'atribuidos', label: 'Atribuídos' },
  { key: 'nao_funil',  label: 'Não são funil' },
  { key: 'todos',      label: 'Todos' },
];

/** `2026-05-21` → `21/05`. Ano fica de fora: todas as vendas são de 2026. */
function dataCurta(iso: string | null): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

interface Props {
  funis: Funil[];
  projetos: Projeto[];
}

export function CheckoutsTab({ funis, projetos }: Props) {
  const [linhas, setLinhas]   = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro]   = useState<Filtro>('pendentes');
  const [busca, setBusca]     = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);
  const [atribuindo, setAtribuindo] = useState(false);
  const [vendasLigadas, setVendasLigadas] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const [c, v] = await Promise.all([
      supabase.from('vw_checkouts_a_confirmar').select('*'),
      // `aprovada` também aqui: a atribuição vale para toda venda, mas o
      // contador precisa falar a mesma língua da coluna ao lado.
      supabase.from('vendas').select('id', { count: 'exact', head: true })
        .not('funil_id', 'is', null).eq('status', 'aprovada'),
    ]);
    if (c.error) {
      toast({ title: 'Erro ao carregar checkouts', description: c.error.message, variant: 'destructive' });
    }
    setLinhas(((c.data ?? []) as Linha[]).slice().sort((a, b) => (b.vendas ?? 0) - (a.vendas ?? 0)));
    setVendasLigadas(v.count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const projetoDoFunil = useMemo(() => {
    const porId: Record<string, string> = {};
    for (const p of projetos) porId[p.id] = p.nome;
    return (f: Funil) => (f.projeto_id ? porId[f.projeto_id] : null);
  }, [projetos]);

  // Agrupa os REVs por projeto no seletor. Sem isso são 23 linhas de "REV1",
  // "REV2", "REV3" repetidas entre produtos — os nomes se repetem, e é
  // impossível saber qual é qual.
  const funisOrdenados = useMemo(() => {
    return funis.slice().sort((a, b) => {
      const pa = projetoDoFunil(a) ?? 'zzz';
      const pb = projetoDoFunil(b) ?? 'zzz';
      return pa.localeCompare(pb) || a.nome.localeCompare(b.nome);
    });
  }, [funis, projetoDoFunil]);

  async function definir(linha: Linha, valor: string) {
    setSalvando(linha.id);
    const agora = new Date().toISOString();
    const patch =
      valor === '_naofunil_' ? { funil_id: null, eh_funil: false, confirmado_em: agora } :
      // "desfazer" devolve a linha para a fila: sem decisão nenhuma, não é o
      // mesmo que decidir que não é funil.
      valor === '_limpar_'   ? { funil_id: null, eh_funil: null,  confirmado_em: null  } :
                               { funil_id: valor, eh_funil: true, confirmado_em: agora };

    const { error } = await supabase.from('funil_checkouts').update(patch).eq('id', linha.id);
    setSalvando(null);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    // Atualiza só a linha tocada. Recarregar tudo faria a linha sumir do filtro
    // "A confirmar" no meio do clique seguinte, e a lista pularia debaixo do
    // cursor — é o tipo de coisa que faz alguém errar a próxima escolha.
    setLinhas(prev => prev.map(l => l.id === linha.id
      ? { ...l, ...patch, rev_nome: funis.find(f => f.id === valor)?.nome ?? null }
      : l));
  }

  async function aplicarNasVendas() {
    setAtribuindo(true);
    const { data, error } = await supabase.rpc('fn_backfill_funil_das_vendas');
    setAtribuindo(false);
    if (error) {
      toast({ title: 'Erro ao atribuir', description: error.message, variant: 'destructive' });
      return;
    }
    const n = (data as number) ?? 0;
    toast({
      title: n > 0 ? `${formatNumber(n)} vendas ligadas ao REV` : 'Nenhuma venda nova para ligar',
      description: n > 0 ? undefined : 'Confirme mais checkouts e rode de novo.',
    });
    carregar();
  }

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter(l => {
      if (filtro === 'pendentes'  && (l.funil_id || l.eh_funil === false)) return false;
      if (filtro === 'atribuidos' && !l.funil_id) return false;
      if (filtro === 'nao_funil'  && l.eh_funil !== false) return false;
      if (q && !(`${l.titulo ?? ''} ${l.url}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [linhas, filtro, busca]);

  // Progresso medido em vendas, não em checkouts. Ver o comentário do topo.
  const { vendasTotal, vendasResolvidas } = useMemo(() => {
    let total = 0, resolvidas = 0;
    for (const l of linhas) {
      const v = l.vendas ?? 0;
      total += v;
      if (l.funil_id || l.eh_funil === false) resolvidas += v;
    }
    return { vendasTotal: total, vendasResolvidas: resolvidas };
  }, [linhas]);

  const pct = vendasTotal ? Math.round((vendasResolvidas / vendasTotal) * 100) : 0;
  const pendentes = linhas.filter(l => !l.funil_id && l.eh_funil !== false).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Vendas já decididas</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{pct}%</div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
            {formatNumber(vendasResolvidas)} de {formatNumber(vendasTotal)} vendas
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Checkouts a confirmar</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{pendentes}</div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Estão em ordem de volume — os primeiros valem muito mais que os últimos.
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Vendas ligadas a um REV</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {vendasLigadas === null ? '—' : formatNumber(vendasLigadas)}
          </div>
          <Button
            size="sm" variant="outline" className="mt-2 h-7 text-xs"
            onClick={aplicarNasVendas} disabled={atribuindo}
          >
            {atribuindo ? 'Atribuindo…' : 'Aplicar nas vendas'}
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map(f => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
              filtro === f.key
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-muted/40 text-muted-foreground border-border/40 hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
        <Input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por título ou link"
          className="h-7 w-64 text-xs ml-auto"
        />
      </div>

      {/* Tabela */}
      {visiveis.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {busca
            ? 'Nenhum checkout com esse texto.'
            : filtro === 'pendentes'
              ? 'Todos os checkouts foram decididos.'
              : 'Nada aqui ainda.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Checkout</th>
                <th className="px-3 py-2 text-right font-medium">Vendas</th>
                <th className="px-3 py-2 text-left font-medium">Período</th>
                <th className="px-3 py-2 text-left font-medium w-72">REV</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(l => (
                <tr key={l.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.titulo ?? <span className="text-muted-foreground">sem título</span>}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[22rem]">{l.url}</div>
                    {/* Pista, não atribuição: "Rev5" no título acerta muito, mas
                        casar por nome já falhou neste projeto. Ela decide. */}
                    {l.rev_no_titulo && !l.funil_id && l.eh_funil !== false && (
                      <span className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        título sugere REV{l.rev_no_titulo}
                      </span>
                    )}
                  </td>
                  {/* Só venda APROVADA conta. `lost_cart` da Payt — carrinho
                      abandonado — entrava aqui como venda e mandava para o topo
                      da fila checkout que nunca vendeu nada: um deles tinha 283
                      "vendas" e zero aprovadas.

                      O abandono aparece embaixo em vez de sumir: checkout com
                      muito abandono e nenhuma venda não é lixo, é sintoma. */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    <div>{formatNumber(l.vendas ?? 0)}</div>
                    {(l.vendas_pendentes ?? 0) > 0 && (
                      <div className="text-[10px] text-muted-foreground/70">
                        +{formatNumber(l.vendas_pendentes ?? 0)} abandonos
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {dataCurta(l.primeira_venda)} – {dataCurta(l.ultima_venda)}
                  </td>
                  <td className="px-3 py-2">
                    {l.eh_funil === false ? (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground border border-border">
                          não é funil
                        </span>
                        <button
                          onClick={() => definir(l, '_limpar_')}
                          className="text-[11px] text-muted-foreground hover:text-foreground underline"
                        >
                          desfazer
                        </button>
                      </div>
                    ) : (
                      <Select
                        value={l.funil_id ?? ''}
                        onValueChange={v => definir(l, v)}
                        disabled={salvando === l.id}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Escolher REV…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_naofunil_">Não é funil (suporte, recuperação…)</SelectItem>
                          {funisOrdenados.map(f => (
                            <SelectItem key={f.id} value={f.id}>
                              {projetoDoFunil(f) ? `${projetoDoFunil(f)} · ${f.nome}` : f.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
