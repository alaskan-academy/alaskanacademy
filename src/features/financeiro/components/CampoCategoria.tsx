import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react';

/**
 * Os dois níveis, os dois gerenciáveis.
 *
 * A lista vivia em `constants.ts`, então criar um subtópico exigia deploy. Ela
 * pediu para gerenciar no próprio campo — o que é certo: isto é operação, não
 * programação, e quem sabe que "Editores de vídeo" precisa existir é quem está
 * categorizando naquele instante.
 *
 * A primeira versão deixava gerenciar só a categoria; o centro vinha de carona e
 * era intocável. Ela apontou a assimetria: se dá para criar subcategoria, tem de
 * dar para criar a macro também. Agora são dois campos iguais em poder, e o de
 * cima filtra o de baixo — escolhendo "Receitas", a categoria só oferece o que
 * é receita.
 *
 * O centro continua vindo junto quando se escolhe a categoria direto, sem passar
 * pelo campo de cima. Obrigar a escolher os dois seria pior: foi escolhendo em
 * separado que a mesma categoria acabou em quatro centros diferentes e a matriz
 * de custos ficou incoerente.
 */

interface Categoria {
  categoria: string;
  centro_custo: string;
  tipo: string;
  ordem: number;
}

export function CampoCategoria({
  valor, centro, onChange, onCentroChange,
}: {
  valor: string;
  centro?: string;
  onChange: (categoria: string) => void;
  onCentroChange?: (centro: string) => void;
}) {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [centros, setCentros] = useState<string[]>([]);
  const confirm = useConfirm();

  const carregar = useCallback(async () => {
    const [{ data: cats }, { data: cs }] = await Promise.all([
      supabase.from('categorias_centro')
        .select('categoria, centro_custo, tipo, ordem')
        .eq('ativo', true).order('ordem'),
      supabase.from('centros_custo').select('nome').order('ordem'),
    ]);
    setCategorias((cats ?? []) as Categoria[]);
    setCentros((cs ?? []).map((c: { nome: string }) => c.nome));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const daquiPraBaixo = useMemo(
    () => (centro ? categorias.filter(c => c.centro_custo === centro) : categorias),
    [categorias, centro],
  );

  // ── Centro ────────────────────────────────────────────────────────────────

  async function criarCentro(nome: string) {
    const { error } = await supabase.from('centros_custo')
      .insert({ nome, ordem: 500 });
    if (error) { toast({ title: 'Não consegui criar', description: error.message, variant: 'destructive' }); return; }
    await carregar();
    onCentroChange?.(nome);
  }

  async function renomearCentro(antigo: string, novo: string) {
    const { error } = await supabase.rpc('fn_renomear_centro', { p_antigo: antigo, p_novo: novo });
    if (error) { toast({ title: 'Não consegui renomear', description: error.message, variant: 'destructive' }); return; }
    await carregar();
    if (centro === antigo) onCentroChange?.(novo);
    toast({ title: 'Renomeado', description: `${antigo} → ${novo}` });
  }

  async function apagarCentro(nome: string) {
    const { data: dentro } = await supabase.rpc('fn_centro_em_uso', { p_centro: nome });
    if ((dentro ?? 0) > 0) {
      toast({
        title: 'Centro em uso',
        description: `${dentro} ${dentro === 1 ? 'categoria mora' : 'categorias moram'} em "${nome}". Mova-as antes de apagar.`,
        variant: 'destructive',
      });
      return;
    }
    // Só chega aqui se estiver vazio — a checagem acima barra o resto. Ainda
    // assim pergunta: apagar não tem volta, e o botão fica ao lado do de
    // renomear.
    const ok = await confirm({
      title: `Apagar o grupo "${nome}"?`,
      description: 'Está vazio, então nenhum lançamento muda. Mas não dá para desfazer — para usá-lo de novo, terá de criá-lo outra vez.',
      confirmText: 'Apagar',
    });
    if (!ok) return;

    await supabase.from('centros_custo').delete().eq('nome', nome);
    await carregar();
    if (centro === nome) onCentroChange?.('');
  }

  // ── Categoria ─────────────────────────────────────────────────────────────

  async function criarCategoria(nome: string, dentroDe: string) {
    const { error } = await supabase.from('categorias_centro').insert({
      categoria: nome, centro_custo: dentroDe, tipo: 'custo', ordem: 500,
    });
    if (error) { toast({ title: 'Não consegui criar', description: error.message, variant: 'destructive' }); return; }
    await carregar();
    onChange(nome);
    onCentroChange?.(dentroDe);
  }

  async function renomearCategoria(antiga: string, nova: string) {
    // Renomear sem arrastar as transações deixaria os lançamentos apontando para
    // um nome que não existe mais — sumiriam do DRE sem aviso.
    const { error } = await supabase.from('categorias_centro')
      .update({ categoria: nova }).eq('categoria', antiga);
    if (error) { toast({ title: 'Não consegui renomear', description: error.message, variant: 'destructive' }); return; }
    await supabase.from('transacoes').update({ categoria: nova }).eq('categoria', antiga);
    await carregar();
    if (valor === antiga) onChange(nova);
    toast({ title: 'Renomeada', description: `${antiga} → ${nova}` });
  }

  async function apagarCategoria(nome: string) {
    const { data: emUso } = await supabase.rpc('fn_categoria_em_uso', { p_categoria: nome });
    if ((emUso ?? 0) > 0) {
      toast({
        title: 'Categoria em uso',
        description: `${emUso} ${emUso === 1 ? 'lançamento usa' : 'lançamentos usam'} "${nome}". Mova-os antes de apagar.`,
        variant: 'destructive',
      });
      return;
    }
    const ok = await confirm({
      title: `Apagar a categoria "${nome}"?`,
      description: 'Nenhum lançamento usa esta categoria, então nada muda no DRE. Mas não dá para desfazer.',
      confirmText: 'Apagar',
    });
    if (!ok) return;

    await supabase.from('categorias_centro').delete().eq('categoria', nome);
    await carregar();
    if (valor === nome) onChange('');
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Grupo</Label>
        <Seletor
          valor={centro ?? ''}
          vazio="Todos os grupos"
          itens={centros.map(c => ({ chave: c, rotulo: c }))}
          onEscolher={c => {
            onCentroChange?.(c);
            // Trocar de grupo com uma categoria de outro selecionada deixaria os
            // dois campos se contradizendo na tela.
            if (valor && !categorias.some(x => x.categoria === valor && x.centro_custo === c)) onChange('');
          }}
          onLimpar={() => onCentroChange?.('')}
          onCriar={criarCentro}
          onRenomear={renomearCentro}
          onApagar={apagarCentro}
          dica="Digite um nome novo para criar um grupo"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Categoria</Label>
        <Seletor
          valor={valor}
          vazio="Escolher, criar ou editar categoria"
          itens={daquiPraBaixo.map(c => ({
            chave: c.categoria,
            rotulo: c.categoria,
            grupo: centro ? undefined : c.centro_custo,
          }))}
          onEscolher={cat => {
            onChange(cat);
            const achada = categorias.find(c => c.categoria === cat);
            if (achada) onCentroChange?.(achada.centro_custo);
          }}
          onCriar={nome => {
            // Sem grupo escolhido não há onde criar: uma categoria sem pai cairia
            // em "(sem centro)" na matriz.
            if (!centro) {
              toast({ title: 'Escolha o grupo primeiro', description: 'A categoria precisa de um grupo para somar no DRE.' });
              return Promise.resolve();
            }
            return criarCategoria(nome, centro);
          }}
          onRenomear={renomearCategoria}
          onApagar={apagarCategoria}
          dica={centro
            ? `Digite um nome novo para criar dentro de "${centro}"`
            : 'Escolha um grupo acima para poder criar'}
        />
      </div>
    </div>
  );
}

// ─── Seletor genérico, usado nos dois níveis ─────────────────────────────────

interface Item { chave: string; rotulo: string; grupo?: string }

function Seletor({
  valor, vazio, itens, onEscolher, onLimpar, onCriar, onRenomear, onApagar, dica,
}: {
  valor: string;
  vazio: string;
  itens: Item[];
  onEscolher: (chave: string) => void;
  onLimpar?: () => void;
  onCriar: (nome: string) => Promise<void>;
  onRenomear: (antigo: string, novo: string) => Promise<void>;
  onApagar: (chave: string) => Promise<void>;
  dica: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const caixaRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora. Sem isto o painel fica por cima do resto do
  // formulário e a pessoa perde de vista o que estava fazendo.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const filtro = busca.trim().toLowerCase();
  const visiveis = filtro ? itens.filter(i => i.rotulo.toLowerCase().includes(filtro)) : itens;
  const jaExiste = itens.some(i => i.rotulo.toLowerCase() === filtro);

  const porGrupo = useMemo(() => {
    const mapa = new Map<string, Item[]>();
    for (const i of visiveis) {
      const g = i.grupo ?? '';
      if (!mapa.has(g)) mapa.set(g, []);
      mapa.get(g)!.push(i);
    }
    return mapa;
  }, [visiveis]);

  async function confirmarRenome(antigo: string) {
    const novo = rascunho.trim();
    setEditando(null);
    if (!novo || novo === antigo) return;
    await onRenomear(antigo, novo);
  }

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
          {valor || vazio}
        </span>
        <span className="ml-2 flex shrink-0 items-center gap-1">
          {valor && onLimpar && (
            <span
              role="button"
              tabIndex={0}
              onClick={e => { e.stopPropagation(); onLimpar(); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onLimpar(); } }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Limpar"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>

      {aberto && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar ou nomear…"
              className="h-8"
            />
            {/* Sem esta linha ninguém descobre que dá para gerenciar aqui: um
                campo que parece um select comum não convida a testar. */}
            <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground/70">
              {dica} · <Pencil className="inline h-2.5 w-2.5" /> renomeia ·{' '}
              <Trash2 className="inline h-2.5 w-2.5" /> apaga
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {Array.from(porGrupo.entries()).map(([grupo, lista]) => (
              <div key={grupo || '_'} className="mb-1 last:mb-0">
                {grupo && (
                  <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                    {grupo}
                  </p>
                )}
                {lista.map(i => (
                  <div key={i.chave} className="flex items-center gap-1 rounded px-1 hover:bg-accent">
                    {editando === i.chave ? (
                      <Input
                        autoFocus
                        value={rascunho}
                        onChange={e => setRascunho(e.target.value)}
                        onBlur={() => confirmarRenome(i.chave)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') confirmarRenome(i.chave);
                          if (e.key === 'Escape') setEditando(null);
                        }}
                        className="h-7 flex-1"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { onEscolher(i.chave); setAberto(false); setBusca(''); }}
                          className="flex-1 truncate py-1.5 text-left text-sm"
                        >
                          {i.rotulo}
                          {valor === i.chave && <Check className="ml-1.5 inline h-3 w-3 text-primary" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditando(i.chave); setRascunho(i.rotulo); }}
                          className="shrink-0 p-1 text-muted-foreground/50 hover:text-foreground"
                          aria-label={`Renomear ${i.rotulo}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onApagar(i.chave)}
                          className="shrink-0 p-1 text-muted-foreground/50 hover:text-red-400"
                          aria-label={`Apagar ${i.rotulo}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {visiveis.length === 0 && !filtro && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nada aqui ainda.</p>
            )}
          </div>

          {filtro && !jaExiste && (
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={async () => {
                  await onCriar(busca.trim());
                  setBusca('');
                  setAberto(false);
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-primary hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                Criar "{busca.trim()}"
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
