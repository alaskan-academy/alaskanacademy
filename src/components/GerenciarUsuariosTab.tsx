import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2, Plus, Shield, KeyRound, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGINAS } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/use-confirm';

type Usuario = { id: string; email: string; nome: string; is_admin: boolean; created_at: string };
type Cargo    = { id: string; nome: string; multiplicador: string; cor: string; ordem: number; setor_id: string | null };
type Setor    = { id: string; nome: string; pagina_key: string | null; cor: string };
type EditorDetalhe = {
  id: string; nome: string; cargo_id: string;
  data_inicio: string; ativo: boolean; observacoes: string; multiplicador: string;
};

type PermMap = Record<string, boolean>;
type EditorOpt = { id: string; nome: string };

const defaultPerms = (): PermMap => Object.fromEntries(PAGINAS.map(p => [p.key, true]));
const fmtMult = (m: string | number) => `${parseFloat(String(m)).toFixed(2)}x`;

export function GerenciarUsuariosTab() {
  const confirm = useConfirm();
  const [usuarios, setUsuarios]         = useState<Usuario[]>([]);
  const [editores, setEditores]         = useState<EditorOpt[]>([]);
  const [cargos, setCargos]             = useState<Cargo[]>([]);
  const [setores, setSetores]           = useState<Setor[]>([]);
  const [editorMap, setEditorMap]       = useState<Record<string, string>>({});       // usuario_id → editor_id
  const [cargoMap, setCargoMap]         = useState<Record<string, string>>({});       // usuario_id → cargo_id
  const [editorDetalhes, setEditorDetalhes] = useState<Record<string, EditorDetalhe>>({}); // usuario_id → detalhes
  const [permsMap, setPermsMap]         = useState<Record<string, PermMap>>({});
  const [loading, setLoading]           = useState(true);
  const [open, setOpen]                 = useState(false);
  const [expandedEditor, setExpandedEditor] = useState<Record<string, boolean>>({});  // usuario_id → expandido

  // Form novo usuário
  const [nome, setNome]     = useState('');
  const [email, setEmail]   = useState('');
  const [senha, setSenha]   = useState('');
  const [editorId, setEditorId] = useState('');
  const [newPerms, setNewPerms] = useState<PermMap>(defaultPerms());
  const [saving, setSaving] = useState(false);

  // Form editor inline (editado por usuario_id)
  const [editorForm, setEditorForm] = useState<Record<string, Partial<EditorDetalhe>>>({});
  const [savingEditor, setSavingEditor] = useState<Record<string, boolean>>({});

  // Modal trocar senha
  const [pwUser, setPwUser] = useState<Usuario | null>(null);
  const [newPw, setNewPw]   = useState('');
  const [pwSaving, setPwSaving] = useState(false);

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

    const em: Record<string, string> = {};
    const det: Record<string, EditorDetalhe> = {};
    for (const ed of eds ?? []) {
      if (ed.usuario_id) {
        em[ed.usuario_id] = ed.id;
        det[ed.usuario_id] = {
          id: ed.id, nome: ed.nome, cargo_id: ed.cargo_id ?? '',
          data_inicio: ed.data_inicio ?? '', ativo: ed.ativo ?? true,
          observacoes: ed.observacoes ?? '',
          multiplicador: ed.multiplicador != null ? String(ed.multiplicador) : '',
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
      const { data: perms } = await supabase
        .from('permissoes_paginas').select('usuario_id, pagina, permitido').in('usuario_id', ids);
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

  const fnError = async (error: any, data: any): Promise<string | null> => {
    if (data?.error) return data.error;
    if (error) {
      try { const b = await error.context?.json?.(); if (b?.error) return b.error; } catch {}
      return error.message ?? 'Erro desconhecido';
    }
    return null;
  };

  const handleCreate = async () => {
    if (!email || !senha) return toast({ title: 'Preencha email e senha', variant: 'destructive' });
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'create', email, password: senha, nome },
    });
    const err = await fnError(error, data);
    if (err) { toast({ title: err, variant: 'destructive' }); setSaving(false); return; }
    const userId = data.user.id;
    const rows = PAGINAS.map(p => ({ usuario_id: userId, pagina: p.key, permitido: newPerms[p.key] ?? true }));
    await supabase.from('permissoes_paginas').upsert(rows, { onConflict: 'usuario_id,pagina' });
    if (editorId) await supabase.from('editores').update({ usuario_id: userId }).eq('id', editorId);
    toast({ title: 'Usuário criado' });
    setSaving(false); setOpen(false);
    setNome(''); setEmail(''); setSenha(''); setEditorId(''); setNewPerms(defaultPerms());
    load();
  };

  const togglePermission = async (userId: string, pageKey: string, current: boolean) => {
    const next = !current;
    setPermsMap(prev => ({ ...prev, [userId]: { ...prev[userId], [pageKey]: next } }));
    const { error } = await supabase
      .from('permissoes_paginas')
      .upsert({ usuario_id: userId, pagina: pageKey, permitido: next }, { onConflict: 'usuario_id,pagina' });
    if (error) {
      toast({ title: 'Erro ao salvar permissão', variant: 'destructive' });
      setPermsMap(prev => ({ ...prev, [userId]: { ...prev[userId], [pageKey]: current } }));
    }
  };

  const toggleAdmin = async (u: Usuario) => {
    const next = !u.is_admin;
    const { error } = await supabase.from('perfis').update({ is_admin: next }).eq('id', u.id);
    if (error) return toast({ title: 'Erro', variant: 'destructive' });
    toast({ title: next ? `${u.nome} agora é sócio/admin` : `${u.nome} não é mais admin` });
    load();
  };

  const handleDelete = async (u: Usuario) => {
    if (!(await confirm({ title: `Excluir ${u.nome}?`, description: 'O acesso será removido permanentemente.' }))) return;
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'delete', userId: u.id } });
    const err = await fnError(error, data);
    if (err) return toast({ title: err, variant: 'destructive' });
    toast({ title: 'Usuário removido' }); load();
  };

  const handleChangePassword = async () => {
    if (!newPw || !pwUser) return;
    setPwSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'update_password', userId: pwUser.id, password: newPw },
    });
    setPwSaving(false);
    const err = await fnError(error, data);
    if (err) return toast({ title: err, variant: 'destructive' });
    toast({ title: 'Senha atualizada' }); setPwUser(null); setNewPw('');
  };

  const handleEditorChange = async (userId: string, newEdId: string) => {
    await supabase.from('editores').update({ usuario_id: null }).eq('usuario_id', userId);
    if (newEdId) await supabase.from('editores').update({ usuario_id: userId }).eq('id', newEdId);
    load();
  };

  const handleCargoChange = async (userId: string, newCargoId: string) => {
    const cargoIdValue = newCargoId || null;

    // 1. Salva cargo no perfil
    const { error } = await supabase.from('perfis').update({ cargo_id: cargoIdValue }).eq('id', userId);
    if (error) return toast({ title: 'Erro ao atualizar cargo', variant: 'destructive' });

    // 2. Sincroniza com editores se vinculado
    const edId = editorMap[userId];
    if (edId) await supabase.from('editores').update({ cargo_id: cargoIdValue }).eq('id', edId);

    // 3. Auto-acesso e auto-perfil via setor
    if (newCargoId) {
      const cargo = cargos.find(c => c.id === newCargoId);
      const setor = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
      if (setor?.pagina_key) {
        // Concede acesso à página do setor
        await supabase.from('permissoes_paginas').upsert(
          { usuario_id: userId, pagina: setor.pagina_key, permitido: true },
          { onConflict: 'usuario_id,pagina' }
        );
        // Se setor de editores e usuário ainda não tem perfil de editor → cria automaticamente
        if (setor.pagina_key === 'editores' && !editorMap[userId]) {
          const usuario = usuarios.find(u => u.id === userId);
          if (usuario) {
            await supabase.from('editores').insert({
              nome: usuario.nome,
              usuario_id: userId,
              cargo_id: cargoIdValue,
              ativo: true,
            });
          }
        }
      }
    }

    setCargoMap(prev => ({ ...prev, [userId]: newCargoId }));
    const cargo = cargos.find(c => c.id === newCargoId);
    const setor = cargo?.setor_id ? setores.find(s => s.id === cargo.setor_id) : null;
    const msg   = cargo ? `${cargo.nome}${setor ? ` (${setor.nome})` : ''}` : 'removido';
    toast({ title: cargo ? `Cargo atualizado: ${msg}` : 'Cargo removido' });
    load();
  };

  const getEditorForm = (userId: string): Partial<EditorDetalhe> => {
    return editorForm[userId] ?? editorDetalhes[userId] ?? {};
  };

  const setEditorField = (userId: string, field: keyof EditorDetalhe, value: any) => {
    setEditorForm(prev => ({
      ...prev,
      [userId]: { ...(prev[userId] ?? editorDetalhes[userId] ?? {}), [field]: value },
    }));
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
    };
    const { error } = await supabase.from('editores').update(payload).eq('id', edId);
    setSavingEditor(prev => ({ ...prev, [userId]: false }));
    if (error) return toast({ title: 'Erro ao salvar perfil', variant: 'destructive' });
    toast({ title: 'Perfil do editor atualizado' });
    load();
  };

  const CargoBadge = ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) => {
    if (isAdmin) return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#eab30820', color: '#eab308' }}>
        Sócio
      </span>
    );
    const cargoId = cargoMap[userId];
    const cargo = cargos.find(c => c.id === cargoId);
    if (!cargo) return <span className="text-xs text-muted-foreground">— sem cargo —</span>;
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ backgroundColor: `${cargo.cor}20`, color: cargo.cor }}>
        {cargo.nome}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Usuários</h3>
          <p className="text-xs text-muted-foreground">Gerencie quem pode acessar o dashboard e quais páginas.</p>
        </div>
        <Button onClick={() => { setOpen(true); setNewPerms(defaultPerms()); }}>
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm animate-pulse py-8 text-center">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {usuarios.map(u => {
            const det = editorDetalhes[u.id];
            const form = getEditorForm(u.id);
            const edExpanded = expandedEditor[u.id] ?? false;
            const cargo = cargos.find(c => c.id === cargoMap[u.id]);

            return (
              <div key={u.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
                {/* Header do usuário */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{u.nome}</p>
                      <CargoBadge userId={u.id} isAdmin={u.is_admin} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <Button size="sm" variant="ghost" title={u.is_admin ? 'Remover admin' : 'Tornar sócio/admin'} onClick={() => toggleAdmin(u)}>
                    <Shield className={cn('h-4 w-4', u.is_admin ? 'text-primary' : 'text-muted-foreground')} />
                  </Button>
                  <Button size="sm" variant="ghost" title="Trocar senha" onClick={() => { setPwUser(u); setNewPw(''); }}>
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(u)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>

                {!u.is_admin && (
                  <div className="border-t border-border/50 pt-3 space-y-3">

                    {/* Editor vinculado + Cargo */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5">Editor vinculado</p>
                        <select
                          value={editorMap[u.id] ?? ''}
                          onChange={e => handleEditorChange(u.id, e.target.value)}
                          className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs w-full"
                        >
                          <option value="">— Nenhum —</option>
                          {editores.map(ed => <option key={ed.id} value={ed.id}>{ed.nome}</option>)}
                        </select>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5">Cargo</p>
                        <select
                          value={cargoMap[u.id] ?? ''}
                          onChange={e => handleCargoChange(u.id, e.target.value)}
                          className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs w-full"
                        >
                          <option value="">— Sem cargo —</option>
                          {cargos.map(c => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Perfil do editor — expansível */}
                    {det && (
                      <div className="border border-border/50 rounded-md overflow-hidden">
                        <button
                          onClick={() => setExpandedEditor(prev => ({ ...prev, [u.id]: !prev[u.id] }))}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/40 transition-colors"
                        >
                          <span>Perfil do editor</span>
                          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', edExpanded && 'rotate-180')} />
                        </button>

                        {edExpanded && (
                          <div className="px-3 pb-3 pt-2 space-y-3 border-t border-border/40">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-xs">Nome do editor</Label>
                                <Input
                                  className="mt-1 h-8 text-xs"
                                  value={form.nome ?? det.nome}
                                  onChange={e => setEditorField(u.id, 'nome', e.target.value)}
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Data de início</Label>
                                <Input
                                  type="date"
                                  className="mt-1 h-8 text-xs"
                                  value={form.data_inicio ?? det.data_inicio}
                                  onChange={e => setEditorField(u.id, 'data_inicio', e.target.value)}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-xs">Multiplicador individual</Label>
                                <Input
                                  type="number" step="0.01" min="0"
                                  className="mt-1 h-8 text-xs"
                                  placeholder={cargo ? `Padrão: ${fmtMult(cargo.multiplicador)}` : 'Ex: 1.20'}
                                  value={form.multiplicador ?? det.multiplicador}
                                  onChange={e => setEditorField(u.id, 'multiplicador', e.target.value)}
                                />
                              </div>
                              <div className="flex items-end pb-0.5">
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={form.ativo ?? det.ativo}
                                    onChange={e => setEditorField(u.id, 'ativo', e.target.checked)}
                                    className="rounded"
                                  />
                                  Ativo
                                </label>
                              </div>
                            </div>

                            <div>
                              <Label className="text-xs">Observações</Label>
                              <Textarea
                                className="mt-1 text-xs min-h-[60px]"
                                value={form.observacoes ?? det.observacoes}
                                onChange={e => setEditorField(u.id, 'observacoes', e.target.value)}
                              />
                            </div>

                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                onClick={() => saveEditorProfile(u.id)}
                                disabled={savingEditor[u.id]}
                              >
                                {savingEditor[u.id] ? 'Salvando...' : 'Salvar perfil'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Páginas visíveis */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Páginas visíveis</p>
                      <div className="flex flex-wrap gap-2">
                        {PAGINAS.map(p => {
                          const allowed = permsMap[u.id]?.[p.key] ?? true;
                          return (
                            <button
                              key={p.key}
                              onClick={() => togglePermission(u.id, p.key, allowed)}
                              className={cn(
                                'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors',
                                allowed ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-secondary border-border text-muted-foreground',
                              )}
                            >
                              {allowed && <Check className="h-3 w-3" />}
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {usuarios.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhum usuário cadastrado</div>
          )}
        </div>
      )}

      {/* Modal novo usuário */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do usuário" className="mt-1" /></div>
            <div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com" className="mt-1" /></div>
            <div><Label className="text-xs">Senha inicial</Label><Input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" className="mt-1" /></div>
            <div>
              <Label className="text-xs">Editor vinculado (opcional)</Label>
              <select value={editorId} onChange={e => setEditorId(e.target.value)} className="w-full mt-1 bg-secondary border border-border rounded-md px-3 py-2 text-sm">
                <option value="">— Nenhum —</option>
                {editores.map(ed => <option key={ed.id} value={ed.id}>{ed.nome}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Páginas visíveis</Label>
              <div className="flex flex-wrap gap-2">
                {PAGINAS.map(p => {
                  const allowed = newPerms[p.key] ?? true;
                  return (
                    <button key={p.key} type="button"
                      onClick={() => setNewPerms(prev => ({ ...prev, [p.key]: !allowed }))}
                      className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors',
                        allowed ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-secondary border-border text-muted-foreground')}
                    >
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

      {/* Modal trocar senha */}
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
