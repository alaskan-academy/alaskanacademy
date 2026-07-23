import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Trash2, Plus, Shield, KeyRound, Check, UserX, UserCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGINAS } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/use-confirm';

type Usuario   = { id: string; email: string; nome: string; is_admin: boolean; ativo: boolean; created_at: string };
type Cargo     = { id: string; nome: string; multiplicador: string; cor: string; ordem: number; setor_id: string | null };
type Setor     = { id: string; nome: string; cor: string | null };
type PermMap   = Record<string, boolean>;
type EditorOpt = { id: string; nome: string };

const defaultPerms = (): PermMap => Object.fromEntries(PAGINAS.map(p => [p.key, true]));

const fnError = async (error: unknown, data: Record<string, string> | null): Promise<string | null> => {
  if (data?.error) return data.error;
  if (error) {
    try {
      const b = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (b?.error) return b.error;
    } catch { /* ignore */ }
    return (error as Error).message ?? 'Erro desconhecido';
  }
  return null;
};

export function AcessosTab() {
  const confirm = useConfirm();
  const [usuarios, setUsuarios]   = useState<Usuario[]>([]);
  const [arquivados, setArquivados] = useState<Usuario[]>([]);
  const [showArquivados, setShowArquivados] = useState(false);
  const [editores, setEditores]   = useState<EditorOpt[]>([]);
  const [cargos, setCargos]       = useState<Cargo[]>([]);
  const [setores, setSetores]     = useState<Setor[]>([]);
  const [editorMap, setEditorMap] = useState<Record<string, string>>({});   // usuario_id → editor_id
  const [cargoMap, setCargoMap]   = useState<Record<string, string>>({});   // usuario_id → cargo_id
  const [setorMap, setSetorMap]   = useState<Record<string, string>>({});   // usuario_id → setor_id
  const [setorPerms, setSetorPerms] = useState<Record<string, string[]>>({}); // setor_id → paginas[]
  const [permsMap, setPermsMap]   = useState<Record<string, PermMap>>({});
  const [loading, setLoading]     = useState(true);
  const [applyingSetor, setApplyingSetor] = useState<string | null>(null);

  // Modal novo usuário
  const [open, setOpen]         = useState(false);
  const [nome, setNome]         = useState('');
  const [email, setEmail]       = useState('');
  const [senha, setSenha]       = useState('');
  const [newPerms, setNewPerms] = useState<PermMap>(defaultPerms());
  const [saving, setSaving]     = useState(false);

  // Modal trocar senha
  const [pwUser, setPwUser] = useState<Usuario | null>(null);
  const [newPw, setNewPw]   = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: users, error }, { data: eds }, { data: crgs }, { data: ss }, { data: perfsData }, { data: sp }] = await Promise.all([
      supabase.rpc('listar_usuarios'),
      supabase.from('editores').select('id, nome, usuario_id').order('nome'),
      supabase.from('cargos').select('id, nome, multiplicador, cor, ordem, setor_id').order('ordem'),
      supabase.from('setores').select('id, nome, cor').order('ordem'),
      supabase.from('perfis').select('id, cargo_id, setor_id, ativo'),
      supabase.from('setor_permissoes').select('setor_id, pagina'),
    ]);
    if (error) { toast({ title: 'Erro ao carregar usuários', variant: 'destructive' }); setLoading(false); return; }

    // listar_usuarios não inclui ativo — usar perfis como fonte de verdade
    const ativoById: Record<string, boolean> = {};
    const cm: Record<string, string> = {};
    const sm: Record<string, string> = {};
    for (const p of perfsData ?? []) {
      ativoById[p.id] = p.ativo !== false;
      cm[p.id] = p.cargo_id ?? '';
      sm[p.id] = p.setor_id ?? '';
    }
    const ativos = (users ?? []).filter((u: Usuario) => ativoById[u.id] !== false);
    const inativos = (users ?? []).filter((u: Usuario) => ativoById[u.id] === false);
    setUsuarios(ativos);
    setArquivados(inativos);
    setEditores((eds ?? []).map((e: { id: string; nome: string }) => ({ id: e.id, nome: e.nome })));
    setCargos(crgs ?? []);
    setSetores(ss ?? []);

    const em: Record<string, string> = {};
    for (const ed of eds ?? []) {
      if ((ed as { usuario_id?: string }).usuario_id) em[(ed as { usuario_id: string }).usuario_id] = ed.id;
    }
    setEditorMap(em);
    setCargoMap(cm);
    setSetorMap(sm);

    // permissões por setor
    const spMap: Record<string, string[]> = {};
    for (const row of sp ?? []) {
      if (!spMap[row.setor_id]) spMap[row.setor_id] = [];
      spMap[row.setor_id].push(row.pagina);
    }
    setSetorPerms(spMap);

    const ids = (users ?? []).map((u: Usuario) => u.id);
    if (ids.length) {
      const { data: perms } = await supabase
        .from('permissoes_paginas').select('usuario_id, pagina, permitido').in('usuario_id', ids);
      const map: Record<string, PermMap> = {};
      for (const u of users ?? []) {
        const base = defaultPerms();
        for (const r of (perms ?? []).filter((r: { usuario_id: string }) => r.usuario_id === u.id)) {
          base[(r as { pagina: string }).pagina] = (r as { permitido: boolean }).permitido;
        }
        map[u.id] = base;
      }
      setPermsMap(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
    toast({ title: 'Usuário criado' });
    setSaving(false); setOpen(false);
    setNome(''); setEmail(''); setSenha(''); setNewPerms(defaultPerms());
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

  const handleDeactivate = async (u: Usuario) => {
    if (!(await confirm({ title: `Desativar ${u.nome}?`, description: 'O usuário perderá acesso imediatamente e ficará arquivado.' }))) return;
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'deactivate', userId: u.id } });
    const err = await fnError(error, data);
    if (err) return toast({ title: err, variant: 'destructive' });
    toast({ title: `${u.nome} desativado` }); load();
  };

  const handleReactivate = async (u: Usuario) => {
    const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'reactivate', userId: u.id } });
    const err = await fnError(error, data);
    if (err) return toast({ title: err, variant: 'destructive' });
    toast({ title: `${u.nome} reativado` }); load();
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

  const handleSetorChange = async (userId: string, newSetorId: string) => {
    const { error } = await supabase.from('perfis').update({ setor_id: newSetorId || null }).eq('id', userId);
    if (error) return toast({ title: 'Erro ao atualizar setor', variant: 'destructive' });
    setSetorMap(prev => ({ ...prev, [userId]: newSetorId }));
    // limpa cargo se não pertence ao novo setor
    const cargo = cargos.find(c => c.id === cargoMap[userId]);
    if (cargo && cargo.setor_id !== newSetorId) {
      await supabase.from('perfis').update({ cargo_id: null }).eq('id', userId);
      setCargoMap(prev => ({ ...prev, [userId]: '' }));
    }
    toast({ title: newSetorId ? `Setor atualizado` : 'Setor removido' });
  };

  const applySetorPermissions = async (userId: string) => {
    const setorId = setorMap[userId];
    if (!setorId) return;
    const pages = setorPerms[setorId] ?? [];
    if (pages.length === 0) return toast({ title: 'Setor sem páginas padrão configuradas', variant: 'destructive' });
    setApplyingSetor(userId);
    const rows = PAGINAS.map(p => ({ usuario_id: userId, pagina: p.key, permitido: pages.includes(p.key) }));
    await supabase.from('permissoes_paginas').upsert(rows, { onConflict: 'usuario_id,pagina' });
    setApplyingSetor(null);
    toast({ title: 'Permissões do setor aplicadas' });
    load();
  };

  const handleCargoChange = async (userId: string, newCargoId: string) => {
    const cargoIdValue = newCargoId || null;
    const { error } = await supabase.from('perfis').update({ cargo_id: cargoIdValue }).eq('id', userId);
    if (error) return toast({ title: 'Erro ao atualizar cargo', variant: 'destructive' });
    const edId = editorMap[userId];
    if (edId) await supabase.from('editores').update({ cargo_id: cargoIdValue }).eq('id', edId);
    setCargoMap(prev => ({ ...prev, [userId]: newCargoId }));
    const cargo = cargos.find(c => c.id === newCargoId);
    toast({ title: cargo ? `Cargo atualizado para ${cargo.nome}` : 'Cargo removido' });
  };

  const CargoBadge = ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) => {
    if (isAdmin) return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#eab30820', color: '#eab308' }}>
        Sócio
      </span>
    );
    const setor = setores.find(s => s.id === setorMap[userId]);
    const cargo = cargos.find(c => c.id === cargoMap[userId]);
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {setor && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium border"
            style={{ backgroundColor: `${setor.cor ?? '#888'}15`, color: setor.cor ?? '#888', borderColor: `${setor.cor ?? '#888'}30` }}>
            {setor.nome}
          </span>
        )}
        {cargo ? (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: `${cargo.cor}20`, color: cargo.cor }}>
            {cargo.nome}
          </span>
        ) : !setor ? (
          <span className="text-xs text-muted-foreground">— sem setor —</span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Gerencie acessos, cargos e permissões de páginas.</p>
        <Button onClick={() => { setOpen(true); setNewPerms(defaultPerms()); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo usuário
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm animate-pulse py-8 text-center">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {usuarios.map(u => (
            <div key={u.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{u.nome}</p>
                    <CargoBadge userId={u.id} isAdmin={u.is_admin} />
                  </div>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <Button size="sm" variant="ghost" title={u.is_admin ? 'Remover admin' : 'Tornar sócio/admin'} onClick={() => toggleAdmin(u)}>
                  <Shield className={cn('h-4 w-4', u.is_admin ? 'text-primary' : 'text-muted-foreground')} />
                </Button>
                <Button size="sm" variant="ghost" title="Trocar senha" onClick={() => { setPwUser(u); setNewPw(''); }}>
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button size="sm" variant="ghost" title="Desativar usuário" onClick={() => handleDeactivate(u)}>
                  <UserX className="h-4 w-4 text-muted-foreground hover:text-amber-500" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(u)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>

              {!u.is_admin && (
                <div className="border-t border-border/50 pt-3 space-y-3">
                  {/* Setor + Cargo */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5">Setor</p>
                      <select
                        value={setorMap[u.id] ?? ''}
                        onChange={e => handleSetorChange(u.id, e.target.value)}
                        className="bg-secondary border border-border rounded-md px-3 py-1.5 text-xs w-full"
                      >
                        <option value="">— Sem setor —</option>
                        {setores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
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
                        {cargos
                          .filter(c => !setorMap[u.id] || c.setor_id === setorMap[u.id])
                          .map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Aplicar permissões do setor */}
                  {setorMap[u.id] && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => applySetorPermissions(u.id)}
                        disabled={applyingSetor === u.id}
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                      >
                        {applyingSetor === u.id ? 'Aplicando...' : '↺ Aplicar permissões padrão do setor'}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        ({(setorPerms[setorMap[u.id]] ?? []).length} página{(setorPerms[setorMap[u.id]] ?? []).length !== 1 ? 's' : ''})
                      </span>
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
                              allowed
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'bg-secondary border-border text-muted-foreground',
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
          ))}
          {usuarios.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhum usuário cadastrado</div>
          )}
        </div>
      )}

      {/* Arquivados */}
      {arquivados.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowArquivados(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
          >
            {showArquivados
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <span className="text-sm font-medium text-muted-foreground flex-1">Arquivados</span>
            <span className="text-xs text-muted-foreground">{arquivados.length}</span>
          </button>
          {showArquivados && (
            <div className="border-t border-border divide-y divide-border/50">
              {arquivados.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">{u.nome}</p>
                    <p className="text-xs text-muted-foreground/60">{u.email}</p>
                  </div>
                  <Button size="sm" variant="outline" title="Reativar usuário" onClick={() => handleReactivate(u)} className="gap-1.5">
                    <UserCheck className="h-3.5 w-3.5" />
                    <span className="text-xs">Reativar</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(u)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
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
