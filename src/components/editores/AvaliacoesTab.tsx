import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { formatCurrency } from '@/lib/formatters';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type Opcao = { id: string; criterio_id: string; label: string; valor: number; ordem: number; ativo: boolean };
type Categoria = 'individual' | 'grupo' | 'meta';
type Criterio = { id: string; chave: string; label: string; tipo: 'single' | 'multi' | 'number'; ordem: number; ativo: boolean; categoria: Categoria; opcoes: Opcao[] };

const CATEGORIAS: { value: Categoria; label: string; description: string }[] = [
  { value: 'individual', label: 'Avaliação individual', description: 'Critérios avaliados por editor individualmente.' },
  { value: 'grupo', label: 'Avaliação em grupo', description: 'Critérios avaliados a partir do desempenho do time.' },
  { value: 'meta', label: 'Meta da empresa', description: 'Metas coletivas/empresariais que impactam todos.' },
];

const CHAVE_CRIATIVOS = 'criativos_escalados';
const CHAVE_VSL = 'vsl_escaladas';
const CHAVE_RESPONSAVEIS = 'editores_responsaveis';

export function AvaliacoesTab() {
  const confirm = useConfirm();
  const { user, perfil: authPerfil } = useAuth();
  const isAdmin = authPerfil?.is_admin ?? false;

  // editor vinculado ao usuário logado e seu cargo
  const [meuEditorId, setMeuEditorId]   = useState<string | null>(null);
  const [cargoDoUsuario, setCargoDoUsuario] = useState<string>('');

  const [editores, setEditores] = useState<any[]>([]);
  const [cargos, setCargos] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [filterEditor, setFilterEditor] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(blankForm());
  const [loading, setLoading] = useState(true);

  function blankForm() {
    return {
      editor_id: '', mes_referencia: '', data_lancamento: '', avaliador: '', perfil: '',
      bonus_total_override: '',
      feedback: '',
      responsaveis_ids: [] as string[],
      respostas: {} as Record<string, string | string[] | number>,
      multiplicador_snapshot: null as number | null, // congelado no momento do save
    };
  }

  const load = async () => {
    setLoading(true);
    const [e, a, c, o, cg] = await Promise.all([
      supabase.from('editores').select('id, nome, cargo_id, usuario_id, multiplicador').order('nome'),
      supabase.from('avaliacoes_mensais').select('*').order('mes_referencia', { ascending: false }),
      supabase.from('criterios_avaliacao').select('*').eq('ativo', true).order('ordem'),
      supabase.from('criterio_opcoes').select('*').eq('ativo', true).order('ordem'),
      supabase.from('cargos').select('*'),
    ]);
    const eds: any[] = e.data || [];
    const cgs: any[] = cg.data || [];
    setEditores(eds);
    setItems(a.data || []);
    setCargos(cgs);
    const opts = o.data || [];
    setCriterios((c.data || []).map((cr: any) => ({ ...cr, opcoes: opts.filter((x: any) => x.criterio_id === cr.id) })));

    // identifica editor + cargo do usuário logado
    const meuEditor = eds.find((ed: any) => ed.usuario_id === user?.id) ?? null;
    setMeuEditorId(meuEditor?.id ?? null);
    if (meuEditor?.cargo_id) {
      const cargo = cgs.find((cg: any) => cg.id === meuEditor.cargo_id);
      const nome = String(cargo?.nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      setCargoDoUsuario(nome);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const editorMap = Object.fromEntries(editores.map(x => [x.id, x.nome]));
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  const canSeeAll = isAdmin || cargoDoUsuario.includes('head') || cargoDoUsuario.includes('lider');
  const canEditRow = (a: any) => {
    if (isAdmin) return true;
    if (!canSeeAll) return false;
    return a.editor_id !== meuEditorId; // líderes não podem editar a própria avaliação
  };
  const filtered = canSeeAll
    ? (filterEditor === 'all' ? items : items.filter(i => i.editor_id === filterEditor))
    : items.filter(i => i.editor_id === meuEditorId);

  const editorSel = editores.find(e => e.id === form.editor_id);
  const cargoSel = editorSel?.cargo_id ? cargoMap[editorSel.cargo_id] : null;
  // Avaliação existente → usa snapshot congelado; nova → usa multiplicador atual do editor
  const multiplicador = form.multiplicador_snapshot != null
    ? Number(form.multiplicador_snapshot)
    : (editorSel?.multiplicador != null ? Number(editorSel.multiplicador) : 1);
  const multiplicadorDefinido = multiplicador !== 1 || form.multiplicador_snapshot != null || editorSel?.multiplicador != null;
  const cargoNome = String(cargoSel?.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isHeadOuLider = cargoNome.includes('head') || cargoNome.includes('lider');
  const responsaveisDisponiveis = editores.filter(e => e.id !== form.editor_id);
  const mesReferenciaPayload = form.mes_referencia ? `${form.mes_referencia.slice(0, 7)}-01` : null;

  const { bonusBase, folgasAuto } = useMemo(() => {
    let total = 0;
    let folgas = 0;
    const folgaRe = /\((\d+(?:[.,]\d+)?)\s*folgas?\)/i;
    for (const cr of criterios) {
      const r = form.respostas[cr.chave];
      if (cr.tipo === 'single' && r) {
        const op = cr.opcoes.find(o => o.id === r);
        if (op) {
          total += Number(op.valor);
          const m = op.label.match(folgaRe); if (m) folgas += Number(m[1].replace(',', '.'));
        }
      } else if (cr.tipo === 'multi' && Array.isArray(r)) {
        for (const id of r) {
          const op = cr.opcoes.find(o => o.id === id);
          if (op) {
            total += Number(op.valor);
            const m = op.label.match(folgaRe); if (m) folgas += Number(m[1].replace(',', '.'));
          }
        }
      } else if (cr.tipo === 'number') {
        const unit = Number(cr.opcoes[0]?.valor || 0);
        total += Number(r || 0) * unit;
      }
    }
    return { bonusBase: total, folgasAuto: folgas };
  }, [form, criterios]);

  const bonusEstimado = bonusBase;
  const bonusComMultiplicador = Math.round(bonusBase * multiplicador * 100) / 100;
  const bonusResponsaveis = useMemo(() => {
    if (!isHeadOuLider || !mesReferenciaPayload || form.responsaveis_ids.length === 0) return 0;
    return items
      .filter(item => item.mes_referencia === mesReferenciaPayload && form.responsaveis_ids.includes(item.editor_id))
      .reduce((sum, item) => sum + Number(item.bonus_total || 0) * 0.2, 0);
  }, [form.responsaveis_ids, isHeadOuLider, items, mesReferenciaPayload]);
  const bonusTotalCalculado = Math.round((bonusComMultiplicador + bonusResponsaveis) * 100) / 100;

  const openNew = () => { setViewOnly(false); setEditingId(null); setForm(blankForm()); setOpen(true); };

  const openEdit = (a: any, readOnly = false) => {
    setViewOnly(readOnly);
    const respostas: Record<string, any> = {};
    const snap = a.respostas || {};
    for (const cr of criterios) {
      const s = snap[cr.chave];
      if (!s) continue;
      if (cr.tipo === 'single') {
        const op = cr.opcoes.find(o => o.id === s.id) || cr.opcoes.find(o => o.label === s.label);
        if (op) respostas[cr.chave] = op.id;
      } else if (cr.tipo === 'multi') {
        const ids: string[] = [];
        for (const sel of (s.selecoes || [])) {
          const op = cr.opcoes.find(o => o.id === sel.id) || cr.opcoes.find(o => o.label === sel.label);
          if (op) ids.push(op.id);
        }
        respostas[cr.chave] = ids;
      } else if (cr.tipo === 'number') {
        respostas[cr.chave] = Number(s.quantidade || 0);
      }
    }
    // Compat: se colunas legadas existirem e critérios ainda não foram criados, ainda exibir
    if (a.criativos_escalados != null && respostas[CHAVE_CRIATIVOS] == null) respostas[CHAVE_CRIATIVOS] = Number(a.criativos_escalados);
    if (a.vsl_escaladas != null && respostas[CHAVE_VSL] == null) respostas[CHAVE_VSL] = Number(a.vsl_escaladas);

    const responsaveisIds = Array.isArray(snap[CHAVE_RESPONSAVEIS]?.editor_ids)
      ? snap[CHAVE_RESPONSAVEIS].editor_ids.filter((id: unknown) => typeof id === 'string')
      : [];
    const bonusLiderancaSalvo = Number(snap[CHAVE_RESPONSAVEIS]?.bonus_lideranca || 0);
    const editorDaAval = editores.find(e => e.id === a.editor_id);
    // Usa snapshot congelado se existir; avaliações legadas sem snapshot usam o multiplicador atual como fallback
    const snapshotSalvo = a.multiplicador_snapshot != null ? Number(a.multiplicador_snapshot) : null;
    const multFallback  = editorDaAval?.multiplicador != null ? Number(editorDaAval.multiplicador) : 1;
    const multEfetivo   = snapshotSalvo ?? multFallback;
    const bonusBaseCalculado = Math.round(Number(a.bonus_estimado || 0) * multEfetivo * 100) / 100;
    const bonusTotalCalculadoItem = Math.round((bonusBaseCalculado + bonusLiderancaSalvo) * 100) / 100;

    setEditingId(a.id);
    setForm({
      editor_id: a.editor_id || '',
      mes_referencia: a.mes_referencia ? String(a.mes_referencia).slice(0, 7) : '',
      data_lancamento: a.data_lancamento ? String(a.data_lancamento).slice(0, 10) : '',
      avaliador: a.avaliador || '',
      perfil: a.perfil || '',
      bonus_total_override: a.bonus_total != null && Number(a.bonus_total) !== bonusTotalCalculadoItem
        ? String(a.bonus_total) : '',
      feedback: a.feedback || '',
      responsaveis_ids: responsaveisIds,
      respostas,
      multiplicador_snapshot: snapshotSalvo ?? multFallback, // garante sempre um valor congelado
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.editor_id || !form.mes_referencia)
      return toast({ title: 'Editor e mês obrigatórios', variant: 'destructive' });

    const respostasSnapshot: Record<string, any> = {};
    for (const cr of criterios) {
      const r = form.respostas[cr.chave];
      if (cr.tipo === 'single' && r) {
        const op = cr.opcoes.find(o => o.id === r);
        if (op) respostasSnapshot[cr.chave] = { tipo: 'single', id: op.id, label: op.label, valor: Number(op.valor) };
      } else if (cr.tipo === 'multi' && Array.isArray(r)) {
        const sel = cr.opcoes.filter(o => r.includes(o.id)).map(o => ({ id: o.id, label: o.label, valor: Number(o.valor) }));
        respostasSnapshot[cr.chave] = { tipo: 'multi', selecoes: sel };
      } else if (cr.tipo === 'number') {
        respostasSnapshot[cr.chave] = { tipo: 'number', quantidade: Number(r || 0), unitario: Number(cr.opcoes[0]?.valor || 0) };
      }
    }

    if (isHeadOuLider && form.responsaveis_ids.length > 0) {
      respostasSnapshot[CHAVE_RESPONSAVEIS] = {
        tipo: 'leaders',
        editor_ids: form.responsaveis_ids,
        bonus_lideranca: Math.round(bonusResponsaveis * 100) / 100,
        percentual: 0.2,
      };
    }

    const bonusFinal = form.bonus_total_override !== '' && form.bonus_total_override != null
      ? Number(form.bonus_total_override)
      : bonusTotalCalculado;

    // Mantém colunas legadas se os critérios existirem
    const critCriativos = criterios.find(c => c.chave === CHAVE_CRIATIVOS);
    const critVsl = criterios.find(c => c.chave === CHAVE_VSL);
    const qtdCriativos = Number(form.respostas[CHAVE_CRIATIVOS] || 0);
    const qtdVsl = Number(form.respostas[CHAVE_VSL] || 0);
    const unitCriativos = Number(critCriativos?.opcoes[0]?.valor || 50);
    const unitVsl = Number(critVsl?.opcoes[0]?.valor || 100);

    const payload: any = {
      editor_id: form.editor_id,
      mes_referencia: mesReferenciaPayload,
      data_lancamento: form.data_lancamento || null,
      avaliador: form.avaliador || null,
      perfil: form.perfil || null,
      criativos_escalados: qtdCriativos,
      bonus_escalados: qtdCriativos * unitCriativos,
      vsl_escaladas: qtdVsl,
      bonus_vsl: qtdVsl * unitVsl,
      bonus_estimado: bonusEstimado,
      bonus_total: bonusFinal,
      folgas: folgasAuto,
      feedback: form.feedback || null,
      respostas: respostasSnapshot,
      // Nova avaliação → congela o multiplicador atual; edição → preserva o snapshot já salvo
      multiplicador_snapshot: editingId
        ? form.multiplicador_snapshot   // não altera o que já estava salvo
        : (editorSel?.multiplicador != null ? Number(editorSel.multiplicador) : null),
    };
    const { error } = editingId
      ? await supabase.from('avaliacoes_mensais').update(payload).eq('id', editingId)
      : await supabase.from('avaliacoes_mensais').insert(payload);
    if (error) return toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    toast({ title: editingId ? 'Avaliação atualizada' : 'Avaliação salva' });
    setOpen(false); setEditingId(null); setForm(blankForm()); load();
  };

  const remove = async (id: string) => {
    if (!(await confirm({ title: 'Excluir avaliação?', description: 'Esta avaliação será removida permanentemente.' }))) return;
    await supabase.from('avaliacoes_mensais').delete().eq('id', id); load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {canSeeAll && (
            <>
              <Label className="text-xs text-muted-foreground">Filtrar por editor</Label>
              <Select value={filterEditor} onValueChange={setFilterEditor}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        {canSeeAll && <Button onClick={openNew}><Plus className="h-4 w-4" /> Nova avaliação</Button>}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? <div className="p-6 text-center text-muted-foreground">Carregando...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground uppercase">
                <th className="text-left px-3 py-2">Mês</th>
                <th className="text-left px-3 py-2">Editor</th>
                <th className="text-left px-3 py-2">Bônus total</th>
                <th className="text-left px-3 py-2">Folgas</th>
                {canSeeAll && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => openEdit(a, !canEditRow(a))}>
                    <td className="px-3 py-2">{a.mes_referencia}</td>
                    <td className="px-3 py-2">{editorMap[a.editor_id] || '—'}</td>
                    <td className="px-3 py-2 font-medium">{formatCurrency(Number(a.bonus_total || 0))}</td>
                    <td className="px-3 py-2">{a.folgas || 0}</td>
                    {canSeeAll && (
                      <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {canEditRow(a) && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(a)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4" /></Button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={canSeeAll ? 5 : 4} className="px-3 py-8 text-center text-muted-foreground">Nenhuma avaliação</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewOnly ? 'Avaliação (somente leitura)' : editingId ? 'Editar avaliação' : 'Nova avaliação mensal'}</DialogTitle>
          </DialogHeader>
          <fieldset disabled={viewOnly} className={viewOnly ? 'opacity-80' : ''}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Editor</Label>
                <Select value={form.editor_id} onValueChange={v => setForm({ ...form, editor_id: v, responsaveis_ids: [] })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Mês de referência</Label><Input type="month" value={form.mes_referencia} onChange={e => setForm({ ...form, mes_referencia: e.target.value })} /></div>
              <div><Label>Data de lançamento</Label><Input type="date" value={form.data_lancamento} onChange={e => setForm({ ...form, data_lancamento: e.target.value })} /></div>
              <div><Label>Avaliador(a)</Label><Input value={form.avaliador} onChange={e => setForm({ ...form, avaliador: e.target.value })} /></div>
              <div><Label>Perfil</Label><Input value={form.perfil} onChange={e => setForm({ ...form, perfil: e.target.value })} placeholder="Misto / Estático / Dinâmico" /></div>
            </div>

            {isHeadOuLider && (
              <div className="space-y-2 border-b border-border/40 pb-3">
                <Label className="text-sm">Editores sob responsabilidade</Label>
                <div className="space-y-1.5">
                  {responsaveisDisponiveis.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nenhum editor disponível para vincular.</div>
                  ) : responsaveisDisponiveis.map(op => {
                    const checked = form.responsaveis_ids.includes(op.id);
                    return (
                      <label key={op.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-secondary/30 rounded px-2 py-1">
                        <Checkbox checked={checked} onCheckedChange={(v) => {
                          const next = v
                            ? [...form.responsaveis_ids, op.id]
                            : form.responsaveis_ids.filter((id: string) => id !== op.id);
                          setForm({ ...form, responsaveis_ids: next });
                        }} />
                        <span>{op.nome}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">A líder/head recebe 20% da comissão total destes editores no mês selecionado.</p>
              </div>
            )}

            {criterios.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground bg-secondary/30 rounded">
                Nenhum critério configurado. Vá até a aba <strong>Configuração</strong> para criar.
              </div>
            )}

            {CATEGORIAS.map(cat => {
              const critsCat = criterios.filter(c => (c.categoria || 'individual') === cat.value);
              if (critsCat.length === 0) return null;
              return (
                <div key={cat.value} className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
                  <div className="border-b border-border pb-2">
                    <h4 className="text-sm font-semibold uppercase tracking-wide text-primary">{cat.label}</h4>
                    <p className="text-xs text-muted-foreground">{cat.description}</p>
                  </div>
                  {critsCat.map(cr => (
                    <div key={cr.id} className="space-y-2 border-b border-border/40 pb-3 last:border-b-0 last:pb-0">
                      <Label className="text-sm">{cr.label}</Label>
                      {cr.tipo === 'single' && (
                        <Select
                          value={(form.respostas[cr.chave] as string) || ''}
                          onValueChange={v => setForm({ ...form, respostas: { ...form.respostas, [cr.chave]: v } })}
                        >
                          <SelectTrigger><SelectValue placeholder="Selecione uma opção" /></SelectTrigger>
                          <SelectContent>
                            {cr.opcoes.map(op => (
                              <SelectItem key={op.id} value={op.id}>
                                {op.label} <span className="text-muted-foreground">(R$ {Number(op.valor)})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {cr.tipo === 'multi' && (
                        <div className="space-y-1.5">
                          {cr.opcoes.map(op => {
                            const arr = (form.respostas[cr.chave] as string[]) || [];
                            const checked = arr.includes(op.id);
                            return (
                              <label key={op.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-secondary/30 rounded px-2 py-1">
                                <Checkbox checked={checked} onCheckedChange={(v) => {
                                  const next = v ? [...arr, op.id] : arr.filter(x => x !== op.id);
                                  setForm({ ...form, respostas: { ...form.respostas, [cr.chave]: next } });
                                }} />
                                <span>{op.label} <span className="text-muted-foreground">(R$ {Number(op.valor)})</span></span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {cr.tipo === 'number' && (
                        <div className="flex items-center gap-2">
                          <Input type="number" min={0} className="w-32"
                            value={(form.respostas[cr.chave] as number) || 0}
                            onChange={e => setForm({ ...form, respostas: { ...form.respostas, [cr.chave]: Number(e.target.value) } })} />
                          <span className="text-xs text-muted-foreground">× R$ {Number(cr.opcoes[0]?.valor || 0)} cada</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}

             <div className="bg-secondary/40 border border-border rounded-lg p-4 space-y-3">
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <div>
                   <Label className="text-xs text-muted-foreground">Bônus base</Label>
                   <div className="text-lg font-medium">{formatCurrency(bonusEstimado)}</div>
                 </div>
                 <div>
                   <Label className="text-xs text-muted-foreground">
                     Multiplicador individual
                   </Label>
                   <div className="text-lg font-medium">
                     {multiplicadorDefinido ? `${multiplicador.toFixed(2)}x` : <span className="text-muted-foreground text-base">não definido</span>}
                   </div>
                 </div>
                 <div>
                   <Label className="text-xs text-muted-foreground">Bônus com multiplicador</Label>
                   <div className="text-lg font-medium">{formatCurrency(bonusComMultiplicador)}</div>
                 </div>
                 <div>
                   <Label className="text-xs text-muted-foreground">Folgas (auto)</Label>
                   <div className="text-lg font-medium">{folgasAuto}</div>
                 </div>
               </div>
               {isHeadOuLider && (
                 <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2 border-t border-border/60">
                   <div>
                     <Label className="text-xs text-muted-foreground">Editores sob responsabilidade</Label>
                     <div className="text-lg font-medium">{form.responsaveis_ids.length}</div>
                   </div>
                   <div>
                     <Label className="text-xs text-muted-foreground">+ 20% da comissão do time</Label>
                     <div className="text-lg font-medium text-primary">{formatCurrency(bonusResponsaveis)}</div>
                   </div>
                   <div>
                     <Label className="text-xs text-muted-foreground">Subtotal (multiplicador + liderança)</Label>
                     <div className="text-lg font-medium">{formatCurrency(bonusTotalCalculado)}</div>
                   </div>
                 </div>
               )}
               <div className="grid grid-cols-2 gap-4 items-end pt-2 border-t border-border/60">
                 <div>
                   <Label className="text-xs text-muted-foreground">Bônus total calculado</Label>
                   <div className="text-2xl font-semibold text-primary">{formatCurrency(bonusTotalCalculado)}</div>
                 </div>
                <div>
                  <Label>Override do bônus total (opcional)</Label>
                  <Input type="number" placeholder={String(bonusTotalCalculado)}
                    value={form.bonus_total_override}
                    onChange={e => setForm({ ...form, bonus_total_override: e.target.value })} />
                </div>
              </div>
            </div>

            <div><Label>Feedback</Label><Textarea rows={3} value={form.feedback} onChange={e => setForm({ ...form, feedback: e.target.value })} /></div>

          </div>
          </fieldset>
          <DialogFooter>
            {viewOnly ? (
              <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={save}>{editingId ? 'Salvar alterações' : 'Salvar'}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
