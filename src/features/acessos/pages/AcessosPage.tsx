import { useEffect, useState, useMemo, useRef } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Search, Eye, EyeOff, Copy, Check, ExternalLink,
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Settings2, X,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Acesso = {
  id: string;
  ferramenta: string;
  /* Para que serve a ferramenta. Não confundir com `setores`, que é o time
     das pessoas — a palavra queria dizer as duas coisas e não dava. */
  categoria: string;
  url: string | null;
  login: string | null;
  senha: string | null;
  status: 'ativo' | 'inativo';
  notas: string | null;
  criado_por: string | null;
  atualizado_por: string | null;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

/* Só o ponto de partida de um banco vazio: a lista de verdade vem do banco. */
const CATEGORIAS_DEFAULT = [
  'Administrativo', 'Automação', 'Área de Membros', 'Banco de Dados',
  'Construtor IA', 'Cursos e Formações', 'Edição', 'Pesquisa',
];

/*
  A cor da categoria sai do NOME, e não de uma lista escrita aqui.

  A lista tinha as oito categorias que existiam quando ela foi escrita. Como dá
  para criar categoria pelo painel de gerenciar, a nona nascia cinza — a
  terceira armadilha do CLAUDE.md, silenciosa: ninguém percebe que faltou, só
  acha que aquela categoria é sem graça.

  A soma dos códigos das letras escolhe uma das oito cores. É estável (o mesmo
  nome dá sempre a mesma cor) e não precisa de manutenção.
*/
const CORES_CATEGORIA = [
  'bg-blue-400', 'bg-emerald-400', 'bg-yellow-400', 'bg-purple-400',
  'bg-orange-400', 'bg-pink-400', 'bg-red-400', 'bg-slate-400',
];

function corDaCategoria(nome: string): string {
  let soma = 0;
  for (let i = 0; i < nome.length; i++) soma += nome.charCodeAt(i);
  return CORES_CATEGORIA[soma % CORES_CATEGORIA.length];
}

const CONF_KEY = 'categorias_acessos';

const ordenar = (arr: string[]) => [...arr].sort((a, b) => a.localeCompare(b, 'pt'));

const blankForm = (categoria = '') => ({
  ferramenta: '', categoria, url: '', login: '',
  senha: '', status: 'ativo' as 'ativo' | 'inativo', notas: '',
});

// ─── CopyBtn ──────────────────────────────────────────────────────────────────

function CopyBtn({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      onClick={copy}
      title="Copiar"
      className={cn('p-1 rounded text-muted-foreground hover:text-foreground transition-colors', className)}
    >
      {done ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── SenhaCell ────────────────────────────────────────────────────────────────

function SenhaCell({ senha }: { senha: string | null }) {
  const [visible, setVisible] = useState(false);
  if (!senha) return <span className="text-muted-foreground/40 text-xs">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      <span className="font-mono text-xs">{visible ? senha : '••••••••'}</span>
      <button
        onClick={() => setVisible(v => !v)}
        title={visible ? 'Ocultar' : 'Revelar'}
        className="ml-1 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <CopyBtn text={senha} />
    </div>
  );
}

// ─── AcessoRow ────────────────────────────────────────────────────────────────

function AcessoRow({ a, isAdmin, onEdit, onDelete }: {
  a: Acesso; isAdmin: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group">
      <div className="w-44 shrink-0">
        <span className="text-sm font-medium">{a.ferramenta}</span>
        {a.notas && (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate max-w-[168px] cursor-default">{a.notas}</p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs whitespace-pre-wrap">{a.notas}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-0.5">
        {a.login ? (
          <>
            <span className="text-xs text-muted-foreground truncate">{a.login}</span>
            <CopyBtn text={a.login} className="shrink-0" />
          </>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </div>
      <div className="w-40 shrink-0">
        <SenhaCell senha={a.senha} />
      </div>
      <div className="w-24 shrink-0">
        {a.url ? (
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Acessar <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        )}
      </div>
      {isAdmin && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── CategoriaSection ─────────────────────────────────────────────────────────────

function CategoriaSection({ categoria, itens, isAdmin, onEdit, onDelete }: {
  categoria: string; itens: Acesso[]; isAdmin: boolean;
  onEdit: (a: Acesso) => void; onDelete: (a: Acesso) => void;
}) {
  const [open, setOpen] = useState(true);
  const dot = corDaCategoria(categoria);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', dot)} />
        <span className="font-semibold text-sm flex-1">{categoria}</span>
        <span className="text-xs text-muted-foreground mr-2">
          {itens.length} ferramenta{itens.length !== 1 ? 's' : ''}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <>
          <div className="flex items-center gap-3 px-4 py-1.5 border-t border-border bg-muted/20">
            <div className="w-44 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Ferramenta</div>
            <div className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Login</div>
            <div className="w-40 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Senha</div>
            <div className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Link</div>
            {isAdmin && <div className="w-14 shrink-0" />}
          </div>
          <div className="divide-y divide-border/50">
            {itens.map(a => (
              <AcessoRow
                key={a.id}
                a={a}
                isAdmin={isAdmin}
                onEdit={() => onEdit(a)}
                onDelete={() => onDelete(a)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── CategoriasPanel (inline dentro do dialog) ───────────────────────────────────

function CategoriasPanel({ categorias, acessos, onClose, onSave }: {
  categorias: string[];
  acessos: Acesso[];
  onClose: () => void;
  onSave: (updated: string[]) => Promise<void>;
}) {
  const confirm = useConfirm();
  const [list, setList]         = useState<string[]>(categorias);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editVal, setEditVal]   = useState('');
  const [newNome, setNewNome]   = useState('');
  const [saving, setSaving]     = useState(false);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIdx !== null) editRef.current?.focus();
  }, [editingIdx]);

  const usageCount = (nome: string) => acessos.filter(a => a.categoria === nome).length;

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditVal(list[i]);
  };

  const confirmEdit = async (i: number) => {
    const trimmed = editVal.trim();
    if (!trimmed || trimmed === list[i]) { setEditingIdx(null); return; }
    if (list.some((s, j) => j !== i && s.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: 'Já existe uma categoria com esse nome', variant: 'destructive' });
      return;
    }
    const oldName = list[i];
    const updated = ordenar(list.map((s, j) => j === i ? trimmed : s));
    setSaving(true);
    // Bulk-update acessos that use the old name
    if (usageCount(oldName) > 0) {
      const { error } = await supabase.from('acessos').update({ categoria: trimmed }).eq('categoria', oldName);
      if (error) {
        toast({ title: 'Erro ao renomear', description: error.message, variant: 'destructive' });
        setSaving(false);
        return;
      }
    }
    await onSave(updated);
    setList(updated);
    setEditingIdx(null);
    setSaving(false);
  };

  const remove = async (i: number) => {
    const nome = list[i];
    const count = usageCount(nome);
    if (count > 0) {
      const ok = await confirm({
        title: `Excluir categoria "${nome}"?`,
        description: `${count} ferramenta${count !== 1 ? 's' : ''} usa${count === 1 ? '' : 'm'} esta categoria. Elas ficarão sem categoria definida.`,
      });
      if (!ok) return;
    }
    const updated = list.filter((_, j) => j !== i);
    setSaving(true);
    await onSave(updated);
    setList(updated);
    setSaving(false);
  };

  const add = async () => {
    const trimmed = newNome.trim();
    if (!trimmed) return;
    if (list.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: 'Categoria já existe', variant: 'destructive' });
      return;
    }
    const updated = ordenar([...list, trimmed]);
    setSaving(true);
    await onSave(updated);
    setList(updated);
    setNewNome('');
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-0">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Gerenciar categorias</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Lista */}
      <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
        {list.map((s, i) => (
          <div key={s} className="flex items-center gap-2 group rounded-md px-2 py-1 hover:bg-muted/40">
            {editingIdx === i ? (
              <Input
                ref={editRef}
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmEdit(i);
                  if (e.key === 'Escape') setEditingIdx(null);
                }}
                className="h-6 text-xs flex-1 px-1.5"
                disabled={saving}
              />
            ) : (
              <span className="text-sm flex-1 truncate">{s}</span>
            )}
            <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
              {usageCount(s)}
            </span>
            {editingIdx === i ? (
              <button
                onClick={() => confirmEdit(i)}
                disabled={saving}
                className="text-xs text-primary hover:underline shrink-0 disabled:opacity-50"
              >
                Ok
              </button>
            ) : (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => startEdit(i)}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                  title="Renomear"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => remove(i)}
                  className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                  title="Excluir"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Nova categoria */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
        <Input
          value={newNome}
          onChange={e => setNewNome(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Nova categoria..."
          className="h-7 text-xs flex-1"
          disabled={saving}
        />
        <Button size="sm" variant="outline" onClick={add} disabled={saving || !newNome.trim()} className="h-7 px-2 text-xs">
          <Plus className="h-3 w-3 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AcessosPage() {
  const { perfil, user } = useAuth();
  const isAdmin = perfil?.is_admin ?? false;
  const confirm = useConfirm();

  const [acessos, setAcessos]           = useState<Acesso[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('todos');
  const [showInativos, setShowInativos] = useState(false);

  const [open, setOpen]             = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState(blankForm());
  const [saving, setSaving]         = useState(false);
  const [gerenciando, setGerenciando] = useState(false);

  // Categorias, vindas do banco
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_DEFAULT);

  /*
    A lista de categorias mora em `configuracoes_texto`, e não em `configuracoes`.

    Morava na segunda, e ali `valor` é NUMERIC — a tabela de parâmetros fiscais,
    onde vivem alíquota e custo fixo. Gravar um JSON de texto num campo numérico
    falha, e o erro era engolido: a tela mostrava a categoria nova como se
    tivesse salvado, e no F5 ela sumia. A chave nunca existiu no banco.

    `configuracoes_texto` é chave/valor de texto e já existia ao lado.
  */
  const carregarCategorias = async () => {
    const { data } = await supabase
      .from('configuracoes_texto')
      .select('valor')
      .eq('chave', CONF_KEY)
      .maybeSingle();
    if (!data?.valor) return;
    try {
      const lista = JSON.parse(data.valor);
      if (Array.isArray(lista) && lista.length) setCategorias(ordenar(lista));
    } catch {
      /* Valor corrompido: fica o default, que é melhor que uma lista vazia. */
    }
  };

  const salvarCategorias = async (updated: string[]) => {
    const { error } = await supabase.from('configuracoes_texto').upsert(
      { chave: CONF_KEY, valor: JSON.stringify(updated) },
      { onConflict: 'chave' },
    );
    /* Falar quando falha: era o silêncio aqui que escondia o bug do campo
       numérico por todo esse tempo. */
    if (error) {
      toast({ title: 'Não foi possível salvar as categorias', description: error.message, variant: 'destructive' });
      return;
    }
    setCategorias(updated);
  };

  // ── Carrega acessos ──
  /* `loading` só na primeira carga: recarregar depois de salvar apagava a
     lista inteira e fechava as seções que estavam abertas. */
  const primeiraCarga = useRef(true);

  const load = async () => {
    if (primeiraCarga.current) setLoading(true);
    const { data, error } = await supabase
      .from('acessos')
      .select('*')
      .is('deletado_em', null)
      .order('categoria')
      .order('ferramenta');
    if (error) toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    setAcessos(data || []);
    setLoading(false);
    primeiraCarga.current = false;
  };

  useEffect(() => { carregarCategorias(); load(); }, []);

  /* O filtro mostra o que EXISTE nos dados; o formulário mostra o que é
     permitido escolher. São perguntas diferentes, por isso duas listas. */
  const categoriasEmUso = useMemo(() => [...new Set(acessos.map(a => a.categoria))].sort(), [acessos]);

  const filtered = useMemo(() => {
    let list = acessos;
    if (!showInativos) list = list.filter(a => a.status === 'ativo');
    if (filtroCategoria !== 'todos') list = list.filter(a => a.categoria === filtroCategoria);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.ferramenta.toLowerCase().includes(q) ||
        (a.login || '').toLowerCase().includes(q) ||
        (a.notas || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [acessos, showInativos, filtroCategoria, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Acesso[]>();
    for (const a of filtered) {
      if (!map.has(a.categoria)) map.set(a.categoria, []);
      map.get(a.categoria)!.push(a);
    }
    return [...map.entries()];
  }, [filtered]);

  const openNew = () => {
    setEditingId(null);
    setForm(blankForm(categorias[0] || ''));
    setGerenciando(false);
    setOpen(true);
  };
  const openEdit = (a: Acesso) => {
    setEditingId(a.id);
    setForm({
      ferramenta: a.ferramenta, categoria: a.categoria,
      url: a.url || '', login: a.login || '',
      senha: a.senha || '', status: a.status, notas: a.notas || '',
    });
    setGerenciando(false);
    setOpen(true);
  };

  const save = async () => {
    if (!form.ferramenta.trim())
      return toast({ title: 'Nome da ferramenta obrigatório', variant: 'destructive' });
    setSaving(true);
    const payload = {
      ferramenta:    form.ferramenta.trim(),
      categoria:     form.categoria,
      url:           form.url.trim()   || null,
      login:         form.login.trim() || null,
      senha:         form.senha.trim() || null,
      status:        form.status,
      notas:         form.notas.trim() || null,
      /* `atualizado_em` saiu daqui: virou gatilho no banco, para escrita por
         fora do formulário também carimbar. */
      atualizado_por: user?.id ?? null,
    };
    const { error } = editingId
      ? await supabase.from('acessos').update(payload).eq('id', editingId)
      : await supabase.from('acessos').insert({ ...payload, criado_por: user?.id ?? null });
    setSaving(false);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Ferramenta atualizada' : 'Ferramenta adicionada' });
    setOpen(false);
    load();
  };

  /*
    Excluir some da lista, mas guarda a linha.

    Era `DELETE` definitivo. Num cofre de credenciais a linha apagada é a única
    cópia da senha — e não havia histórico nem quem fez para reconstruir depois.
  */
  const remove = async (a: Acesso) => {
    if (!(await confirm({
      title: `Excluir "${a.ferramenta}"?`,
      description: 'Ela sai da lista, mas fica guardada — dá para recuperar pelo banco.',
    }))) return;
    const { data, error } = await supabase.from('acessos')
      .update({ deletado_em: new Date().toISOString(), deletado_por: user?.id ?? null })
      .eq('id', a.id).select('id');
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    if (!data?.length) return toast({ title: 'Só admin pode excluir', variant: 'destructive' });
    toast({ title: 'Ferramenta excluída', description: 'Guardada — não se preocupe.' });
    load();
  };

  return (
    /*
      `hideFilters` porque esta tela nao le `useFilters`: conta de anuncio e
      periodo nao tem o que fazer numa lista de ferramentas, e a barra oferecia
      dois controles que nao mudavam nada. A busca e o filtro de categoria que
      valem estao logo abaixo.
    */
    <DashboardLayout title="Acessos" hideFilters hideTitle>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar ferramenta, login..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
          <SelectTrigger className="w-48 h-8 text-sm">
            <SelectValue placeholder="Todas as categorias" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as categorias</SelectItem>
            {categoriasEmUso.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <button
          onClick={() => setShowInativos(v => !v)}
          className={cn(
            'flex items-center h-8 px-3 text-sm rounded-md border transition-colors',
            showInativos
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-input bg-background text-muted-foreground hover:text-foreground',
          )}
        >
          {showInativos ? 'Exibindo todos' : 'Apenas ativos'}
        </button>

        {isAdmin && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Nova ferramenta
          </Button>
        )}
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Carregando...</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Nenhuma ferramenta encontrada.</div>
      ) : (
        grouped.map(([categoria, itens]) => (
          <CategoriaSection
            key={categoria}
            categoria={categoria}
            itens={itens}
            isAdmin={isAdmin}
            onEdit={openEdit}
            onDelete={remove}
          />
        ))
      )}

      {/* Dialog CRUD */}
      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setGerenciando(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar ferramenta' : 'Nova ferramenta'}</DialogTitle>
          </DialogHeader>

          {gerenciando ? (
            // ── Painel de categorias ──
            <CategoriasPanel
              categorias={categorias}
              acessos={acessos}
              onClose={() => setGerenciando(false)}
              onSave={async (updated) => {
                await salvarCategorias(updated);
                // Se a categoria escolhida no formulário não existe mais, corrige
                if (!updated.includes(form.categoria) && updated.length > 0) {
                  setForm(f => ({ ...f, categoria: updated[0] }));
                }
              }}
            />
          ) : (
            // ── Formulário principal ──
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.ferramenta}
                    onChange={e => setForm({ ...form, ferramenta: e.target.value })}
                    className="mt-1" placeholder="Ex: Notion"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Categoria</Label>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setGerenciando(true)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Settings2 className="h-3 w-3" />
                        Gerenciar
                      </button>
                    )}
                  </div>
                  <Select value={form.categoria} onValueChange={v => setForm({ ...form, categoria: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categorias.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>URL de acesso</Label>
                <Input
                  value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })}
                  className="mt-1" placeholder="https://..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Login / E-mail</Label>
                  <Input
                    value={form.login}
                    onChange={e => setForm({ ...form, login: e.target.value })}
                    className="mt-1" placeholder="usuario@email.com"
                  />
                </div>
                <div>
                  <Label>Senha</Label>
                  <Input
                    value={form.senha}
                    onChange={e => setForm({ ...form, senha: e.target.value })}
                    className="mt-1" placeholder="••••••••"
                  />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as 'ativo' | 'inativo' })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Observações</Label>
                <Textarea
                  value={form.notas}
                  onChange={e => setForm({ ...form, notas: e.target.value })}
                  className="mt-1 min-h-[60px] text-sm"
                  placeholder="Informações adicionais, serial keys, etc."
                />
              </div>
            </div>
          )}

          {!gerenciando && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Adicionar'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
