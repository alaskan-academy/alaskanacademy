import { useState, useEffect, useCallback, useRef } from 'react';
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
  /** Quando sai do mural. Nulo = fica até alguém apagar. */
  expira_em: string | null;
}

/*
  Os prazos oferecidos.

  O texto do formulário pergunta "o que a equipe precisa saber esta semana?",
  então o padrão é uma semana — o mural nasceu semanal e o prazo só torna isso
  explícito. "Sem prazo" existe para o aviso que vale até mudar (um telefone
  novo, uma regra), e é justamente o que não deveria ser o padrão.
*/
const PRAZOS = [
  { dias: 3,    rotulo: '3 dias' },
  { dias: 7,    rotulo: '1 semana' },
  { dias: 14,   rotulo: '2 semanas' },
  { dias: 30,   rotulo: '1 mês' },
  { dias: null, rotulo: 'Sem prazo' },
] as const;

const PRAZO_PADRAO = 7;

/** Dias inteiros que faltam até a data. Negativo se já passou. */
function diasAte(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
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
export function MuralRecados({
  ehAdmin,
  userId,
  destacarId,
}: {
  ehAdmin: boolean;
  userId: string;
  /*
    O recado que veio pela notificação, para rolar até ele e acender.

    Sem isto, clicar em "Fulano no mural: ..." levava ao Início e parava por
    aí: a pessoa chegava numa página e tinha que procurar o recado — e podia
    nem estar na tela, porque o mural mostra três e esconde os vencidos.
  */
  destacarId?: string | null;
}) {
  const confirm = useConfirm();
  const refDestaque = useRef<HTMLLIElement | null>(null);

  const [recados, setRecados] = useState<Recado[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [escrevendo, setEscrevendo] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [prazoDias, setPrazoDias] = useState<number | null>(PRAZO_PADRAO);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [r, p] = await Promise.all([
      /*
        Vencido some do mural. `or` e não dois filtros: sem prazo (nulo) é
        recado que fica, e um `gt` sozinho descartaria justamente esses.
      */
      supabase
        .from('recados')
        .select('*')
        .or(`expira_em.is.null,expira_em.gt.${new Date().toISOString()}`)
        .order('criado_em', { ascending: false })
        .limit(3),
      supabase.from('perfis').select('id, nome'),
    ]);

    let lista = (r.data as Recado[]) ?? [];

    /*
      O recado da notificação entra na lista mesmo que já tenha vencido ou
      caído fora dos três mais novos.

      Sem isto o clique levaria a um mural onde ele não está — que é
      exatamente a queixa que originou esta mudança, só que mais difícil de
      perceber, porque a tela pareceria funcionar.
    */
    if (destacarId && !lista.some(x => x.id === destacarId)) {
      const { data: extra } = await supabase.from('recados').select('*').eq('id', destacarId).maybeSingle();
      if (extra) lista = [extra as Recado, ...lista];
    }

    setRecados(lista);
    const m: Record<string, string> = {};
    ((p.data as { id: string; nome: string }[]) ?? []).forEach(x => { m[x.id] = x.nome; });
    setNomes(m);
    setLoading(false);
  }, [destacarId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Rolar até o recado da notificação assim que ele existir na tela.
  useEffect(() => {
    if (!destacarId || loading) return;
    refDestaque.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [destacarId, loading]);

  const salvar = async () => {
    const texto = rascunho.trim();
    if (!texto) { toast({ title: 'Escreva alguma coisa', variant: 'destructive' }); return; }

    setSalvando(true);
    // O prazo é gravado como instante, e não como "quantos dias": guardar a
    // duração obrigaria a recalcular a partir de `criado_em` em toda leitura,
    // e a conta mudaria de resposta se a data de criação fosse editada.
    const expira_em = prazoDias === null
      ? null
      : new Date(Date.now() + prazoDias * 86400000).toISOString();

    const { error } = editandoId
      ? await supabase.from('recados').update({ texto, expira_em }).eq('id', editandoId)
      : await supabase.from('recados').insert({ texto, criado_por: userId, expira_em });
    setSalvando(false);

    if (error) {
      toast({ title: 'Não salvou', description: error.message, variant: 'destructive' });
      return;
    }
    setRascunho('');
    setEscrevendo(false);
    setEditandoId(null);
    setPrazoDias(PRAZO_PADRAO);
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
          {/* O prazo fica ao lado do botão de publicar, e não escondido num
              menu: escolher quanto tempo o aviso vale é parte de escrevê-lo. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Sai do mural em</span>
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-secondary p-1">
              {PRAZOS.map(o => (
                <button
                  key={o.rotulo}
                  type="button"
                  onClick={() => setPrazoDias(o.dias)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    prazoDias === o.dias
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setEscrevendo(false); setEditandoId(null); setRascunho(''); setPrazoDias(PRAZO_PADRAO); }}
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
                ref={r.id === destacarId ? refDestaque : undefined}
                className={cn(
                  'rounded-lg border px-3.5 py-3 transition-colors',
                  velho ? 'border-border/60 bg-muted/20' : 'border-border bg-muted/40',
                  // Quem chegou pela notificação vê qual recado era.
                  r.id === destacarId && 'border-primary/60 bg-primary/10 ring-1 ring-primary/40',
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
                  {velho && !r.expira_em && <span className="text-amber-500/80">— pode estar desatualizado</span>}
                  {/*
                    Com prazo, o aviso de "pode estar desatualizado" perde a
                    função: o recado sai sozinho antes de envelhecer. No lugar
                    dele, quanto falta — que é a informação que quem escreveu
                    quer conferir.
                  */}
                  {r.expira_em && (
                    <span className="text-muted-foreground">
                      · sai {diasAte(r.expira_em) <= 0
                        ? 'hoje'
                        : diasAte(r.expira_em) === 1
                          ? 'amanhã'
                          : `em ${diasAte(r.expira_em)} dias`}
                    </span>
                  )}

                  {ehAdmin && (
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        aria-label="Editar recado"
                        onClick={() => {
                          setEditandoId(r.id);
                          setRascunho(r.texto);
                          // Sem isto, editar o texto de um recado sem prazo o
                          // faria vencer em uma semana sem ninguém pedir.
                          setPrazoDias(r.expira_em ? Math.max(diasAte(r.expira_em), 1) : null);
                          setEscrevendo(true);
                        }}
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
