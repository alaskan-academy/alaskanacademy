import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Plus, Pencil, ChevronLeft, CheckCircle2, XCircle, MinusCircle, Rocket, ExternalLink } from 'lucide-react';
import { TesteModal } from './TesteModal';
import { TesteFunil, Funil, Projeto, PerfilSimples } from '../types';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

interface Props {
  testes: TesteFunil[];
  funis: Funil[];
  projetos: Projeto[];
  perfis: PerfilSimples[];
  onReload: () => void;
}

const TIPO_CONFIG = {
  funil_novo: { label: 'Funil novo',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ab_interno: { label: 'A/B interno', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  ad:         { label: 'AD',          cls: 'bg-sky-500/15 text-sky-400' },
};

const VENCEDOR_LABEL: Record<string, string> = {
  a:            'Variante A',
  b:            'Variante B',
  inconclusivo: 'Inconclusivo',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function ConcluídosTab({ testes, funis, projetos, perfis, onReload }: Props) {
  const perfilMap  = Object.fromEntries(perfis.map(p => [p.id, p.nome]));
  const funilMap   = Object.fromEntries(funis.map(f => [f.id, f]));
  const projetoMap = Object.fromEntries(projetos.map(p => [p.id, p]));

  const [filterFunil, setFilterFunil]   = useState('todos');
  const [filterTipo, setFilterTipo]     = useState('todos');
  const [filterResult, setFilterResult] = useState('todos');
  const [modalOpen, setModalOpen]       = useState(false);
  const [editTeste, setEditTeste]       = useState<TesteFunil | null>(null);
  const [modalKey, setModalKey]         = useState(0);
  const [moving, setMoving]             = useState<string | null>(null);
  const [activating, setActivating]     = useState<string | null>(null);

  const concluidos = testes
    .filter(t => t.pipeline_status === 'concluido')
    .filter(t => filterFunil  === 'todos' || t.funil_id === filterFunil)
    .filter(t => filterTipo   === 'todos' || t.tipo     === filterTipo)
    .filter(t => {
      if (filterResult === 'todos') return true;
      if (filterResult === 'validado')    return t.validado;
      if (filterResult === 'nao_validado') return !t.validado;
      return true;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  async function voltarParaRodando(t: TesteFunil) {
    setMoving(t.id);
    const { error } = await supabase
      .from('testes_funis')
      .update({ pipeline_status: 'rodando' })
      .eq('id', t.id);
    setMoving(null);
    if (error) toast({ title: 'Erro ao mover', description: error.message, variant: 'destructive' });
    else onReload();
  }

  async function ativarFunil(funilId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setActivating(funilId);
    const { error } = await supabase
      .from('funis')
      .update({ status: 'ativo', ativo: true })
      .eq('id', funilId);
    setActivating(null);
    if (error) toast({ title: 'Erro ao ativar funil', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Funil ativado com sucesso' }); onReload(); }
  }

  function openNew() {
    setEditTeste(null);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  function openEdit(t: TesteFunil, e: React.MouseEvent) {
    e.stopPropagation();
    setEditTeste(t);
    setModalKey(k => k + 1);
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterFunil} onValueChange={setFilterFunil}>
          <SelectTrigger className="h-9 text-sm w-48"><SelectValue placeholder="Funil" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os funis</SelectItem>
            {funis.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterTipo} onValueChange={setFilterTipo}>
          <SelectTrigger className="h-9 text-sm w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="funil_novo">Funil novo</SelectItem>
            <SelectItem value="ab_interno">A/B interno</SelectItem>
            <SelectItem value="ad">AD</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterResult} onValueChange={setFilterResult}>
          <SelectTrigger className="h-9 text-sm w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="validado">✅ Validados</SelectItem>
            <SelectItem value="nao_validado">❌ Não validados</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {concluidos.length} concluído{concluidos.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <Button size="sm" className="h-9 gap-1.5" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />
          Novo teste
        </Button>
      </div>

      {concluidos.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Nenhum teste concluído encontrado.
        </div>
      ) : (
        <div className="space-y-3">
          {concluidos.map(t => {
            const funil    = t.funil_id ? funilMap[t.funil_id] : null;
            const projeto  = funil?.oferta_id ? projetoMap[funil.oferta_id] : null;
            const tipoCfg  = TIPO_CONFIG[t.tipo];
            const isMoving = moving === t.id;

            const ResultIcon = t.validado ? CheckCircle2 : t.vencedor === 'inconclusivo' ? MinusCircle : XCircle;
            const resultCls  = t.validado
              ? 'text-emerald-400'
              : t.vencedor === 'inconclusivo'
              ? 'text-yellow-400'
              : 'text-red-400';

            return (
              <div
                key={t.id}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <ResultIcon className={cn('h-4 w-4 shrink-0 mt-0.5', resultCls)} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', tipoCfg.cls)}>
                        {tipoCfg.label}
                      </span>
                      {t.validado && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Validado
                        </span>
                      )}
                      {t.link_ad && (
                        <a
                          href={t.link_ad}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-muted-foreground hover:text-primary"
                          title="Ver anúncio"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-sm font-medium">{t.titulo}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                      {funil   && <span>{funil.nome}</span>}
                      {projeto && <><span>·</span><span>{projeto.nome}</span></>}
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      disabled={isMoving}
                      onClick={() => voltarParaRodando(t)}
                      className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                      title="Voltar para Rodando"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={e => openEdit(t, e)}
                      className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                      title="Editar"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Variantes A/B */}
                {(t.variante_a || t.variante_b) && (
                  <div className="grid grid-cols-2 gap-2">
                    {(['a', 'b'] as const).map(v => {
                      const variante  = v === 'a' ? t.variante_a  : t.variante_b;
                      const resultado = v === 'a' ? t.resultado_a : t.resultado_b;
                      const ganhou    = t.vencedor === v;
                      return (
                        <div key={v} className={cn(
                          'rounded p-2.5 border text-xs',
                          ganhou ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border bg-muted/30',
                        )}>
                          <p className="font-semibold text-muted-foreground mb-1">
                            Variante {v.toUpperCase()} {ganhou && '🏆'}
                          </p>
                          <p className="text-foreground leading-snug">{variante ?? '—'}</p>
                          {resultado && <p className="mt-1 font-mono font-medium text-foreground">{resultado}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Resultado AD */}
                {t.tipo === 'ad' && (
                  <div className="space-y-1.5">
                    {t.comentario_ad && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/60">Hook: </span>
                        {t.comentario_ad}
                      </p>
                    )}
                    {t.resultado_a ? (
                      <p className="text-xs bg-muted/40 rounded p-2 text-muted-foreground">{t.resultado_a}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground/40 italic">Sem resultado registrado</p>
                    )}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border/60">
                  {t.metrica && <span>Métrica: <span className="text-foreground">{t.metrica}</span></span>}
                  {t.vencedor && t.vencedor !== 'inconclusivo' && (
                    <span>Vencedor: <span className="text-emerald-400 font-medium">{VENCEDOR_LABEL[t.vencedor]}</span></span>
                  )}
                  {t.vencedor === 'inconclusivo' && <span>Inconclusivo</span>}
                  <div className="flex-1" />
                  {t.tipo === 'funil_novo' && t.validado && t.funil_id && (
                    <button
                      type="button"
                      onClick={e => ativarFunil(t.funil_id!, e)}
                      disabled={activating === t.funil_id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors font-medium disabled:opacity-50"
                    >
                      <Rocket className="h-3 w-3" />
                      {activating === t.funil_id ? 'Ativando...' : 'Ativar funil'}
                    </button>
                  )}
                  <span>
                    {fmtDate(t.data_inicio)}
                    {t.data_fim && ` → ${fmtDate(t.data_fim)}`}
                  </span>
                </div>

                {t.notas && (
                  <p className="text-xs text-muted-foreground italic border-t border-border/60 pt-2">{t.notas}</p>
                )}

                <div className="text-[11px] text-muted-foreground/60 border-t border-border/40 pt-1.5">
                  Criado em {new Date(t.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  {t.criado_por && perfilMap[t.criado_por] && <span> por {perfilMap[t.criado_por]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TesteModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); onReload(); }}
        teste={editTeste}
        funis={funis}
        presetPipelineStatus="concluido"
      />
    </div>
  );
}
