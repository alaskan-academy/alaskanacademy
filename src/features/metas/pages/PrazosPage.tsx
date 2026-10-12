import { useState, useEffect, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { MetasNav } from '../components/MetasNav';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CalendarClock, Check, AlertTriangle } from 'lucide-react';

/*
  As trinta ações com data do plano, e quais já venceram.

  ── Por que esta tela existe ───────────────────────────────────────────────

  O pedido dela tinha três partes — "metas com PRAZOS, AVISOS e coleta de kpis
  automáticas" — e a primeira entrega cobriu só a terceira. O plano traz
  trinta ações datadas, em três blocos, e nenhuma estava no painel:

    · 15 ganhos rápidos, todos vencendo em 25/10
    ·  7 passos do calendário de Natal e Black Friday, de 13/10 a 16/12
    ·  8 mini lançamentos, um por mês, de nov/26 a jul/27

  ── Marcar é escrita, e por isso é aqui ────────────────────────────────────

  Esta é a única tela do módulo que grava. A marcação não é um booleano: é a
  data em que foi feita (`feito_em`), e nulo é o não feito. Um campo só, de
  propósito — `feito` e `feito_em` lado a lado seria a primeira armadilha do
  CLAUDE.md, e eles sempre divergem.

  ── A ordem é o vencimento, não a seção ────────────────────────────────────

  Dentro de cada bloco as ações saem por data, e o que já venceu sobe. A
  pergunta desta tela é "o que está em cima da hora", não "onde isso está
  escrito no documento" — para essa pergunta existe o número da seção.

  ── O que o plano não diz, a tela não inventa ──────────────────────────────

  Dois passos do calendário são "a partir de 30/10" e "a partir de 16/12",
  sem fim escrito. Eles aparecem como janela aberta, e não vencem nunca —
  porque atribuir um fim a eles seria preencher silêncio com chute.
*/

interface Acao {
  id: string;
  bloco: string;
  titulo: string;
  detalhe: string | null;
  inicio: string | null;
  prazo: string | null;
  feito_em: string | null;
  secao: number | null;
  ordem: number;
  parte_de: string | null;
  plano_secoes: { titulo: string } | null;
}

/*
  Os blocos vêm do BANCO, não daqui. Eles já estiveram escritos em dois
  lugares — num `check (bloco in (...))` e num array neste arquivo — e a
  primeira ação de `recuperacao` bateu no check enquanto a tela seguia
  mostrando três grupos. Lista fixa no código envelhece em silêncio, que é a
  terceira armadilha do CLAUDE.md; bloco novo agora aparece sozinho.
*/
interface Bloco {
  chave: string;
  titulo: string;
  subtitulo: string | null;
  ordem: number;
}

const ROTULO_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Sem `new Date`, que na virada do fuso volta um dia. */
function diaMes(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function mesAno(iso: string) {
  const [a, m] = iso.split('-');
  return `${ROTULO_MES[Number(m) - 1]}/${a.slice(2)}`;
}

/**
 * É o último dia do mês? Em UTC de propósito: `new Date('2026-12-15')` no
 * fuso de Brasília volta para 14/12, e aí o rótulo erra o dia.
 */
function ultimoDiaDoMes(iso: string) {
  const [a, m, d] = iso.split('-').map(Number);
  return d === new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/**
 * "13/10 a 24/10" · "até 25/10" · "a partir de 30/10" · "dez/26".
 *
 * O intervalo só vira mês quando cobre o mês INTEIRO. Vale a checagem: a
 * última chamada do Natal vai de 01/12 a 15/12, e arredondar para "dez/26"
 * daria à ação mais duas semanas do que o plano deu.
 */
function janela(a: Acao) {
  if (a.inicio && a.prazo) {
    const mesesInteiros = a.inicio.endsWith('-01') && ultimoDiaDoMes(a.prazo);
    if (mesesInteiros) {
      return a.inicio.slice(0, 7) === a.prazo.slice(0, 7)
        ? mesAno(a.inicio)
        : `${mesAno(a.inicio).split('/')[0]} a ${mesAno(a.prazo)}`;
    }
    return `${diaMes(a.inicio)} a ${diaMes(a.prazo)}`;
  }
  if (a.prazo)  return `até ${diaMes(a.prazo)}`;
  if (a.inicio) return `a partir de ${diaMes(a.inicio)}`;
  return '';
}

const HOJE = new Date().toISOString().slice(0, 10);

export default function PrazosPage() {
  const { toast } = useToast();

  const [acoes, setAcoes]     = useState<Acao[]>([]);
  const [blocos, setBlocos]   = useState<Bloco[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);

    const [lista, grupos] = await Promise.all([
      supabase
        .from('plano_acoes')
        .select('id, bloco, titulo, detalhe, inicio, prazo, feito_em, secao, ordem, parte_de, plano_secoes(titulo)')
        .order('ordem'),
      supabase.from('plano_blocos').select('chave, titulo, subtitulo, ordem').order('ordem'),
    ]);

    // Erro visível em vez de lista vazia: "não tem ação" e "não consegui ler"
    // são coisas diferentes.
    if (lista.error) {
      setErro(lista.error.message);
      setLoading(false);
      return;
    }
    setAcoes((lista.data ?? []) as unknown as Acao[]);
    setBlocos((grupos.data ?? []) as Bloco[]);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /** Marcar grava a data; desmarcar apaga. Nulo é o não feito. */
  async function alternar(a: Acao) {
    setSalvando(a.id);
    const novo = a.feito_em ? null : new Date().toISOString();

    const { error } = await supabase
      .from('plano_acoes')
      .update({ feito_em: novo })
      .eq('id', a.id);

    setSalvando(null);

    if (error) {
      // Não mexer no estado local quando a gravação falhou: a tela mentiria
      // sobre o que está no banco até o próximo recarregamento.
      toast({
        title: 'Não consegui salvar',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }
    setAcoes(prev => prev.map(x => (x.id === a.id ? { ...x, feito_em: novo } : x)));
  }

  const porBloco = useMemo(() => {
    const venceu = (a: Acao) => !a.feito_em && a.prazo !== null && a.prazo < HOJE;

    /* Ação sem data vai para o fim: ela não é urgente, é só sem prazo — e
       misturá-la com as datadas faria a fila mentir sobre o que corre. */
    const chave = (a: Acao) => a.prazo ?? a.inicio ?? '9999';

    const ordenar = (lista: Acao[]) => [...lista].sort((x, y) => {
      if (venceu(x) !== venceu(y)) return venceu(x) ? -1 : 1;
      if (!!x.feito_em !== !!y.feito_em) return x.feito_em ? 1 : -1;
      return chave(x).localeCompare(chave(y));
    });

    return blocos.map(b => {
      // Só os pais DESTE bloco entram na fila; as partes vão aninhadas dentro
      // deles, venham do bloco que vierem.
      const itens = ordenar(acoes.filter(a => a.bloco === b.chave && !a.parte_de))
        .map(pai => ({
          pai,
          partes: acoes
            .filter(f => f.parte_de === pai.id)
            .sort((x, y) => x.ordem - y.ordem),
        }));

      /* O contador conta o que a tela DESENHA aqui, não o que a coluna
         `bloco` diz. As três mudanças da recuperação têm bloco
         `recuperacao` mas o pai delas é um ganho rápido, e aparecem lá.
         Contando por `bloco`, "Recuperação e Voxuy" anunciava 8 e mostrava
         4 — o cabeçalho mentindo sobre a própria lista. */
      const desenhadas = itens.flatMap(i => [i.pai, ...i.partes]);

      return {
        ...b,
        itens,
        total:    desenhadas.length,
        feitas:   desenhadas.filter(a => a.feito_em).length,
        vencidas: desenhadas.filter(venceu).length,
        semData:  desenhadas.filter(a => !a.prazo && !a.inicio).length,
      };
    }).filter(b => b.itens.length > 0);
  }, [acoes, blocos]);

  /** Uma linha da fila. Pai e parte usam a mesma; muda só o recuo. */
  function Linha({ a, filha = false, partes }: { a: Acao; filha?: boolean; partes?: Acao[] }) {
    const feita   = !!a.feito_em;
    const vencida = !feita && a.prazo !== null && a.prazo < HOJE;
    const semData = !a.prazo && !a.inicio;
    const feitasDasPartes = partes?.filter(p => p.feito_em).length ?? 0;

    return (
      <div
        className={cn(
          'flex gap-3 rounded-lg border bg-card px-4 py-3 transition-colors',
          vencida ? 'border-amber-500/40' : 'border-border',
          feita && 'opacity-60',
          filha && 'border-dashed bg-card/40',
        )}
      >
        <button
          type="button"
          onClick={() => alternar(a)}
          disabled={salvando === a.id}
          aria-pressed={feita}
          aria-label={feita ? `Desmarcar ${a.titulo}` : `Marcar ${a.titulo} como feita`}
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
            feita
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-muted-foreground/40 hover:border-primary',
            salvando === a.id && 'opacity-50',
          )}
        >
          {salvando === a.id
            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
            : feita && <Check className="h-3 w-3" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={cn(
              filha ? 'text-[13px] text-foreground/90' : 'text-sm text-foreground',
              feita && 'line-through decoration-muted-foreground',
            )}>
              {a.titulo}
            </span>

            {/* "Sem data no plano" é estado próprio, não prazo em branco: o
                documento descreve a ação sem dar prazo, e esconder isso faria
                parecer campo esquecido em vez de compromisso sem data. */}
            <span className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
              vencida   ? 'bg-amber-500/15 text-amber-400'
              : semData ? 'bg-muted text-muted-foreground/70'
                        : 'bg-secondary text-muted-foreground',
            )}>
              {vencida && <AlertTriangle className="h-2.5 w-2.5" />}
              {semData ? 'sem data no plano' : janela(a)}
            </span>

            {/* Quantas partes já foram feitas. O pai NÃO é marcado por elas:
                a tela mostra a contradição em vez de resolvê-la sozinha, que
                seria espelho precisando de gatilho. */}
            {partes && partes.length > 0 && (
              <span className={cn(
                'rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                feitasDasPartes === partes.length
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-muted text-muted-foreground',
              )}>
                {feitasDasPartes}/{partes.length} partes
              </span>
            )}

            {a.secao !== null && (
              <span
                className="text-[11px] text-muted-foreground/70"
                title={a.plano_secoes?.titulo ?? undefined}
              >
                seção {a.secao}
              </span>
            )}
          </div>

          {a.detalhe && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {a.detalhe}
            </p>
          )}
        </div>
      </div>
    );
  }

  const semDataTotal = acoes.filter(a => !a.prazo && !a.inicio).length;

  return (
    <DashboardLayout title="Prazos" hideFilters>
      <MetasNav />

      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          As <b className="text-foreground">{acoes.length} ações</b> do Plano de crescimento
          Out/26 a Jul/27, lidas seção por seção. Marcar grava a data de hoje; desmarcar
          apaga. O que venceu sem ser feito sobe para o topo do bloco e vira aviso em{' '}
          <b className="text-foreground">Metas</b>.
          {semDataTotal > 0 && (
            <> O plano descreve <b className="text-foreground">{semDataTotal}</b> delas sem
            dar prazo — elas ficam marcadas como tal, no fim de cada bloco.</>
          )}
        </p>

        {erro && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Não consegui ler as ações: {erro}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando prazos…
          </div>
        ) : porBloco.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <CalendarClock className="h-5 w-5" />
            Nenhuma ação cadastrada ainda.
          </div>
        ) : (
          porBloco.map(b => (
            <section key={b.chave}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{b.titulo}</h2>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {b.feitas}/{b.total}
                </span>
                {b.vencidas > 0 && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                    {b.vencidas} vencida{b.vencidas > 1 ? 's' : ''}
                  </span>
                )}
                {b.semData > 0 && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
                    {b.semData} sem data
                  </span>
                )}
              </div>
              {b.subtitulo && (
                <p className="mb-2.5 text-xs text-muted-foreground">{b.subtitulo}</p>
              )}

              <div className="space-y-2">
                {b.itens.map(({ pai, partes }) => (
                  <div key={pai.id} className="space-y-1.5">
                    <Linha a={pai} partes={partes.length ? partes : undefined} />
                    {partes.length > 0 && (
                      <div className="ml-7 space-y-1.5 border-l border-border/60 pl-3">
                        {partes.map(f => <Linha key={f.id} a={f} filha />)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
