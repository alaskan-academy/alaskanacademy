import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import {
  Search, Plus, Edit2, Trash2, Loader2, FileText, ChevronRight,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Categoria {
  id: string;
  nome: string;
  icone: string;
  descricao: string | null;
  ativo: boolean;
  artigo_count: number;
}

interface ArtigoSearch {
  id: string;
  titulo: string;
  categoria_id: string;
  categoria_nome: string;
  categoria_icone: string;
  /** Pedaço do texto com a palavra encontrada entre « », vindo do banco. */
  trecho: string;
}

/**
 * Mostra o trecho com o que casou em destaque.
 *
 * O banco devolve « » em vez de HTML de propósito: quem monta os elementos é o
 * React, e injetar HTML vindo de texto que alguém escreveu seria abrir a porta
 * que o CLAUDE.md manda manter fechada. Aqui o marcador é só um separador.
 */
function Trecho({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(«[^»]*»)/g).map((p, i) =>
        p.startsWith('«') && p.endsWith('»') ? (
          <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

// ── Emoji options ─────────────────────────────────────────────────────────────

const ICON_OPTIONS = [
  '📋', '🎨', '📦', '🚀', '⚙️', '📊', '🎯', '💡',
  '🔧', '📝', '🤝', '💬', '🔒', '🌐', '📈', '🎬',
  '🛒', '📣', '✅', '🧪',
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProcessosPage() {
  const { perfil } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const isAdmin = perfil?.is_admin;

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [artigos, setArtigos] = useState<ArtigoSearch[]>([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [buscando, setBuscando] = useState(false);

  // Category form
  const [formOpen, setFormOpen] = useState(false);
  const [editCat, setEditCat] = useState<Categoria | null>(null);
  const [fNome, setFNome] = useState('');
  const [fIcone, setFIcone] = useState('📋');
  const [fDesc, setFDesc] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    const [{ data: cats }, { data: arts }] = await Promise.all([
      supabase
        .from('processos_categorias')
        .select('*')
        .eq('ativo', true)
        .order('criado_em', { ascending: false }),
      // Só o que a contagem precisa. O texto dos artigos não vem mais para cá:
      // a busca acontece no banco, e baixar o conteúdo de tudo a cada abertura
      // da página era justamente o que não escalava.
      supabase
        .from('processos_artigos')
        .select('categoria_id, categorias_adicionais')
        .eq('ativo', true),
    ]);

    // Um artigo conta na categoria principal E em cada uma das adicionais: é o
    // mesmo artigo aparecendo em dois lugares, e as duas listas o mostram.
    const countMap: Record<string, number> = {};
    type LinhaCount = { categoria_id: string; categorias_adicionais: string[] | null };
    ((arts ?? []) as LinhaCount[]).forEach(a => {
      countMap[a.categoria_id] = (countMap[a.categoria_id] || 0) + 1;
      (a.categorias_adicionais ?? []).forEach(catId => {
        countMap[catId] = (countMap[catId] || 0) + 1;
      });
    });

    setCategorias(
      ((cats ?? []) as Omit<Categoria, 'artigo_count'>[])
        .map(c => ({ ...c, artigo_count: countMap[c.id] || 0 }))
    );
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Search ────────────────────────────────────────────────────────────────

  /**
   * A busca vive no banco, e lê o CONTEÚDO — não só o título.
   *
   * Antes era um `titulo.includes()` sobre a lista já carregada, e procurar uma
   * palavra que estivesse no corpo do artigo devolvia "0 resultados" numa tela
   * cujo campo promete "Buscar processos, políticas, guias...".
   *
   * 250ms de espera antes de consultar: sem isso, "aprendizado" dispararia onze
   * consultas, e a resposta da quarta poderia chegar depois da última e pintar
   * a tela com o resultado errado.
   */
  useEffect(() => {
    const termo = busca.trim();
    if (!termo) { setArtigos([]); setBuscando(false); return; }

    setBuscando(true);
    let vivo = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('fn_buscar_processos', { p_termo: termo });
      if (!vivo) return;
      if (error) {
        toast({ title: 'Erro na busca', description: error.message, variant: 'destructive' });
        setArtigos([]);
      } else {
        setArtigos((data ?? []) as ArtigoSearch[]);
      }
      setBuscando(false);
    }, 250);

    // `vivo` além do clearTimeout: o timer morre, mas uma consulta JÁ EM VOO
    // continua e voltaria para escrever por cima de uma busca mais nova.
    return () => { vivo = false; clearTimeout(t); };
  }, [busca]);

  const resultados = artigos;

  // ── Category CRUD ─────────────────────────────────────────────────────────

  const openNew = () => {
    setEditCat(null);
    setFNome('');
    setFIcone('📋');
    setFDesc('');
    setFormOpen(true);
  };

  const openEdit = (cat: Categoria, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditCat(cat);
    setFNome(cat.nome);
    setFIcone(cat.icone);
    setFDesc(cat.descricao || '');
    setFormOpen(true);
  };

  /**
   * Excluir a categoria, e fazer com os processos o que o diálogo promete.
   *
   * O texto dizia "Todos os processos vinculados a ela também serão removidos"
   * — e não removia nenhum. Os artigos ficavam `ativo = true` apontando para
   * uma categoria morta: sumiam da navegação, mas continuavam achaveis pela
   * busca, levando a uma categoria que não existe mais. Ninguém tinha notado
   * porque nenhuma categoria havia sido excluída ainda; era armadilha armada.
   *
   * E não basta apagar tudo. Um processo que TAMBÉM aparece em outra categoria
   * continua alcançável por lá — matá-lo seria destruir conteúdo vivo por causa
   * de uma categoria que se resolveu arrumar. Esse é promovido: a primeira das
   * adicionais vira a principal.
   */
  const handleDelete = async (cat: Categoria, e: React.MouseEvent) => {
    e.stopPropagation();

    // Contar ANTES de perguntar: quem confirma precisa saber o tamanho do que
    // está apagando, e "3 processos" é uma informação diferente de "nenhum".
    const { data: doCat } = await supabase
      .from('processos_artigos')
      .select('id, categorias_adicionais')
      .eq('categoria_id', cat.id)
      .eq('ativo', true);

    type Linha = { id: string; categorias_adicionais: string[] | null };
    const artigosDaCat = (doCat ?? []) as Linha[];
    const mudam = artigosDaCat.filter(a => (a.categorias_adicionais ?? []).some(id => id !== cat.id));
    const morrem = artigosDaCat.filter(a => !(a.categorias_adicionais ?? []).some(id => id !== cat.id));

    const partes = [
      morrem.length > 0
        ? `${morrem.length} processo${morrem.length > 1 ? 's' : ''} ${morrem.length > 1 ? 'serão excluídos' : 'será excluído'} junto`
        : null,
      mudam.length > 0
        ? `${mudam.length} que também ${mudam.length > 1 ? 'aparecem' : 'aparece'} em outra categoria ${mudam.length > 1 ? 'continuam' : 'continua'} lá`
        : null,
    ].filter(Boolean);

    const ok = await confirm({
      title: `Excluir a categoria "${cat.nome}"?`,
      description: partes.length > 0
        ? `${partes.join('; e ')}.`
        : 'A categoria está vazia — nada mais é afetado.',
      confirmText: 'Excluir',
      destructive: true,
    });
    if (!ok) return;

    const agora = new Date().toISOString();

    // Os que sobrevivem primeiro: se a categoria caísse antes e algo falhasse
    // no meio, eles ficariam exatamente órfãos como antes.
    for (const a of mudam) {
      const nova = (a.categorias_adicionais ?? []).find(id => id !== cat.id)!;
      const { error } = await supabase
        .from('processos_artigos')
        .update({
          categoria_id: nova,
          categorias_adicionais: (a.categorias_adicionais ?? []).filter(id => id !== nova && id !== cat.id),
          atualizado_em: agora,
        })
        .eq('id', a.id);
      if (error) {
        toast({ title: 'Erro ao mover os processos', description: error.message, variant: 'destructive' });
        return;
      }
    }

    if (morrem.length > 0) {
      const { error } = await supabase
        .from('processos_artigos')
        .update({ ativo: false, atualizado_em: agora })
        .in('id', morrem.map(a => a.id));
      if (error) {
        toast({ title: 'Erro ao excluir os processos', description: error.message, variant: 'destructive' });
        return;
      }
    }

    const { error } = await supabase
      .from('processos_categorias')
      .update({ ativo: false, atualizado_em: agora })
      .eq('id', cat.id);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }

    toast({
      title: 'Categoria excluída',
      description: mudam.length > 0
        ? `${mudam.length} processo${mudam.length > 1 ? 's foram movidos' : ' foi movido'} para outra categoria.`
        : undefined,
    });
    load();
  };

  const handleSave = async () => {
    if (!fNome.trim()) return;
    setSaving(true);
    const payload = {
      nome: fNome.trim(),
      icone: fIcone,
      descricao: fDesc.trim() || null,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = editCat
      ? await supabase.from('processos_categorias').update(payload).eq('id', editCat.id)
      : await supabase.from('processos_categorias').insert({
          nome: payload.nome,
          icone: payload.icone,
          descricao: payload.descricao,
        });
    setSaving(false);
    if (error) {
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editCat ? 'Categoria atualizada' : 'Categoria criada' });
    setFormOpen(false);
    load();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout title="Processos" hideFilters>
      <div className="max-w-5xl mx-auto">

        {/* ── Barra de busca ──
            Era um hero de 12rem com título, subtítulo e círculos decorativos,
            e as categorias começavam abaixo da dobra. O título já está no
            cabeçalho da página; repeti-lo aqui custava metade da primeira tela
            para não dizer nada de novo. Ficou a busca, que é o que se usa. */}
        <div className="flex items-center gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Buscar no título e no texto dos processos…"
              className="h-11 pl-10 text-[15px] rounded-xl bg-card border-border/60 focus-visible:border-primary/60 placeholder:text-muted-foreground/60"
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
            {busca && (
              <button
                type="button"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                onClick={() => setBusca('')}
                aria-label="Limpar busca"
              >
                ✕
              </button>
            )}
          </div>

          {isAdmin && (
            <Button size="sm" variant="outline" onClick={openNew} className="h-11 gap-1.5 shrink-0">
              <Plus className="h-3.5 w-3.5" />
              Nova Categoria
            </Button>
          )}
        </div>

        {/* ── Search results ── */}
        {busca.trim() ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              {buscando ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  buscando…
                </span>
              ) : (
                <>
                  {resultados.length}{' '}
                  resultado{resultados.length !== 1 ? 's' : ''} para{' '}
                  <span className="text-foreground font-medium">&ldquo;{busca}&rdquo;</span>
                  <span className="text-muted-foreground/60"> — no título e no texto</span>
                </>
              )}
            </p>

            {buscando ? null : resultados.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
                <Search className="h-8 w-8 mx-auto mb-3 opacity-25" />
                <p className="font-medium">Nenhum processo encontrado</p>
                <p className="text-sm mt-1">Tente outra palavra-chave</p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border/50">
                {resultados.map(a => (
                  <button
                    key={a.id}
                    onClick={() => navigate(`/processos/${a.id}`)}
                    className="w-full flex items-start gap-3.5 px-5 py-4 hover:bg-accent transition-colors text-left group"
                  >
                    <span className="text-xl shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-primary/8">
                      {a.categoria_icone}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {a.titulo}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.categoria_nome}</p>
                      {/* O trecho responde "por que este apareceu?" — sem ele,
                          um resultado que casou pelo corpo do texto parece
                          aleatório, já que o título não tem a palavra. */}
                      {a.trecho && (
                        <p className="text-xs text-muted-foreground/80 mt-1.5 leading-relaxed line-clamp-2">
                          <Trecho texto={a.trecho} />
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center group-hover:translate-x-0.5 transition-transform" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Category grid ── */
          loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : categorias.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground bg-card border border-border rounded-xl">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-25" />
              <p className="font-medium">Nenhuma categoria ainda</p>
              {isAdmin && (
                <p className="text-sm mt-1">Clique em &ldquo;Nova Categoria&rdquo; para começar</p>
              )}
            </div>
          ) : (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4 px-0.5">
                Categorias
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorias.map(cat => (
                  <div
                    key={cat.id}
                    // `div` e não `button` porque há botões de editar/excluir
                    // dentro, e botão dentro de botão é HTML inválido. Mas sem
                    // estes três atributos o card não existia para o teclado:
                    // não recebia Tab, não respondia a Enter.
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/processos/c/${cat.id}`)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/processos/c/${cat.id}`);
                      }
                    }}
                    className="relative group bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {/* Admin controls */}
                    {isAdmin && (
                      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                          onClick={e => openEdit(cat, e)}
                          className="p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={e => handleDelete(cat, e)}
                          className="p-1.5 rounded-md bg-background/80 backdrop-blur-sm border border-border hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}

                    {/* Icon bubble */}
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-2xl mb-4 group-hover:bg-primary/15 transition-colors">
                      {cat.icone}
                    </div>

                    <h3 className="font-semibold text-foreground text-[15px] leading-snug mb-1.5 pr-10">
                      {cat.nome}
                    </h3>

                    {cat.descricao && (
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3">
                        {cat.descricao}
                      </p>
                    )}

                    <div className="flex items-center gap-1 text-xs font-medium text-primary mt-2">
                      <span>{cat.artigo_count} artigo{cat.artigo_count !== 1 ? 's' : ''}</span>
                      <ChevronRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        )}
      </div>

      {/* ── Category form dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editCat ? 'Editar Categoria' : 'Nova Categoria'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">

            {/* Icon picker */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Ícone</Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {ICON_OPTIONS.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setFIcone(ic)}
                    className={cn(
                      'text-xl p-2 rounded-lg border transition-all',
                      fIcone === ic
                        ? 'border-primary bg-primary/10 scale-110'
                        : 'border-border hover:border-muted-foreground/50'
                    )}
                  >
                    {ic}
                  </button>
                ))}
                <Input
                  className="w-14 text-center text-lg px-1"
                  value={fIcone}
                  onChange={e => setFIcone(e.target.value)}
                  maxLength={2}
                  placeholder="✨"
                  title="Ou digite qualquer emoji"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="cat-nome">Nome *</Label>
              <Input
                id="cat-nome"
                className="mt-1.5"
                value={fNome}
                onChange={e => setFNome(e.target.value)}
                placeholder="Ex: Tráfego Pago"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
            </div>

            <div>
              <Label htmlFor="cat-desc">Descrição</Label>
              <Textarea
                id="cat-desc"
                className="mt-1.5 resize-none"
                rows={2}
                value={fDesc}
                onChange={e => setFDesc(e.target.value)}
                placeholder="Breve descrição desta categoria..."
              />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving || !fNome.trim()}>
                {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                {editCat ? 'Salvar' : 'Criar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
