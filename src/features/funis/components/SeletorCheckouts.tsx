import { useCallback, useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatNumber, formatCurrency } from '@/lib/formatters';
import { Plus, X, ShoppingCart } from 'lucide-react';

/**
 * Quais checkouts pertencem a este REV.
 *
 * A atribuição já existia, mas só pelo outro lado: na aba Checkouts você abre a
 * fila dos 97 e escolhe o REV de cada um. Faltava a pergunta ao contrário —
 * "quais checkouts são deste REV?" — que é a que se faz com o cadastro aberto.
 *
 * É seleção, e não digitação, porque os checkouts vêm do webhook da Payt com o
 * nome e o volume que cada um moveu — escolher da lista não erra a URL.
 *
 * Mas a lista só tem quem JÁ VENDEU, porque ela nasce das vendas. Ao lançar um
 * REV novo isso deixaria as primeiras vendas sem REV, então também dá para colar
 * a URL: a linha entra sem título e o gatilho a adota na primeira venda,
 * preenchendo o nome e preservando o REV já escolhido.
 *
 * Grava na hora, e não ao salvar o REV: o vínculo mora em `funil_checkouts`, e
 * não num campo do funil. Deixar para o "Salvar" faria a tela mentir sobre onde
 * o dado está.
 */

interface Checkout {
  id: string;
  url: string;
  titulo: string | null;
  funil_id: string | null;
  eh_funil: boolean | null;
  vendas: number | null;
  preco: number | null;
  preco_praticado: number | null;
  vendas_pendentes: number | null;
  primeira_venda: string | null;
  ultima_venda: string | null;
}

function dataCurta(iso: string | null): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

interface Props {
  funilId: string | null;
}

export function SeletorCheckouts({ funilId }: Props) {
  const [todos, setTodos]       = useState<Checkout[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto]     = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [urlNova, setUrlNova]   = useState('');

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('vw_checkouts_a_confirmar')
      .select('id,url,titulo,funil_id,eh_funil,vendas,primeira_venda,ultima_venda,preco,preco_praticado,vendas_pendentes');
    if (error) {
      toast({ title: 'Erro ao carregar checkouts', description: error.message, variant: 'destructive' });
    }
    setTodos((data ?? []) as Checkout[]);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const meus = useMemo(
    () => todos.filter(c => c.funil_id === funilId)
      .sort((a, b) => (b.vendas ?? 0) - (a.vendas ?? 0)),
    [todos, funilId],
  );

  // Só oferece o que ainda não tem dono e não foi marcado como não-funil. Um
  // checkout já atribuído a outro REV não aparece aqui de propósito: mudá-lo
  // daqui roubaria as vendas do outro sem ninguém ver.
  const disponiveis = useMemo(
    () => todos.filter(c => !c.funil_id && c.eh_funil !== false)
      .sort((a, b) => (b.vendas ?? 0) - (a.vendas ?? 0)),
    [todos],
  );

  /**
   * Cria o checkout antes de ele ter vendido, a partir da URL.
   *
   * Entra SEM título de propósito: o título vem do webhook, e é justamente o
   * campo nulo que faz o gatilho adotar esta linha na primeira venda em vez de
   * criar outra ao lado.
   */
  async function preCadastrar() {
    const bruta = urlNova.trim();
    if (!bruta || !funilId) return;

    // Normaliza igual ao gatilho: sem query string. Colar a URL com `?cart=` ou
    // com os UTMs colados é o erro mais provável aqui, e ele criaria um checkout
    // que nunca casaria com venda nenhuma.
    const url = bruta.split('?')[0].replace(/\/+$/, '');
    if (!/^https?:\/\/.+\..+/.test(url)) {
      toast({ title: 'URL inválida', description: 'Cole o endereço completo do checkout.', variant: 'destructive' });
      return;
    }

    if (todos.some(c => c.url === url)) {
      toast({ title: 'Esse checkout já está na lista', description: 'Procure por ele na busca acima.' });
      return;
    }

    setSalvando('_novo_');
    const { error } = await supabase.from('funil_checkouts').insert({
      url,
      titulo: null,
      funil_id: funilId,
      eh_funil: true,
      confirmado_em: new Date().toISOString(),
    });
    setSalvando(null);

    if (error) {
      toast({ title: 'Erro ao cadastrar', description: error.message, variant: 'destructive' });
      return;
    }
    setUrlNova('');
    setAberto(false);
    toast({
      title: 'Checkout vinculado',
      description: 'O nome dele aparece assim que a primeira venda entrar.',
    });
    carregar();
  }

  /** Preço planejado, só enquanto não há venda para dizer o praticado. */
  async function salvarPreco(c: Checkout, texto: string) {
    const limpo = texto.trim().replace(/[^\d,.-]/g, '').replace(',', '.');
    const valor = limpo === '' ? null : Number(limpo);
    if (valor !== null && !Number.isFinite(valor)) return;
    if (valor === (c.preco ?? null)) return;

    const { error } = await supabase
      .from('funil_checkouts').update({ preco: valor }).eq('id', c.id);
    if (error) {
      toast({ title: 'Erro ao salvar o preço', description: error.message, variant: 'destructive' });
      return;
    }
    carregar();
  }

  async function definir(checkoutId: string, novoFunil: string | null) {
    setSalvando(checkoutId);
    const { error } = await supabase
      .from('funil_checkouts')
      .update({
        funil_id: novoFunil,
        eh_funil: novoFunil ? true : null,
        confirmado_em: novoFunil ? new Date().toISOString() : null,
      })
      .eq('id', checkoutId);

    if (error) {
      setSalvando(null);
      toast({ title: 'Erro ao vincular', description: error.message, variant: 'destructive' });
      return;
    }

    // Reconcilia as vendas na hora. Sem isto o vínculo existiria mas as vendas
    // continuariam sem REV até alguém lembrar de apertar o botão na outra aba.
    const { data: n } = await supabase.rpc('fn_backfill_funil_das_vendas');
    setSalvando(null);
    if (n) toast({ title: `${formatNumber(n as number)} vendas atualizadas` });
    carregar();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs">Checkouts deste REV</Label>
        {funilId && (
          <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-6 px-2 rounded inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Adicionar
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[26rem] p-0" align="end">
              <Command
                // Substring simples: o filtro padrão do cmdk reordena por
                // similaridade, e aqui a ordem por volume é a informação —
                // o checkout de 1.951 vendas precisa continuar no topo.
                filter={(v, q) => (v.toLowerCase().includes(q.toLowerCase()) ? 1 : 0)}
              >
                <CommandInput placeholder="Buscar checkout pelo nome ou link…" className="h-9" />
                <CommandList className="max-h-72">
                  <CommandEmpty>
                    {carregando ? 'Carregando…' : 'Nenhum checkout livre com esse nome.'}
                  </CommandEmpty>
                  <CommandGroup>
                    {disponiveis.map(c => (
                      <CommandItem
                        key={c.id}
                        value={`${c.titulo ?? ''} ${c.url}`}
                        onSelect={() => { definir(c.id, funilId); setAberto(false); }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">
                            {c.titulo ?? <span className="text-muted-foreground">sem título</span>}
                          </div>
                          <div className="text-[10px] text-muted-foreground tabular-nums truncate">
                            {c.vendas ? `${formatNumber(c.vendas)} vendas · ` : ''}
                            {!c.vendas && c.vendas_pendentes ? `${formatNumber(c.vendas_pendentes)} carrinhos abandonados, 0 vendas · ` : ''}
                            {c.primeira_venda ? `${dataCurta(c.primeira_venda)}–${dataCurta(c.ultima_venda)} · ` : ''}
                            {c.url.replace(/^https?:\/\//, '')}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>

              {/* Cadastrar antes da primeira venda.
                  A lista acima só tem checkout que já vendeu, porque ela nasce
                  das vendas. Ao lançar um REV novo isso deixava as primeiras
                  vendas sem REV até alguém voltar aqui.

                  Colando a URL, a linha entra sem título e o gatilho a ADOTA
                  quando a primeira venda chega — preenchendo o título e
                  preservando o REV escolhido. */}
              <div className="border-t border-border p-2 space-y-1.5">
                <p className="text-[10px] text-muted-foreground">
                  Ainda não vendeu? Cole a URL do checkout:
                </p>
                <div className="flex gap-1.5">
                  <Input
                    value={urlNova}
                    onChange={e => setUrlNova(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); preCadastrar(); } }}
                    placeholder="https://payt.site/…"
                    className="h-7 text-xs"
                  />
                  <button
                    type="button"
                    onClick={preCadastrar}
                    disabled={!urlNova.trim() || salvando === '_novo_'}
                    className="shrink-0 h-7 px-2 rounded text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40 transition-colors"
                  >
                    Vincular
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {!funilId ? (
        <p className="text-xs text-muted-foreground/60 italic">
          Salve o REV para poder vincular checkouts.
        </p>
      ) : meus.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">
          Nenhum checkout vinculado — as vendas deste REV não estão sendo contadas.
        </p>
      ) : (
        <div className="space-y-1.5">
          {meus.map(c => (
            <div
              key={c.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2',
                salvando === c.id && 'opacity-50',
              )}
            >
              <ShoppingCart className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate">
                  {c.titulo ?? <span className="text-muted-foreground italic">aguardando a primeira venda</span>}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {c.url.replace(/^https?:\/\//, '')}
                </div>
              </div>
              {/* Preço. Enquanto o checkout não vendeu é campo; depois vira o
                  praticado, que sai das próprias vendas.

                  Isto substituiu o bloco "Preços e Links de Checkout", que era
                  o mesmo checkout digitado de novo. O link ali era redundante e
                  o preço não estava sendo mantido: o REV com 428 vendas tinha o
                  campo vazio enquanto as vendas diziam R$ 47. */}
              {c.vendas ? (
                <span className="text-xs tabular-nums shrink-0 text-right">
                  {c.preco_praticado != null && (
                    <div className="font-medium">{formatCurrency(Number(c.preco_praticado))}</div>
                  )}
                  <div className="text-muted-foreground">{formatNumber(c.vendas)} vendas</div>
                </span>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-muted-foreground">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={c.preco != null ? String(c.preco).replace('.', ',') : ''}
                    onBlur={e => salvarPreco(c, e.target.value)}
                    placeholder="0,00"
                    className="w-16 h-6 px-1.5 rounded border border-input bg-background text-xs text-right tabular-nums"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => definir(c.id, null)}
                disabled={salvando === c.id}
                title="Desvincular deste REV"
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
