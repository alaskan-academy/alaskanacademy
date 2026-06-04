import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2, Plus, Shield, KeyRound, Check, ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGINAS } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/use-confirm';

/* ─── Types ─────────────────────────────────────────────────────────────── */
type Usuario      = { id: string; email: string; nome: string; is_admin: boolean; created_at: string };
type Cargo        = { id: string; nome: string; multiplicador: string; cor: string; ordem: number; setor_id: string | null };
type Setor        = { id: string; nome: string; pagina_key: string | null; cor: string };
type EditorDetalhe = { id: string; nome: string; cargo_id: string; data_inicio: string; ativo: boolean; observacoes: string; multiplicador: string; percentual_lideranca: string };
type PermMap      = Record<string, boolean>;
type EditorOpt    = { id: string; nome: string };

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const defaultPerms = (): PermMap => Object.fromEntries(PAGINAS.map(p => [p.key, true]));
const fmtMult      = (m: string | number) => `${parseFloat(String(m)).toFixed(2)}x`;

const AVATAR_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#0ea5e9'];
const avatarBg   = (name: string) => { let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; };
const getInitials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();

/* ─── Component ──────────────────────────────────────────────────────────── */
export function GerenciarUsuariosTab() {
  const confirm = useConfirm();

  /* Data */
  const [usuarios, setUsuarios]           = useState<Usuario[]>([]);
  const [editores, setEditores]           = useState<EditorOpt[]>([]);
  const [cargos, setCargos]               = useState<Cargo[]>([]);
  const [setores, setSetores]             = useState<Setor[]>([]);
  const [editorMap, setEditorMap]         = useState<Record<string, string>>({});
  const [cargoMap, setCargoMap]           = useState<Record<string, string>>({});
  const [editorDetalhes, setEditorDetalhes] = useState<Record<string, EditorDetalhe>>({});
  const [permsMap, setPermsMap]           = useState<Record<string, PermMap>>({});
  const [loading, setLoading]             = useState(true);

  /* Accordion state */
  const [expandedEditor, setExpandedEditor] = useState<Record<string, boolean>>({});
  const [expandedPerms, setExpandedPerms]   = useState<Record<string, boolean>>({});
  const [setorFilter, setSetorFilter]       = useState<Record<string, string>>({});

  /* Inline editor form */
  const [editorForm, setEditorForm]       = useState<Record<string, Partial<EditorDetalhe>>>({});
  const [savingEditor, setSavingEditor]   = useState<Record<string, boolean>>({});

  /* Modal: novo usuário */
  const [open, setOpen]       = useState(false);
  const [nome, setNome]       = useState('');
  const [email, setEmail]     = useState('');
  const [senha, setSenha]     = useState('');
  const [newSetorId, setNewSetorId] = useState('');
  const [newCargoId, setNewCargoId] = useState('');
  const [newPerms, setNewPerms]     = useState<PermMap>(defaultPerms());
  const [saving, setSaving]   = useState(false);

  /* Modal: trocar senha */
  const [pwUser, setPwUser]   = useState<Usuario | null>(null);
  const [newPw, setNewPw]     = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  /* ── Load ─────────────────────────────────────────────────────────────── */
  const load = async () => {
    setLoading(true);
    const [{ data: users, error }, { data: eds }, { data: crgs }, { data: perfsData }, { data: strs }] = await Promise.all([
      supabase.rpc('listar_usuarios'),
      supabase.from('editores').select('id, nome, usuario_id, cargo_id, data_inicio, ativo, observacoes, multiplicador').order('nome'),
      supabase.from('cargos').select('id, nome, multiplicador, cor, ordem, setor_id').order('ordem'),
      supabase.from('perfis').select('id, cargo_id'),
      supabase.from('setores').select('id, nome, pagina_key, cor').order('ordem'),
    ]);
    setSetores(strs ?? []);
    if (error) { toast({ title: 'Erro ao carregar usuários', variant: 'destructive' }); setLoading(false); return; }

    setUsuarios(users ?? []);
    setEditores((eds ?? []).map((e: any) => ({ id: e.id, nome: e.nome })));
    setCargos(crgs ?? []);

    const em: Record<string, string>          = {};
    const det: Record<string, EditorDetalhe>  = {};
    for (const ed of eds ?? []) {
      if (ed.usuario_id) {
        em[ed.usuario_id] = ed.id;
        det[ed.usuario_id] = {
          id: ed.id, nome: ed.nome, cargo_id: ed.cargo_id ?? '',
          data_inicio: ed.data_inicio ?? '', ativo: ed.ativo ?? true,
          observacoes: ed.observacoes ?? '',
          multiplicador: ed.multiplicador != null ? String(ed.multiplicador) : '',
          percentual_lideranca: ed.percentual_lideranca != null ? String(ed.percentual_lideranca) : '',
        };
      }
    }
    setEditorMap(em);
    setEditorDetalhes(det);

    const cm: Record<string, string> = {};
    for (const p of perfsData ?? []) cm[p.id] = p.cargo_id ?? '';
    setCargoMap(cm);

    const ids = (users ?? []).map((u: Usuario) => u.id);
    if (ids.length) {
      const { data: perms } = await supabase.from('permissoes_paginas').select('usuario_id, pagina, permitido').in('usuario_id', ids);
      const map: Record<string, PermMap> = {};
      for (const u of users ?? []) {
        const base = defaultPerms();
        for (const r of (perms ?? []).filter((r: any) => r.usuario_id === u.id)) base[r.pagina] = r.permitido;
        map[u.id] = base;
      }
      setPermsMap(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  /* ── Helpers de erro ──────────────────────────────────────────────────── */
  const fnError = async (error: any, data: any): Promise<string | null> => {
    if (data?.error) return data.error;
    if (error) { try { const b = await error.context?.json?.(); if (b?.error) return b.error; } catch {} return error.message ?? 'Erro desconhecido'; }
    return null;
  };

  /* ── Criar usuário ────────────────────────────────────────────────────── */
  const handleCreate = async () => {
    if (!email || !senha) return toast({ title: 'Preencha email e senha', variant: 'destructive' });
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'create', email, password: senha, nome } });
    const err = await fnError(error, data);
    if (err) { toast({ title: err, variant: 'destructive' }); setSaving(false); return; }

    const userId = data.user.id;

    // Permissões de página
    const rows = PAGINAS.map(p => ({ usuario_id: userId, pagina: p.key, permitido: newPerms[p.key] ?? true }));
    await supabase.from('permissoes_paginas').upsert(rows, { onConflict: 'usuario_id,pagina' });

    // Cargo + auto-acesso por setor
    if (newCargoId) {
      await supabase.from('perfis').update({ cargo_id: newCargoId }).eq('id', userId);
      const cargo = cargos.find(c => c.id === newCargoId);
      const setor = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
      if (setor?.pagina_key) {
        await supabase.from('permissoes_paginas').upsert({ usuario_id: userId, pagina: setor.pagina_key, permitido: true }, { onConflict: 'usuario_id,pagina' });
        if (setor.pagina_key === 'editores') {
          await supabase.from('editores').insert({ nome, usuario_id: userId, cargo_id: newCargoId, ativo: true });
        }
      }
    }

    toast({ title: 'Usuário criado' });
    setSaving(false); setOpen(false);
    setNome(''); setEmail(''); setSenha(''); setNewSetorId(''); setNewCargoId(''); setNewPerms(defaultPerms());
    load();
  };

  /* ── Permissão de página ──────────────────────────────────────────────── */
  const togglePermission = async (userId: string, pageKey: string, current: boolean) => {
    const next = !current;
    setPermsMap(prev => ({ ...prev, [userId]: { ...prev[userId], [pageKey]: next } }));
    const { error } = await supabase.from('permissoes_paginas').upsert({ usuario_id: userId, pagina: pageKey, permitido: next }, { onConflict: 'usuario_id,pagina' });
    if (error) { toast({ title: 'Erro ao salvar permissão', variant: 'destructive' }); setPermsMap(prev => ({ ...prev, [userId]: { ...prev[userId], [pageKey]: current } })); }
  };

  /* ── Admin toggle ─────────────────────────────────────────────────────── */
  const toggleAdmin = async (u: Usuario) => {
    const next = !u.is_admin;
    const { error } = await supabase.from('perfis').update({ is_admin: next }).eq('id', u.id);
    if (error) return toast({ title: 'Erro', variant: 'destructive' });
    toast({ title: next ? `${u.nome} agora é admin` : `${u.nome} não é mais admin` });
    load();
  };

  /* ── Excluir usuário ──────────────────────────────────────────────────── */
  const handleDelete = async (u: Usuario) => {
    if (!(await confirm({ title: `Excluir ${u.nome}?`, description: 'O acesso será removido permanentemente.' }))) return;
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'delete', userId: u.id } });
    const err = await fnError(error, data);
    if (err) return toast({ title: err, variant: 'destructive' });
    toast({ title: 'Usuário removido' }); load();
  };

  /* ── Trocar senha ─────────────────────────────────────────────────────── */
  const handleChangePassword = async () => {
    if (!newPw || !pwUser) return;
    setPwSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'update_password', userId: pwUser.id, password: newPw } });
    setPwSaving(false);
    const err = await fnError(error, data);
    if (err) return toast({ title: err, variant: 'destructive' });
    toast({ title: 'Senha atualizada' }); setPwUser(null); setNewPw('');
  };

  /* ── Setor filter ─────────────────────────────────────────────────────── */
  const handleSetorFilter = (userId: string, newSetorId: string) => {
    setSetorFilter(prev => ({ ...prev, [userId]: newSetorId }));
    const currentCargoId = cargoMap[userId];
    if (currentCargoId) {
      const currentCargo = cargos.find(c => c.id === currentCargoId);
      if (currentCargo && currentCargo.setor_id !== newSetorId) handleCargoChange(userId, '');
    }
  };

  /* ── Editor vinculado ─────────────────────────────────────────────────── */
  const handleEditorChange = async (userId: string, newEdId: string) => {
    await supabase.from('editores').update({ usuario_id: null }).eq('usuario_id', userId);
    if (newEdId) await supabase.from('editores').update({ usuario_id: userId }).eq('id', newEdId);
    load();
  };

  /* ── Cargo ────────────────────────────────────────────────────────────── */
  const handleCargoChange = async (userId: string, newCargoId: string) => {
    const cargoIdValue = newCargoId || null;
    const { error } = await supabase.from('perfis').update({ cargo_id: cargoIdValue }).eq('id', userId);
    if (error) return toast({ title: 'Erro ao atualizar cargo', variant: 'destructive' });

    const edId = editorMap[userId];

    if (!newCargoId) {
      // Cargo removido: desvincula o usuário do perfil de editor (dados preservados no BD)
      if (edId) await supabase.from('editores').update({ cargo_id: null, usuario_id: null }).eq('id', edId);
    } else {
      // Cargo atribuído: sincroniza cargo_id no perfil vinculado (se houver)
      if (edId) await supabase.from('editores').update({ cargo_id: cargoIdValue }).eq('id', edId);

      const cargo = cargos.find(c => c.id === newCargoId);
      const setor = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
      if (setor?.pagina_key) {
        await supabase.from('permissoes_paginas').upsert(
          { usuario_id: userId, pagina: setor.pagina_key, permitido: true },
          { onConflict: 'usuario_id,pagina' },
        );
        if (setor.pagina_key === 'editores' && !edId) {
          const usuario = usuarios.find(u => u.id === userId);
          // Tenta re-vincular um perfil existente desvinculado (mesmo nome) antes de criar novo
          const { data: existente } = await supabase
            .from('editores')
            .select('id')
            .eq('nome', usuario?.nome ?? '')
            .is('usuario_id', null)
            .limit(1)
            .maybeSingle();
          if (existente) {
            await supabase.from('editores').update({ usuario_id: userId, cargo_id: cargoIdValue, ativo: true }).eq('id', existente.id);
          } else if (usuario) {
            await supabase.from('editores').insert({ nome: usuario.nome, usuario_id: userId, cargo_id: cargoIdValue, ativo: true });
          }
        }
      }
    }

    setCargoMap(prev => ({ ...prev, [userId]: newCargoId }));
    const cargo = cargos.find(c => c.id === newCargoId);
    if (cargo?.setor_id) setSetorFilter(prev => ({ ...prev, [userId]: cargo.setor_id! }));
    const setor = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
    toast({ title: cargo ? `Cargo: ${cargo.nome}${setor ? ` · ${setor.nome}` : ''}` : 'Cargo removido' });
    load();
  };

  /* ── Editor form ──────────────────────────────────────────────────────── */
  const getEditorForm = (userId: string): Partial<EditorDetalhe> => editorForm[userId] ?? editorDetalhes[userId] ?? {};
  const setEditorField = (userId: string, field: keyof EditorDetalhe, value: any) => {
    setEditorForm(prev => ({ ...prev, [userId]: { ...(prev[userId] ?? editorDetalhes[userId] ?? {}), [field]: value } }));
  };
  const saveEditorProfile = async (userId: string) => {
    const edId = editorMap[userId];
    if (!edId) return;
    const f = getEditorForm(userId);
    setSavingEditor(prev => ({ ...prev, [userId]: true }));
    const payload: any = {
      nome: f.nome,
      data_inicio: f.data_inicio || null,
      ativo: f.ativo ?? true,
      observacoes: f.observacoes || null,
      multiplicador: f.multiplicador !== '' && f.multiplicador != null ? parseFloat(String(f.multiplicador)) : null,
      percentual_lideranca: f.percentual_lideranca !== '' && f.percentual_lideranca != null ? parseFloat(String(f.percentual_lideranca)) : null,
    };
    const { error } = await supabase.from('editores').update(payload).eq('id', edId);
    setSavingEditor(prev => ({ ...prev, [userId]: false }));
    if (error) return toast({ title: 'Erro ao salvar perfil', variant: 'destructive' });
    toast({ title: 'Perfil atualizado' }); load();
  };

  /* ── Badge ────────────────────────────────────────────────────────────── */
  const CargoBadge = ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) => {
    if (isAdmin) return (
      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#eab30820', color: '#eab308' }}>Sócio</span>
    );
    const cargo = cargos.find(c => c.id === cargoMap[userId]);
    const setor = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
    if (!cargo) return null;
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ backgroundColor: `${cargo.cor}20`, color: cargo.cor }}>
        {setor ? `${setor.nome} · ` : ''}{cargo.nome}
      </span>
    );
  };

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Usuários</h3>
          <p className="text-xs text-muted-foreground">Gerencie acessos, cargos e perfis da equipe.</p>
        </div>
        <Button onClick={() => { setOpen(true); setNewPerms(defaultPerms()); setNewSetorId(''); setNewCargoId(''); }}>
          <Plus className="h-4 w-4 mr-1.5" /> Novo usuário
        </Button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-muted-foreground text-sm animate-pulse py-12 text-center">Carregando...</div>
      ) : (
        <div className="space-y-2">
          {usuarios.map(u => {
            const det         = editorDetalhes[u.id];
            const form        = getEditorForm(u.id);
            const edExpanded  = expandedEditor[u.id]  ?? false;
            const pmExpanded  = expandedPerms[u.id]   ?? false;
            const cargo       = cargos.find(c => c.id === cargoMap[u.id]);
            const setorIdAtual = setorFilter[u.id] ?? cargo?.setor_id ?? '';
            const cargosFiltrados = setorIdAtual ? cargos.filter(c => c.setor_id === setorIdAtual) : cargos;
            const permsCount  = Object.values(permsMap[u.id] ?? {}).filter(Boolean).length;
            const semCargo    = !u.is_admin && !cargoMap[u.id];
            const setorDoCargo = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
            const isEditorSetor = setorDoCargo?.pagina_key === 'editores';
            const bg          = avatarBg(u.nome);

            return (
              <div key={u.id} className="bg-card border border-border rounded-lg overflow-hidden group">

                {/* ── Card header ── */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold select-none"
                    style={{ backgroundColor: bg }}>
                    {getInitials(u.nome)}
                  </div>

                  {/* Nome + badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{u.nome}</span>
                      <CargoBadge userId={u.id} isAdmin={u.is_admin} />
                      {semCargo && (
                        <span className="flex items-center gap-1 text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                          <AlertCircle className="h-3 w-3" /> Sem cargo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>

                  {/* Ações — visíveis no hover */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                      title={u.is_admin ? 'Remover admin' : 'Tornar admin'}
                      onClick={() => toggleAdmin(u)}>
                      <Shield className={cn('h-4 w-4', u.is_admin ? 'text-primary' : 'text-muted-foreground')} />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                      title="Trocar senha"
                      onClick={() => { setPwUser(u); setNewPw(''); }}>
                      <KeyRound className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                      title="Excluir usuário"
                      onClick={() => handleDelete(u)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive transition-colors" />
                    </Button>
                  </div>
                </div>

                {/* ── Corpo (não-admins) ── */}
                {!u.is_admin && (
                  <div className="border-t border-border/50 divide-y divide-border/40">

                    {/* Seção: Função */}
                    <div className="px-4 py-3 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Função</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Setor</p>
                          <select
                            value={setorIdAtual}
                            onChange={e => handleSetorFilter(u.id, e.target.value)}
                            className="bg-secondary border border-border rounded-md px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">— Selecione —</option>
                            {setores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                          </select>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Cargo</p>
                          <select
                            value={cargoMap[u.id] ?? ''}
                            onChange={e => handleCargoChange(u.id, e.target.value)}
                            className="bg-secondary border border-border rounded-md px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">— Sem cargo —</option>
                            {cargosFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Seção: Perfil (accordion) — só aparece quando o setor do cargo é editores */}
                    {isEditorSetor && det && (
                      <div>
                        <button
                          onClick={() => setExpandedEditor(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-secondary/30 transition-colors"
                        >
                          <span className="font-medium text-foreground/80">Perfil do editor</span>
                          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', edExpanded && 'rotate-180')} />
                        </button>

                        {edExpanded && (
                          <div className="px-4 pb-4 pt-1 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-xs">Nome do editor</Label>
                                <Input className="mt-1 h-8 text-xs" value={form.nome ?? det.nome} onChange={e => setEditorField(u.id, 'nome', e.target.value)} />
                              </div>
                              <div>
                                <Label className="text-xs">Data de início</Label>
                                <Input type="date" className="mt-1 h-8 text-xs" value={form.data_inicio ?? det.data_inicio} onChange={e => setEditorField(u.id, 'data_inicio', e.target.value)} />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-xs">Multiplicador individual</Label>
                                <Input type="number" step="0.01" min="0" className="mt-1 h-8 text-xs"
                                  placeholder="Ex: 1.20"
                                  value={form.multiplicador ?? det.multiplicador}
                                  onChange={e => setEditorField(u.id, 'multiplicador', e.target.value)} />
                              </div>
                              <div>
                                <Label className="text-xs">% Comissão liderança</Label>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Input type="number" step="0.1" min="0" max="100" className="h-8 text-xs"
                                    placeholder="Padrão: 20"
                                    value={form.percentual_lideranca ?? det.percentual_lideranca}
                                    onChange={e => setEditorField(u.id, 'percentual_lideranca', e.target.value)} />
                                  <span className="text-xs text-muted-foreground shrink-0">%</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center">
                              <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={form.ativo ?? det.ativo} onChange={e => setEditorField(u.id, 'ativo', e.target.checked)} className="rounded" />
                                Ativo
                              </label>
                            </div>
                            <div>
                              <Label className="text-xs">Observações</Label>
                              <Textarea className="mt-1 text-xs min-h-[56px]" value={form.observacoes ?? det.observacoes} onChange={e => setEditorField(u.id, 'observacoes', e.target.value)} />
                            </div>
                            <div className="flex justify-end pt-1">
                              <Button size="sm" onClick={() => saveEditorProfile(u.id)} disabled={savingEditor[u.id]}>
                                {savingEditor[u.id] ? 'Salvando...' : 'Salvar perfil'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Seção: Acesso (accordion) */}
                    <div>
                      <button
                        onClick={() => setExpandedPerms(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-secondary/30 transition-colors"
                      >
                        <span className="font-medium text-foreground/80">Acesso ao dashboard</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{permsCount} / {PAGINAS.length} páginas</span>
                          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', pmExpanded && 'rotate-180')} />
                        </div>
                      </button>

                      {pmExpanded && (
                        <div className="px-4 pb-3 pt-1">
                          <div className="flex flex-wrap gap-1.5">
                            {PAGINAS.map(p => {
                              const allowed = permsMap[u.id]?.[p.key] ?? true;
                              return (
                                <button key={p.key} onClick={() => togglePermission(u.id, p.key, allowed)}
                                  className={cn('flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border transition-colors',
                                    allowed ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-secondary border-border text-muted-foreground hover:border-border/80')}>
                                  {allowed && <Check className="h-3 w-3" />}
                                  {p.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })}

          {usuarios.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">Nenhum usuário cadastrado</div>
          )}
        </div>
      )}

      {/* ── Modal: Novo usuário ────────────────────────────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
          <div className="space-y-4">

            <div className="grid grid-cols-1 gap-3">
              <div><Label className="text-xs">Nome</Label><Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" className="mt-1" /></div>
              <div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com" className="mt-1" /></div>
              <div><Label className="text-xs">Senha inicial</Label><Input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" className="mt-1" /></div>
            </div>

            <div className="border border-border/60 rounded-lg p-3 space-y-3 bg-secondary/20">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Função</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Setor</Label>
                  <select value={newSetorId} onChange={e => { setNewSetorId(e.target.value); setNewCargoId(''); }}
                    className="w-full mt-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="">— Selecione —</option>
                    {setores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Cargo</Label>
                  <select value={newCargoId} onChange={e => setNewCargoId(e.target.value)}
                    className="w-full mt-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="">— Sem cargo —</option>
                    {(newSetorId ? cargos.filter(c => c.setor_id === newSetorId) : cargos).map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
              </div>
              {newCargoId && (() => {
                const cargo = cargos.find(c => c.id === newCargoId);
                const setor = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
                if (!setor?.pagina_key) return null;
                return (
                  <p className="text-[11px] text-primary/80 bg-primary/5 px-2.5 py-1.5 rounded-md">
                    ✓ Acesso à página <strong>{PAGINAS.find(p => p.key === setor.pagina_key)?.label ?? setor.pagina_key}</strong> será concedido automaticamente
                  </p>
                );
              })()}
            </div>

            <div>
              <Label className="text-xs mb-2 block">Páginas visíveis</Label>
              <div className="flex flex-wrap gap-1.5">
                {PAGINAS.map(p => {
                  const allowed = newPerms[p.key] ?? true;
                  return (
                    <button key={p.key} type="button" onClick={() => setNewPerms(prev => ({ ...prev, [p.key]: !allowed }))}
                      className={cn('flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border transition-colors',
                        allowed ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-secondary border-border text-muted-foreground')}>
                      {allowed && <Check className="h-3 w-3" />}
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Criando...' : 'Criar usuário'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Trocar senha ────────────────────────────────────────── */}
      <Dialog open={!!pwUser} onOpenChange={v => { if (!v) setPwUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Trocar senha — {pwUser?.nome}</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Nova senha</Label>
            <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Mínimo 6 caracteres" className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwUser(null)}>Cancelar</Button>
            <Button onClick={handleChangePassword} disabled={pwSaving || newPw.length < 6}>{pwSaving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
