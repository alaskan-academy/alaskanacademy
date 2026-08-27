import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link2, Bold, Italic, Underline, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type Cargo = { id: string; nome: string; multiplicador: string; cor: string };
type EditorDetalhe = {
  id: string;
  nome: string;
  cargo_id: string;
  data_inicio: string;
  ativo: boolean;
  observacoes: string;
  multiplicador: string;
};

const fmtMult = (m: string | number) => `${parseFloat(String(m)).toFixed(2)}x`;

// ── Rich text editor sem dependências externas ───────────────────────────────

function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = value ?? '';
  }, []); // only on mount — controlled by parent via value prop initial only

  const saveRange = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  };

  const restoreRange = () => {
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const exec = (cmd: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false);
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const openLink = () => {
    saveRange();
    setLinkUrl('');
    setShowLink(true);
  };

  const applyLink = () => {
    restoreRange();
    editorRef.current?.focus();
    if (linkUrl.trim()) document.execCommand('createLink', false, linkUrl.trim());
    setShowLink(false);
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const cancelLink = () => {
    setShowLink(false);
  };

  return (
    <div className="border border-border rounded-md overflow-hidden text-xs">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border bg-secondary/30">
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); exec('bold'); }}
          className="p-1.5 rounded hover:bg-secondary transition-colors"
          title="Negrito"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); exec('italic'); }}
          className="p-1.5 rounded hover:bg-secondary transition-colors"
          title="Itálico"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); exec('underline'); }}
          className="p-1.5 rounded hover:bg-secondary transition-colors"
          title="Sublinhado"
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); openLink(); }}
          className="p-1.5 rounded hover:bg-secondary transition-colors"
          title="Inserir link"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Link input inline */}
      {showLink && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-secondary/20">
          <input
            autoFocus
            type="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') cancelLink();
            }}
            placeholder="https://..."
            className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button type="button" onClick={applyLink} title="Aplicar" className="p-1 rounded hover:bg-primary/10 text-primary">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={cancelLink} title="Cancelar" className="p-1 rounded hover:bg-secondary">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current?.innerHTML ?? '')}
        className={cn(
          'min-h-[80px] max-h-[200px] overflow-y-auto p-2.5 focus:outline-none',
          '[&_a]:text-primary [&_a]:underline',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground',
        )}
        data-placeholder="Observações sobre o editor..."
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function UsuarioPerfisTab() {
  const [editores, setEditores]     = useState<EditorDetalhe[]>([]);
  const [cargos, setCargos]         = useState<Cargo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [formMap, setFormMap]       = useState<Record<string, Partial<EditorDetalhe>>>({});
  const [savingMap, setSavingMap]   = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    // `multiplicador` saiu de `editores` para `editores_remuneracao`, que tem
    // RLS própria — pedi-lo aqui pelo nome antigo passaria a dar erro de
    // coluna inexistente, e a aba inteira ficaria vazia.
    const [{ data: eds }, { data: crgs }, { data: rem }] = await Promise.all([
      supabase
        .from('editores')
        .select('id, nome, cargo_id, data_inicio, ativo')
        .order('nome'),
      supabase.from('cargos').select('id, nome, multiplicador, cor').order('ordem'),
      supabase.from('editores_remuneracao').select('editor_id, multiplicador, observacoes'),
    ]);
    type Remuneracao = { editor_id: string; multiplicador: number | null; observacoes: string | null };
    const remPorEditor = new Map<string, Remuneracao>(
      ((rem ?? []) as Remuneracao[]).map(r => [r.editor_id, r]),
    );
    setEditores(
      (eds ?? []).map(e => {
        const r = remPorEditor.get(e.id);
        return {
          id: e.id,
          nome: e.nome ?? '',
          cargo_id: e.cargo_id ?? '',
          data_inicio: e.data_inicio ?? '',
          ativo: e.ativo ?? true,
          observacoes: r?.observacoes ?? '',
          multiplicador: r?.multiplicador != null ? String(r.multiplicador) : '',
        };
      }),
    );
    setCargos(crgs ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getForm = (id: string): Partial<EditorDetalhe> => {
    const base = editores.find(e => e.id === id) ?? {};
    return { ...base, ...formMap[id] };
  };

  const setField = (id: string, field: keyof EditorDetalhe, value: unknown) => {
    setFormMap(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }));
  };

  const handleSave = async (ed: EditorDetalhe) => {
    const f = getForm(ed.id);
    setSavingMap(prev => ({ ...prev, [ed.id]: true }));
    const multiplicador = (f.multiplicador !== '' && f.multiplicador != null)
      ? parseFloat(String(f.multiplicador))
      : null;

    const { error } = await supabase.from('editores').update({
      nome: f.nome ?? ed.nome,
      data_inicio: f.data_inicio || null,
      ativo: f.ativo ?? ed.ativo,
    }).eq('id', ed.id);

    // Multiplicador e observações agora moram em outra tabela, com escrita só
    // de admin. `upsert` porque o editor pode não ter linha de remuneração
    // ainda — quem nunca teve nenhum dos dois não entrou na carga inicial.
    const { error: erroRem } = error ? { error: null } : await supabase
      .from('editores_remuneracao')
      .upsert({
        editor_id: ed.id,
        multiplicador,
        observacoes: f.observacoes ?? null,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'editor_id' });

    setSavingMap(prev => ({ ...prev, [ed.id]: false }));
    if (error || erroRem) return toast({ title: 'Erro ao salvar', variant: 'destructive' });
    toast({ title: 'Perfil atualizado' });
    load();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Informações profissionais e observações dos editores vinculados.
      </p>

      {loading ? (
        <div className="text-muted-foreground text-sm animate-pulse py-8 text-center">Carregando...</div>
      ) : editores.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhum editor cadastrado. Vincule editores aos usuários na aba Acessos.
        </div>
      ) : (
        <div className="space-y-4">
          {editores.map(ed => {
            const f = getForm(ed.id);
            const cargo = cargos.find(c => c.id === (f.cargo_id ?? ed.cargo_id));
            const isSaving = savingMap[ed.id];

            return (
              <div key={ed.id} className="bg-card border border-border rounded-lg p-4 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold">{ed.nome}</h4>
                      {cargo && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: `${cargo.cor}20`, color: cargo.cor }}
                        >
                          {cargo.nome}
                        </span>
                      )}
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium border',
                        (f.ativo ?? ed.ativo)
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-secondary text-muted-foreground border-border',
                      )}>
                        {(f.ativo ?? ed.ativo) ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                  </div>

                  {/* Toggle ativo */}
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <span className="text-xs text-muted-foreground">Ativo</span>
                    <input
                      type="checkbox"
                      checked={f.ativo ?? ed.ativo}
                      onChange={e => setField(ed.id, 'ativo', e.target.checked)}
                      className="rounded"
                    />
                  </label>
                </div>

                {/* Campos */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Nome de exibição</Label>
                    <Input
                      className="mt-1 h-8 text-xs"
                      value={f.nome ?? ed.nome}
                      onChange={e => setField(ed.id, 'nome', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Data de início</Label>
                    <Input
                      type="date"
                      className="mt-1 h-8 text-xs"
                      value={f.data_inicio ?? ed.data_inicio}
                      onChange={e => setField(ed.id, 'data_inicio', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">
                      Multiplicador individual
                      {cargo && (
                        <span className="ml-1 text-muted-foreground font-normal">
                          (padrão do cargo: {fmtMult(cargo.multiplicador)})
                        </span>
                      )}
                    </Label>
                    <Input
                      type="number" step="0.01" min="0"
                      className="mt-1 h-8 text-xs"
                      placeholder={cargo ? fmtMult(cargo.multiplicador) : 'Ex: 1.20'}
                      value={f.multiplicador ?? ed.multiplicador}
                      onChange={e => setField(ed.id, 'multiplicador', e.target.value)}
                    />
                  </div>
                </div>

                {/* Observações com rich text */}
                <div>
                  <Label className="text-xs mb-1.5 block">Observações</Label>
                  <RichTextEditor
                    value={f.observacoes ?? ed.observacoes}
                    onChange={html => setField(ed.id, 'observacoes', html)}
                  />
                </div>

                <div className="flex justify-end">
                  <Button size="sm" onClick={() => handleSave(ed)} disabled={isSaving}>
                    {isSaving ? 'Salvando...' : 'Salvar perfil'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
