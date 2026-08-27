import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

type Cargo = { id: string; nome: string; multiplicador: string; cor: string };
type EditorDetalhe = {
  id: string;
  nome: string;
  cargo_id: string;
  data_inicio: string;
  ativo: boolean;
  multiplicador: string;
};

const fmtMult = (m: string | number) => `${parseFloat(String(m)).toFixed(2)}x`;

/*
 * O  morava aqui — 130 linhas de contentEditable com
 * negrito, itálico e link, escritas à mão. Existia só para o campo de
 * observações, que virou a linha do tempo em Editores › Perfis. Sem o campo,
 * ele ficou definido e nunca usado.
 */

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
      supabase.from('editores_remuneracao').select('editor_id, multiplicador'),
    ]);
    type Remuneracao = { editor_id: string; multiplicador: number | null };
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

                {/* O editor de observações morava aqui, e era um campo só que
                    se reescrevia por inteiro a cada save — com as datas
                    digitadas à mão no começo de cada parágrafo. Virou a linha
                    do tempo em Editores › Perfis, onde cada nota tem data,
                    tipo e não apaga a anterior. Dois lugares para escrever a
                    mesma coisa divergiriam na primeira semana. */}
                <p className="text-xs text-muted-foreground">
                  Feedback, promoção e remuneração ficam na linha do tempo do
                  editor, em <span className="text-foreground">Editores › Perfis</span>.
                </p>

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
