import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { FASES_MAP, STATUS_PRODUCAO_LABEL } from './constants';
import type { Funil, FunilProducaoInfo, ProducaoNivel } from './types';

interface CriativoRow {
  id: string;
  nome: string;
  tipo: string;
  fase: string;
  funil_id: string | null;
  responsavel: { nome: string } | null;
}

interface Props {
  nivel: ProducaoNivel;
}

type EditForm = Partial<FunilProducaoInfo> & { newLinkLabel?: string; newLinkUrl?: string };

export function PorFunilView({ nivel }: Props) {
  const { toast } = useToast();
  const [funis, setFunis]       = useState<Funil[]>([]);
  const [infos, setInfos]       = useState<Record<string, FunilProducaoInfo>>({});
  const [criativos, setCriativos] = useState<CriativoRow[]>([]);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm]   = useState<EditForm>({});
  const [loading, setLoading]     = useState(true);

  const canEdit = nivel === 'socio' || nivel === 'lider';

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: fs }, { data: is }, { data: cs }] = await Promise.all([
      supabase.from('funis').select('id,nome,produto,ativo').eq('ativo', true).order('nome'),
      supabase.from('funis_producao').select('*'),
      supabase.from('criativos')
        .select('id,nome,tipo,fase,funil_id,responsavel:perfis!responsavel_id(nome)')
        .order('nome'),
    ]);
    setFunis(fs ?? []);
    const infoMap: Record<string, FunilProducaoInfo> = {};
    (is ?? []).forEach(i => {
      infoMap[i.funil_id] = { ...i, links: Array.isArray(i.links) ? i.links : [] };
    });
    setInfos(infoMap);
    setCriativos((cs ?? []) as CriativoRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (funil: Funil) => {
    const info = infos[funil.id];
    setEditForm({
      descricao:            info?.descricao            ?? '',
      brand_guidelines_url: info?.brand_guidelines_url ?? '',
      status_producao:      info?.status_producao      ?? 'ativo',
      notas:                info?.notas                ?? '',
      links:                info?.links                ?? [],
      newLinkLabel: '',
      newLinkUrl:   '',
    });
    setEditingId(funil.id);
  };

  const addLink = () => {
    if (!editForm.newLinkLabel?.trim() || !editForm.newLinkUrl?.trim()) return;
    setEditForm(prev => ({
      ...prev,
      links: [...(prev.links ?? []), { label: prev.newLinkLabel!.trim(), url: prev.newLinkUrl!.trim() }],
      newLinkLabel: '',
      newLinkUrl: '',
    }));
  };

  const removeLink = (idx: number) =>
    setEditForm(prev => ({ ...prev, links: (prev.links ?? []).filter((_, i) => i !== idx) }));

  const saveEdit = async (funilId: string) => {
    const payload = {
      funil_id:            funilId,
      descricao:           editForm.descricao || null,
      brand_guidelines_url: editForm.brand_guidelines_url || null,
      status_producao:     editForm.status_producao ?? 'ativo',
      notas:               editForm.notas || null,
      links:               editForm.links ?? [],
      atualizado_em:       new Date().toISOString(),
    };
    const { error } = await supabase.from('funis_producao').upsert(payload, { onConflict: 'funil_id' });
    if (error) { toast({ title: 'Erro ao salvar', variant: 'destructive' }); return; }
    toast({ title: 'Salvo' });
    setEditingId(null);
    load();
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>;
  }

  return (
    <div className="space-y-2">
      {funis.map(funil => {
        const info = infos[funil.id];
        const funilItems = criativos.filter(c => c.funil_id === funil.id);
        const isExpanded = expanded === funil.id;
        const isEditing  = editingId === funil.id;

        return (
          <div key={funil.id} className="border border-border rounded-lg overflow-hidden">
            {/* Header */}
            <button
              onClick={() => setExpanded(isExpanded ? null : funil.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
            >
              {isExpanded
                ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className="text-sm font-medium text-foreground flex-1">{funil.nome}</span>
              <span className="text-xs text-muted-foreground">{funil.produto}</span>
              {info?.status_producao && (
                <Badge variant="outline" className="text-[10px] h-5 ml-2">
                  {STATUS_PRODUCAO_LABEL[info.status_producao]}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground ml-2">{funilItems.length} itens</span>
            </button>

            {/* Body */}
            {isExpanded && (
              <div className="border-t border-border px-4 py-4 bg-muted/10 space-y-4">
                {isEditing ? (
                  /* Edit form */
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Descrição</Label>
                      <Textarea className="mt-1 text-xs resize-none" rows={2}
                        value={editForm.descricao ?? ''}
                        onChange={e => setEditForm(p => ({ ...p, descricao: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Brand Guidelines (link)</Label>
                        <Input className="mt-1 h-7 text-xs"
                          value={editForm.brand_guidelines_url ?? ''}
                          onChange={e => setEditForm(p => ({ ...p, brand_guidelines_url: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">Status</Label>
                        <Select
                          value={editForm.status_producao ?? 'ativo'}
                          onValueChange={v => setEditForm(p => ({ ...p, status_producao: v as FunilProducaoInfo['status_producao'] }))}>
                          <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="em_construcao">Em construção</SelectItem>
                            <SelectItem value="ativo">Ativo</SelectItem>
                            <SelectItem value="pausado">Pausado</SelectItem>
                            <SelectItem value="encerrado">Encerrado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Links da equipe</Label>
                      <div className="space-y-1.5 mt-1">
                        {(editForm.links ?? []).map((link, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs">
                            <span className="w-28 truncate font-medium">{link.label}</span>
                            <span className="flex-1 truncate text-muted-foreground">{link.url}</span>
                            <button onClick={() => removeLink(idx)} className="text-muted-foreground hover:text-red-400">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2 mt-2">
                          <Input placeholder="Label" className="h-6 text-xs w-28"
                            value={editForm.newLinkLabel ?? ''}
                            onChange={e => setEditForm(p => ({ ...p, newLinkLabel: e.target.value }))} />
                          <Input placeholder="https://..." className="h-6 text-xs flex-1"
                            value={editForm.newLinkUrl ?? ''}
                            onChange={e => setEditForm(p => ({ ...p, newLinkUrl: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && addLink()} />
                          <Button size="sm" variant="outline" className="h-6 px-2" onClick={addLink}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Notas</Label>
                      <Textarea className="mt-1 text-xs resize-none" rows={2}
                        value={editForm.notas ?? ''}
                        onChange={e => setEditForm(p => ({ ...p, notas: e.target.value }))} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(funil.id)}>Salvar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="space-y-2">
                    {info?.descricao && (
                      <p className="text-xs text-muted-foreground">{info.descricao}</p>
                    )}
                    {(info?.links ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-3">
                        {info!.links.map((link, idx) => (
                          <a key={idx} href={link.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline">
                            <ExternalLink className="h-3 w-3" />{link.label}
                          </a>
                        ))}
                        {info?.brand_guidelines_url && (
                          <a href={info.brand_guidelines_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                            <ExternalLink className="h-3 w-3" />Brand Guidelines
                          </a>
                        )}
                      </div>
                    )}
                    {info?.notas && (
                      <p className="text-xs text-muted-foreground italic">{info.notas}</p>
                    )}
                    {!info && !canEdit && (
                      <p className="text-xs text-muted-foreground italic">Sem informações de produção.</p>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2 -ml-2"
                        onClick={() => startEdit(funil)}>
                        <Pencil className="h-3 w-3 mr-1" />Editar informações
                      </Button>
                    )}
                  </div>
                )}

                {/* Itens list */}
                {funilItems.length > 0 && (
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Itens ({funilItems.length})
                    </p>
                    <div className="space-y-0.5">
                      {funilItems.map(c => (
                        <div key={c.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                          <span className="flex-1 text-foreground truncate">{c.nome}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {FASES_MAP[c.fase] ?? c.fase}
                          </span>
                          {c.responsavel && (
                            <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                              {c.responsavel.nome}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {funilItems.length === 0 && !isEditing && (
                  <p className="text-xs text-muted-foreground italic">
                    Nenhum item vinculado a este funil.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {funis.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">Nenhum funil ativo.</p>
      )}
    </div>
  );
}
