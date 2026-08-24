import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import { Megaphone, Pencil, Trash2, Loader2, X } from 'lucide-react';

interface Recado {
  id: string;
  texto: string;
  criado_por: string | null;
  criado_em: string;
}

/** Dias inteiros entre a data e agora. */
function idadeEmDias(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function quando(dias: number): string {
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 14) return 'há uma semana';
  if (dias < 30) return `há ${Math.floor(dias / 7)} semanas`;
  return `há ${Math.floor(dias / 30)} ${Math.floor(dias / 30) === 1 ? 'mês' : 'meses'}`;
}

const VELHO = 7;   // a partir daqui o recado deixa de ser notícia

/**
 * Mural de recados — escrito por sócio, lido por todos.
 *
 * Mural é a peça mais fácil de apodrecer no produto: ninguém escreve, o último
 * recado envelhece, e um mês depois a equipe está lendo aviso vencido como se
 * fosse novidade. Foi assim que `editor_folgas` acabou com zero linhas.
 *
 * O remédio aqui é o mural **denunciar o próprio abandono**: passados sete
 * dias, o recado desbota e ganha a idade escrita ao lado. Melhor ele parecer
 * velho do que se passar por novo. E quando não há nenhum, o bloco simplesmente
 * não existe para quem não pode escrever — em vez de mostrar um quadro vazio
 * dizendo que ninguém tem nada a dizer.
 */
export function MuralRecados({ ehAdmin, userId }: { ehAdmin: boolean; userId: string }) {
  const confirm = useConfirm();

  const [recados, setRecados] = useState<Recado[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [escrevendo, setEscrevendo] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [r, p] = await Promise.all([
      supabase.from('recados').select('*').order('criado_em', { ascending: false }).limit(3),
      supabase.from('perfis').select('id, nome'),
    ]);
    setRecados((r.data as Recado[]) ?? []);
    const m: Record<string, string> = {};
    ((p.data as { id: string; nome: string }[]) ?? []).forEach(x => { m[x.id] = x.nome; });
    setNomes(m);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    const texto = rascunho.trim();
    if (!texto) { toast({ title: 'Escreva alguma coisa', variant: 'destructive' }); return; }

    setSalvando(true);
    const { error } = editandoId
      ? await supabase.from('recados').update({ texto }).eq('id', editandoId)
      : await supabase.from('recados').insert({ texto, criado_por: userId });
    setSalvando(false);

    if (error) {
      toast({ title: 'Não salvou', description: error.message, variant: 'destructive' });
      return;
    }
    setRascunho('');
    setEscrevendo(false);
    setEditandoId(null);
    carregar();
  };

  const excluir = async (r: Recado) => {
    const ok = await confirm({
      title: 'Apagar recado',
      description: 'O recado some do mural para todo mundo.',
      confirmText: 'Apagar',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('recados').delete().eq('id', r.id);
    if (error) {
      toast({ title: 'Não apagou', description: error.message, variant: 'destructive' });
      return;
    }
    carregar();
  };

  // Quem não escreve não precisa ver um mural vazio dizendo que está vazio.
  if (!loading && recados.length === 0 && !ehAdmin) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Megaphone className="h-3.5 w-3.5" /> Recados
        </h3>
        {ehAdmin && !escrevendo && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setEscrevendo(true); setEditandoId(null); setRascunho(''); }}
          >
            Escrever
          </Button>
        )}
      </header>

      {escrevendo && (
        <div className="mb-3 flex flex-col gap-2">
          <Textarea
            autoFocus
            value={rascunho}
            onChange={e => setRascunho(e.target.value)}
            placeholder="O que a equipe precisa saber esta semana?"
            className="min-h-[72px] text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setEscrevendo(false); setEditandoId(null); setRascunho(''); }}
              disabled={salvando}
            >
              <X className="mr-1.5 h-3.5 w-3.5" /> Cancelar
            </Button>
            <Button size="sm" onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {editandoId ? 'Salvar' : 'Publicar'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-4 text-center text-xs text-muted-foreground">Carregando...</p>
      ) : recados.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Nenhum recado. O mural só serve se alguém escrever nele.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {recados.map(r => {
            const dias = idadeEmDias(r.criado_em);
            const velho = dias >= VELHO;
            return (
              <li
                key={r.id}
                className={cn(
                  'rounded-lg border px-3.5 py-3',
                  velho ? 'border-border/60 bg-muted/20' : 'border-border bg-muted/40',
                )}
              >
                <p className={cn(
                  'whitespace-pre-wrap text-sm leading-relaxed',
                  velho ? 'text-muted-foreground' : 'text-foreground',
                )}>
                  {r.texto}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{r.criado_por ? (nomes[r.criado_por] ?? '—') : '—'}</span>
                  <span>·</span>
                  <span className={cn(velho && 'text-amber-500/80')}>{quando(dias)}</span>
                  {velho && <span className="text-amber-500/80">— pode estar desatualizado</span>}

                  {ehAdmin && (
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        aria-label="Editar recado"
                        onClick={() => { setEditandoId(r.id); setRascunho(r.texto); setEscrevendo(true); }}
                        className="rounded p-1 hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Apagar recado"
                        onClick={() => excluir(r)}
                        className="rounded p-1 hover:bg-accent hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
