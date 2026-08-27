import { sanitizarHtml } from '@/lib/sanitizar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/formatters';
import { ChevronRight, Lock, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

type Cargo = { id: string; nome: string; multiplicador: number; cor: string | null; ordem: number };
type Editor = { id: string; nome: string; cargo_id: string | null; data_inicio: string | null; ativo: boolean; observacoes: string | null; usuario_id: string | null; multiplicador: number | null };

export function PerfisTab() {
  const { user, perfil: authPerfil } = useAuth();
  const isAdmin = authPerfil?.is_admin ?? false;

  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [editores, setEditores] = useState<Editor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Editor | null>(null);

  const load = async () => {
    setLoading(true);
    const [c, e, rem] = await Promise.all([
      supabase.from('cargos').select('*').order('ordem'),
      supabase.from('editores').select('*').not('usuario_id', 'is', null).order('nome'),
      supabase.from('editores_remuneracao').select('editor_id, multiplicador, observacoes'),
    ]);
    const cgs: Cargo[] = c.data || [];

    /**
     * Multiplicador e observações mudaram de casa: saíram de `editores` para
     * `editores_remuneracao`, que restringe por RLS. A linha do editor
     * continua legível por todos — é dela que saem os nomes —, e o que é
     * pagamento não.
     *
     * As observações vieram junto porque guardam salário por extenso: numa
     * delas está "aumento gradual de R$300 no salário, passando de R$2.200
     * para R$2.500". Proteger o multiplicador e deixar a prosa que diz o valor
     * seria proteger metade.
     *
     * Quem não pode ver recebe `null`, e a tela já sabia desenhar isso: todo
     * lugar que mostra estes campos testa antes e cai num "—".
     */
    type Remuneracao = { editor_id: string; multiplicador: number | null; observacoes: string | null };
    const remPorEditor = new Map<string, Remuneracao>(
      ((rem.data ?? []) as Remuneracao[]).map(r => [r.editor_id, r]),
    );
    const eds: Editor[] = (e.data || []).map((ed: Editor) => ({
      ...ed,
      multiplicador: remPorEditor.get(ed.id)?.multiplicador ?? null,
      observacoes:   remPorEditor.get(ed.id)?.observacoes   ?? null,
    }));
    setCargos(cgs);
    setEditores(eds);
    // Sincroniza o editor selecionado com os dados frescos do banco
    setSelected(prev => prev ? (eds.find(e => e.id === prev.id) ?? prev) : prev);
    // não-admin sem cargo de liderança: abre automaticamente o próprio perfil
    if (!isAdmin && user) {
      const mine = eds.find(ed => ed.usuario_id === user.id) ?? null;
      const cgsMap = Object.fromEntries(cgs.map(cg => [cg.id, cg]));
      const myCargoNome = mine?.cargo_id ? (cgsMap[mine.cargo_id]?.nome || '') : '';
      const normalizado = myCargoNome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const isHeadOrAbove = normalizado.includes('head') || normalizado.includes('lider');
      if (!isHeadOrAbove) setSelected(mine);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  const canSeeAll = useMemo(() => {
    if (isAdmin) return true;
    const mine = editores.find(ed => ed.usuario_id === user?.id);
    if (!mine?.cargo_id) return false;
    const cargo = cargoMap[mine.cargo_id];
    if (!cargo) return false;
    const nome = cargo.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return nome.includes('head') || nome.includes('lider');
  }, [isAdmin, editores, cargoMap, user]);


  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium">Editores</h3>
        </div>
        <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
          {loading && <div className="p-4 text-sm text-muted-foreground">Carregando...</div>}
          {!loading && editores.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhum editor cadastrado</div>}
          {editores.map(ed => {
            const cg = ed.cargo_id ? cargoMap[ed.cargo_id] : null;
            const isMine = ed.usuario_id === user?.id;
            const canView = canSeeAll || isMine;
            return (
              <button
                key={ed.id}
                onClick={() => canView && setSelected(ed)}
                disabled={!canView}
                className={cn(
                  'w-full text-left px-4 py-3 flex items-center justify-between transition-colors',
                  canView ? 'hover:bg-secondary/50 cursor-pointer' : 'cursor-default',
                  selected?.id === ed.id ? 'bg-secondary' : '',
                  !ed.ativo && 'opacity-50',
                )}
              >
                <div className={cn('min-w-0 flex-1', !canView && 'blur-sm select-none')}>
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {ed.nome}
                    {!ed.ativo && <Badge variant="outline" className="text-xs text-muted-foreground">inativo</Badge>}
                  </div>
                  {cg && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: cg.cor || '#888' }} />
                      {cg.nome} · <span className={cn(ed.multiplicador != null ? 'text-primary font-medium' : 'text-muted-foreground')}>
                        {ed.multiplicador != null ? `${Number(ed.multiplicador).toFixed(2)}x` : '—'}
                      </span>
                    </div>
                  )}
                </div>
                {canView
                  ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <Lock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                }
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <EditorDetail
            editor={selected}
            cargos={cargos}
            cargoMap={cargoMap}
            onChanged={load}
            isAdmin={isAdmin}
          />
        ) : (
          <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
            Selecione um editor à esquerda para ver detalhes
          </div>
        )}
      </div>

    </div>
  );
}


function EditorDetail({ editor, cargos, cargoMap, onChanged, isAdmin }: {
  editor: Editor; cargos: Cargo[]; cargoMap: Record<string, Cargo>;
  onChanged: () => void; isAdmin: boolean;
}) {
  const [notas, setNotas] = useState<any[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<any[]>([]);

  const load = async () => {
    const [p, a] = await Promise.all([
      supabase.from('editor_notas').select('*').eq('editor_id', editor.id).order('data', { ascending: false }),
      supabase.from('avaliacoes_mensais').select('*').eq('editor_id', editor.id).order('mes_referencia', { ascending: false }),
    ]);
    setNotas(p.data || []); setAvaliacoes(a.data || []);
  };
  useEffect(() => { load(); }, [editor.id]);

  const cargoAtual = editor.cargo_id ? cargoMap[editor.cargo_id] : null;

  /*
   * `addPromocao` morava aqui e pedia o UUID do cargo por `prompt()` do
   * navegador — "ID do cargo (ou cancele e use o formulário abaixo)". Nada
   * chamava. Saiu: o formulário que o próprio texto mandava usar é o certo.
   */

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{editor.nome}</h2>
            {cargoAtual && (
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: cargoAtual.cor || '#888' }} />
                {cargoAtual.nome}
                {editor.multiplicador != null ? (
                  <Badge variant="secondary">
                    {Number(editor.multiplicador).toFixed(2)}x <span className="opacity-60 ml-1">(individual)</span>
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">não definido</Badge>
                )}
              </div>
            )}
            <div className="flex items-center gap-3 mt-3">
              <div className="bg-secondary border border-border rounded-lg px-4 py-2 text-center min-w-[90px]">
                <div className="text-xs text-muted-foreground mb-0.5">Multiplicador</div>
                <div className="text-xl font-bold text-primary">
                  {editor.multiplicador != null ? Number(editor.multiplicador).toFixed(2) + 'x' : '—'}
                </div>
                {editor.multiplicador != null && (
                  <div className="text-xs text-muted-foreground mt-0.5">individual</div>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Início: {editor.data_inicio || '—'} · {editor.ativo ? 'Ativo' : 'Inativo'}
            </div>
          </div>
        </div>
      </div>

      {/* O blob de observações saía aqui, e o "Histórico de promoções" logo
          abaixo dele — um com 3.000 caracteres de texto datado à mão, o outro
          vazio. Viraram uma coisa só. */}
      <LinhaDoTempo editorId={editor.id} currentCargoId={editor.cargo_id} cargos={cargos}
                    cargoMap={cargoMap} items={notas} reload={load} onChanged={onChanged}
                    podeEscrever={isAdmin} />
      <HistoricoComissoes items={avaliacoes} />
      <HistoricoFolgas items={avaliacoes} />
    </div>
  );
}

const TIPO_NOTA: Record<string, { rotulo: string; cor: string }> = {
  promocao:    { rotulo: 'Promoção',   cor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' },
  feedback:    { rotulo: 'Feedback',   cor: 'bg-blue-500/10 text-blue-400 border-blue-500/25' },
  remuneracao: { rotulo: 'Remuneração', cor: 'bg-amber-500/10 text-amber-400 border-amber-500/25' },
};

/**
 * A carreira do editor em ordem, num lugar só.
 *
 * Antes eram duas coisas separadas na mesma tela: um blob de observações com
 * 3.000 caracteres — datas digitadas à mão no começo de cada parágrafo, texto
 * reescrito por inteiro a cada save — e, logo abaixo, um "Histórico de
 * promoções" que dizia "Sem registros". A tabela de eventos datados existia e
 * estava vazia enquanto a informação era digitada no campo ao lado.
 *
 * O tipo é o que faltava para as duas caberem juntas: `promocao` leva cargo,
 * `feedback` e `remuneracao` não. O banco garante isso — a promoção sem cargo
 * é recusada por CHECK, e não por confiança na tela.
 */
function LinhaDoTempo({ editorId, currentCargoId, cargos, cargoMap, items, reload, onChanged, podeEscrever }: any) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ tipo: 'feedback', cargo_id: '', data: '', texto: '' });

  const ehPromocao = form.tipo === 'promocao';

  // Cargos únicos por nome, menos o atual.
  //
  // A deduplicação por NOME está aqui porque o mesmo cargo existe uma vez por
  // setor — "Pleno" de Copy, de Editor e de Gestor de Tráfego. Isso significa
  // que a lista mostra um "Pleno" só, e o escolhido pode ser o de outro setor.
  // Filtrar pelo setor do editor é o certo, e depende de um dado que esta tela
  // ainda não carrega. Fica anotado, não escondido.
  const seen = new Set<string>();
  const currentNome = currentCargoId ? cargoMap[currentCargoId]?.nome : null;
  const cargosElegiveis = (cargos as Cargo[]).filter(c => {
    if (seen.has(c.nome)) return false;
    seen.add(c.nome);
    return c.nome !== currentNome;
  });

  const podeSalvar = !!form.data && !!form.texto.trim() && (!ehPromocao || !!form.cargo_id);

  const save = async () => {
    if (!podeSalvar) return;
    const { error } = await supabase.from('editor_notas').insert({
      editor_id: editorId,
      tipo: form.tipo,
      data: form.data,
      texto: form.texto.trim(),
      cargo_id: ehPromocao ? form.cargo_id : null,
    });
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });

    // Promoção move o cargo do editor; os outros dois tipos não mexem nele.
    if (ehPromocao) {
      await supabase.from('editores').update({ cargo_id: form.cargo_id }).eq('id', editorId);
      onChanged?.();
    }
    setOpen(false);
    setForm({ tipo: 'feedback', cargo_id: '', data: '', texto: '' });
    reload();
  };

  return (
    <Section title="Linha do tempo" onAdd={podeEscrever ? () => setOpen(true) : undefined}>
      {items.length === 0 ? <Empty /> : (
        <div className="divide-y divide-border/50">
          {items.map((n: any) => {
            const t = TIPO_NOTA[n.tipo] ?? { rotulo: n.tipo, cor: 'bg-muted text-muted-foreground border-border' };
            return (
              <div key={n.id} className="flex gap-3 px-3 py-3">
                <div className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {n.data ? new Date(n.data + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', t.cor)}>
                      {t.rotulo}
                    </span>
                    {n.cargo_id && cargoMap[n.cargo_id] && (
                      <span className="text-xs text-muted-foreground">{cargoMap[n.cargo_id].nome}</span>
                    )}
                  </div>
                  {n.texto
                    ? <p className="whitespace-pre-line text-sm text-foreground/85">{n.texto}</p>
                    : <p className="text-sm text-muted-foreground">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova nota</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v, cargo_id: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="feedback">Feedback</SelectItem>
                  <SelectItem value="promocao">Promoção</SelectItem>
                  <SelectItem value="remuneracao">Remuneração</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* O cargo só existe quando é promoção — pedir sempre seria pedir
                um dado que não se aplica, e o banco recusaria de todo jeito. */}
            {ehPromocao && (
              <div>
                <Label>Novo cargo</Label>
                <Select value={form.cargo_id} onValueChange={v => setForm({ ...form, cargo_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {cargosElegiveis.length === 0
                      ? <SelectItem value="__none__" disabled>Nenhum cargo disponível</SelectItem>
                      : cargosElegiveis.map((c: Cargo) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Data</Label>
              <Input type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} />
            </div>
            <div>
              <Label>Nota</Label>
              <Textarea rows={5} value={form.texto}
                        onChange={e => setForm({ ...form, texto: e.target.value })}
                        placeholder="O que ficou combinado" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={!podeSalvar}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function HistoricoComissoes({ items }: any) {
  const rows = [...items].sort((a: any, b: any) => (a.mes_referencia < b.mes_referencia ? 1 : -1));
  const totalEstimado = rows.reduce((s: number, i: any) => s + Number(i.bonus_estimado || 0), 0);
  const totalFinal = rows.reduce((s: number, i: any) => s + Number(i.bonus_total || 0), 0);
  return (
    <Section title="Histórico de comissões" extra={<span className="text-xs text-muted-foreground">Calculado das avaliações</span>}>
      {rows.length === 0 ? <Empty /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left py-2 px-3">Mês</th>
            <th className="text-left py-2 px-3">Bônus estimado</th>
            <th className="text-left py-2 px-3">Bônus total</th>
            <th className="text-left py-2 px-3">Avaliador</th>
          </tr></thead>
          <tbody>
            {rows.map((p: any) => (
              <tr key={p.id} className="border-b border-border/50">
                <td className="py-2 px-3">{p.mes_referencia}</td>
                <td className="py-2 px-3">{formatCurrency(Number(p.bonus_estimado || 0))}</td>
                <td className="py-2 px-3 font-medium">{formatCurrency(Number(p.bonus_total || 0))}</td>
                <td className="py-2 px-3 text-muted-foreground">{p.avaliador || '—'}</td>
              </tr>
            ))}
            <tr className="bg-secondary/40 font-medium">
              <td className="py-2 px-3">Total</td>
              <td className="py-2 px-3">{formatCurrency(totalEstimado)}</td>
              <td className="py-2 px-3 text-primary">{formatCurrency(totalFinal)}</td>
              <td className="py-2 px-3"></td>
            </tr>
          </tbody>
        </table>
      )}
    </Section>
  );
}

function HistoricoFolgas({ items }: any) {
  const rows = [...items].sort((a: any, b: any) => (a.mes_referencia < b.mes_referencia ? 1 : -1));
  const total = rows.reduce((s: number, i: any) => s + Number(i.folgas || 0), 0);
  return (
    <Section title="Folgas" extra={<span className="text-xs text-muted-foreground">Calculado das avaliações</span>}>
      {rows.length === 0 ? <Empty /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-muted-foreground border-b border-border">
            <th className="text-left py-2 px-3">Mês</th>
            <th className="text-left py-2 px-3">Folgas</th>
            <th className="text-left py-2 px-3">Avaliador</th>
          </tr></thead>
          <tbody>
            {rows.map((p: any) => (
              <tr key={p.id} className="border-b border-border/50">
                <td className="py-2 px-3">{p.mes_referencia}</td>
                <td className="py-2 px-3">{Number(p.folgas || 0)}</td>
                <td className="py-2 px-3 text-muted-foreground">{p.avaliador || '—'}</td>
              </tr>
            ))}
            <tr className="bg-secondary/40 font-medium">
              <td className="py-2 px-3">Total</td>
              <td className="py-2 px-3 text-primary">{total}</td>
              <td className="py-2 px-3"></td>
            </tr>
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Section({ title, extra, onAdd, children }: any) {
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3"><h4 className="text-sm font-medium">{title}</h4>{extra}</div>
        {onAdd && <Button size="sm" variant="outline" onClick={onAdd}><Plus className="h-4 w-4" /> Adicionar</Button>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
function Empty() { return <div className="p-6 text-sm text-muted-foreground text-center">Sem registros</div>; }
