import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';

/**
 * Escolher, criar, renomear e apagar categoria no mesmo campo.
 *
 * A lista vivia em `constants.ts`, então criar um subtópico exigia deploy. Ela
 * pediu para gerenciar no próprio campo — o que é certo: isto é operação, não
 * programação, e quem sabe que "Editores de vídeo" precisa existir é quem está
 * categorizando naquele instante.
 *
 * O centro de custo vem junto da categoria e não é escolhido à parte: é o que
 * mantém a hierarquia estável. Quando o centro era propriedade da transação, a
 * mesma categoria caía em quatro centros diferentes e a matriz de custos ficava
 * incoerente.
 */

export interface Categoria {
  categoria: string;
  centro_custo: string;
  tipo: string;
  ordem: number;
}

export function CampoCategoria({
  valor, onChange, onCentroChange,
}: {
  valor: string;
  onChange: (categoria: string) => void;
  /** O centro segue a categoria. A tela não precisa perguntar os dois. */
  onCentroChange?: (centro: string) => void;
}) {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [centros, setCentros] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [criandoEm, setCriandoEm] = useState<string | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);

  async function carregar() {
    const [{ data: cats }, { data: cs }] = await Promise.all([
      supabase.from('categorias_centro')
        .select('categoria, centro_custo, tipo, ordem')
        .eq('ativo', true).order('ordem'),
      supabase.from('centros_custo').select('nome').order('ordem'),
    ]);
    setCategorias((cats ?? []) as Categoria[]);
    setCentros((cs ?? []).map((c: { nome: string }) => c.nome));
  }

  useEffect(() => { carregar(); }, []);

  // Fecha ao clicar fora. Sem isto o painel de gestão fica aberto por cima do
  // resto do formulário e a pessoa perde de vista o que estava fazendo.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const porCentro = useMemo(() => {
    const filtro = busca.trim().toLowerCase();
    const mapa = new Map<string, Categoria[]>();
    for (const c of categorias) {
      if (filtro && !c.categoria.toLowerCase().includes(filtro)) continue;
      if (!mapa.has(c.centro_custo)) mapa.set(c.centro_custo, []);
      mapa.get(c.centro_custo)!.push(c);
    }
    return mapa;
  }, [categorias, busca]);

  const jaExiste = categorias.some(c => c.categoria.toLowerCase() === busca.trim().toLowerCase());

  function escolher(c: Categoria) {
    onChange(c.categoria);
    onCentroChange?.(c.centro_custo);
    setAberto(false);
    setBusca('');
  }

  async function criar(centro: string) {
    const nome = busca.trim();
    if (!nome) return;
    const { error } = await supabase.from('categorias_centro').insert({
      categoria: nome, centro_custo: centro, tipo: 'custo', ordem: 500,
    });
    if (error) { toast({ title: 'Não consegui criar', description: error.message, variant: 'destructive' }); return; }
    await carregar();
    onChange(nome);
    onCentroChange?.(centro);
    setBusca('');
    setCriandoEm(null);
    setAberto(false);
  }

  async function renomear(antiga: string) {
    const nova = rascunho.trim();
    setEditando(null);
    if (!nova || nova === antiga) return;

    // Renomear a categoria sem arrastar as transações deixaria os lançamentos
    // apontando para um nome que não existe mais — some do DRE sem aviso.
    const { error } = await supabase.from('categorias_centro')
      .update({ categoria: nova }).eq('categoria', antiga);
    if (error) { toast({ title: 'Não consegui renomear', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('transacoes').update({ categoria: nova }).eq('categoria', antiga);

    await carregar();
    if (valor === antiga) onChange(nova);
    toast({ title: 'Renomeada', description: `${antiga} → ${nova}` });
  }

  async function apagar(c: Categoria) {
    const { data: emUso } = await supabase.rpc('fn_categoria_em_uso', { p_categoria: c.categoria });
    if ((emUso ?? 0) > 0) {
      toast({
        title: 'Categoria em uso',
        description: `${emUso} ${emUso === 1 ? 'lançamento usa' : 'lançamentos usam'} "${c.categoria}". Mova-os antes de apagar.`,
        variant: 'destructive',
      });
      return;
    }
    await supabase.from('categorias_centro').delete().eq('categoria', c.categoria);
    await carregar();
    if (valor === c.categoria) onChange('');
  }

  const selecionada = categorias.find(c => c.categoria === valor);

  return (
    <div className="relative" ref={caixaRef}>
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background',
          'px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring',
        )}
      >
        <span className={valor ? 'text-foreground' : 'text-muted-foreground'}>
          {valor || 'Escolher categoria'}
        </span>
        {selecionada && (
          <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
            {selecionada.centro_custo}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar ou nomear uma nova…"
              className="h-8"
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {Array.from(porCentro.entries()).map(([centro, itens]) => (
              <div key={centro} className="mb-1 last:mb-0">
                <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  {centro}
                </p>
                {itens.map(c => (
                  <div key={c.categoria} className="group flex items-center gap-1 rounded px-1 hover:bg-accent">
                    {editando === c.categoria ? (
                      <Input
                        autoFocus
                        value={rascunho}
                        onChange={e => setRascunho(e.target.value)}
                        onBlur={() => renomear(c.categoria)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') renomear(c.categoria);
                          if (e.key === 'Escape') setEditando(null);
                        }}
                        className="h-7 flex-1"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => escolher(c)}
                          className="flex-1 truncate py-1.5 text-left text-sm"
                        >
                          {c.categoria}
                          {valor === c.categoria && <Check className="ml-1.5 inline h-3 w-3 text-primary" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditando(c.categoria); setRascunho(c.categoria); }}
                          className="shrink-0 p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                          aria-label={`Renomear ${c.categoria}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => apagar(c)}
                          className="shrink-0 p-1 text-muted-foreground opacity-0 hover:text-red-400 group-hover:opacity-100"
                          aria-label={`Apagar ${c.categoria}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {porCentro.size === 0 && !busca.trim() && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nenhuma categoria.</p>
            )}
          </div>

          {/* Criar exige escolher o centro: sem pai, a categoria não teria onde
              somar no DRE e cairia em "(sem centro)". */}
          {busca.trim() && !jaExiste && (
            <div className="border-t border-border p-2">
              {criandoEm === null ? (
                <button
                  type="button"
                  onClick={() => setCriandoEm('')}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-primary hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Criar "{busca.trim()}"
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between px-2 pb-1">
                    <p className="text-[11px] text-muted-foreground">Dentro de qual centro?</p>
                    <button
                      type="button" onClick={() => setCriandoEm(null)}
                      className="text-muted-foreground hover:text-foreground" aria-label="Cancelar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {centros.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => criar(c)}
                        className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
