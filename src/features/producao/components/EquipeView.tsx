import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { SETORES_LABEL, NIVEL_LABEL } from './constants';
import type { ProducaoNivel, ProducaoSetor, Perfil } from './types';

interface MembroRow {
  id: string;
  perfil_id: string;
  nome: string;
  setor: ProducaoSetor;
  nivel: ProducaoNivel;
  abertos: number;
  em_revisao: number;
  atrasados: number;
}

interface Props {
  nivel: ProducaoNivel;
  setor: ProducaoSetor | null;
}

export function EquipeView({ nivel, setor }: Props) {
  const { toast } = useToast();
  const [stats, setStats]       = useState<MembroRow[]>([]);
  const [perfis, setPerfis]     = useState<Perfil[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [newPerfil, setNewPerfil] = useState('');
  const [newSetor, setNewSetor]   = useState<ProducaoSetor | ''>('');
  const [newNivel, setNewNivel]   = useState<ProducaoNivel | ''>('');
  const [saving, setSaving]     = useState(false);

  const canManage = nivel === 'socio';
  const today = new Date().toISOString().split('T')[0];

  const load = useCallback(async () => {
    setLoading(true);

    let qm = supabase.from('producao_membros').select('id,perfil_id,setor,nivel,perfil:perfis!perfil_id(nome,is_admin)');
    if (nivel === 'lider' && setor) qm = qm.eq('setor', setor);
    const { data: membros } = await qm;

    const { data: allPerfis } = await supabase.from('perfis').select('id,nome,is_admin').order('nome');
    setPerfis(allPerfis ?? []);

    if (!membros?.length) { setStats([]); setLoading(false); return; }

    const ids = membros.map(m => m.perfil_id);
    const { data: criativos } = await supabase
      .from('producoes')
      .select('responsavel_id,fase,data_prazo')
      .in('responsavel_id', ids);

    const rows: MembroRow[] = membros.map(m => {
      const mcs = (criativos ?? []).filter(c => c.responsavel_id === m.perfil_id);
      const done = ['aprovado', 'esteira_teste', 'postado', 'na_plataforma', 'programado'];
      const active = mcs.filter(c => !done.includes(c.fase));
      return {
        id:         m.id,
        perfil_id:  m.perfil_id,
        nome:       (m.perfil as { nome: string } | null)?.nome ?? '—',
        setor:      m.setor as ProducaoSetor,
        nivel:      m.nivel as ProducaoNivel,
        abertos:    active.length,
        em_revisao: active.filter(c => ['revisao_copy','revisao_edicao'].includes(c.fase)).length,
        atrasados:  active.filter(c => c.data_prazo && c.data_prazo < today).length,
      };
    });

    setStats(rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')));
    setLoading(false);
  }, [nivel, setor, today]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newPerfil || !newSetor || !newNivel) {
      toast({ title: 'Preencha todos os campos', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('producao_membros').insert({
      perfil_id: newPerfil,
      setor:     newSetor,
      nivel:     newNivel,
    });
    if (error) {
      toast({ title: error.message.includes('unique') ? 'Membro já cadastrado' : 'Erro ao adicionar', variant: 'destructive' });
    } else {
      toast({ title: 'Membro adicionado' });
      setNewPerfil(''); setNewSetor(''); setNewNivel('');
      setShowAdd(false);
      load();
    }
    setSaving(false);
  };

  const handleRemove = async (id: string, nome: string) => {
    if (!confirm(`Remover "${nome}" da equipe de produção?`)) return;
    await supabase.from('producao_membros').delete().eq('id', id);
    toast({ title: 'Removido' });
    load();
  };

  const existingIds = stats.map(s => s.perfil_id);
  const availablePerfis = perfis.filter(p => !existingIds.includes(p.id));

  if (loading) return <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>;

  return (
    <div className="space-y-6">
      {/* Stats table */}
      {stats.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nenhum membro configurado.{canManage ? ' Adicione abaixo.' : ''}
        </p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Membro','Setor','Nível','Abertos','Em revisão','Atrasados'].map(h => (
                  <th key={h} className={cn(
                    'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                    h === 'Membro' || h === 'Setor' || h === 'Nível' ? 'text-left' : 'text-right',
                  )}>{h}</th>
                ))}
                {canManage && <th className="px-2 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {stats.map(m => (
                <tr key={m.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{m.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{SETORES_LABEL[m.setor] ?? m.setor}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{NIVEL_LABEL[m.nivel] ?? m.nivel}</td>
                  <td className="px-4 py-3 text-right font-medium">{m.abertos}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={m.em_revisao > 0 ? 'text-amber-400 font-medium' : 'text-muted-foreground'}>
                      {m.em_revisao}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={m.atrasados > 0 ? 'text-red-400 font-semibold' : 'text-muted-foreground'}>
                      {m.atrasados}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-2 py-3">
                      <button onClick={() => handleRemove(m.id, m.nome)}
                        className="text-muted-foreground/40 hover:text-red-400 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add member (socio only) */}
      {canManage && (
        <div>
          {!showAdd ? (
            <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Adicionar membro
            </Button>
          ) : (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <p className="text-xs font-semibold text-foreground">Novo membro</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">Pessoa</p>
                  <Select value={newPerfil} onValueChange={setNewPerfil}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {availablePerfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">Setor</p>
                  <Select value={newSetor} onValueChange={v => setNewSetor(v as ProducaoSetor)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {(Object.entries(SETORES_LABEL) as [ProducaoSetor, string][]).map(([k, v]) =>
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">Nível</p>
                  <Select value={newNivel} onValueChange={v => setNewNivel(v as ProducaoNivel)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {(Object.entries(NIVEL_LABEL) as [ProducaoNivel, string][]).map(([k, v]) =>
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={saving}>
                  {saving ? 'Salvando...' : 'Adicionar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
