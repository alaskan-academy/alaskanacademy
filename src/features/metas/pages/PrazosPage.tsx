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
  bloco: 'ganho_rapido' | 'calendario' | 'mini_lancamento';
  titulo: string;
  detalhe: string | null;
  inicio: string | null;
  prazo: string | null;
  feito_em: string | null;
  secao: number | null;
  ordem: number;
  plano_secoes: { titulo: string } | null;
}

const BLOCOS = [
  {
    chave: 'ganho_rapido' as const,
    titulo: 'Ganhos rápidos',
    subtitulo:
      'Ações de poucos dias que destravam caixa antes da Black Friday. Juntas, o plano estima R$ 10–15 mil/mês de lucro sem gastar mais em anúncio.',
  },
  {
    chave: 'calendario' as const,
    titulo: 'Natal e Black Friday',
    subtitulo:
      'Vender o Natal cedo para a artesã produzir até 15/12, e usar a Black Friday na base — o CPM da semana da BF é o mais caro do ano.',
  },
  {
    chave: 'mini_lancamento' as const,
    titulo: 'Mini lançamentos',
    subtitulo:
      'Um por mês, amarrado à data que a artesã vende. Aviso 7 dias antes, abertura com preço de lançamento por 72 h, último dia, e depois o produto vira bump ou entra no Completo.',
  },
];

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
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    const { data, error } = await supabase
      .from('plano_acoes')
      .select('id, bloco, titulo, detalhe, inicio, prazo, feito_em, secao, ordem, plano_secoes(titulo)')
      .order('ordem');

    // Erro visível em vez de lista vazia: "não tem ação" e "não consegui ler"
    // são coisas diferentes.
    if (error) {
      setErro(error.message);
      setLoading(false);
      return;
    }
    setAcoes((data ?? []) as unknown as Acao[]);
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
    return BLOCOS.map(b => {
      const itens = acoes
        .filter(a => a.bloco === b.chave)
        .sort((x, y) => {
          // Vencidas primeiro; depois por data; feitas por último.
          if (venceu(x) !== venceu(y)) return venceu(x) ? -1 : 1;
          if (!!x.feito_em !== !!y.feito_em) return x.feito_em ? 1 : -1;
          return (x.prazo ?? x.inicio ?? '').localeCompare(y.prazo ?? y.inicio ?? '');
        });
      return {
        ...b,
        itens,
        feitas: itens.filter(a => a.feito_em).length,
        vencidas: itens.filter(venceu).length,
      };
    }).filter(b => b.itens.length > 0);
  }, [acoes]);

  return (
    <DashboardLayout title="Prazos" hideFilters>
      <MetasNav />

      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          As <b className="text-foreground">{acoes.length} ações com data</b> do Plano de
          crescimento Out/26 a Jul/27. Marcar grava a data de hoje; desmarcar apaga. O que
          venceu sem ser feito sobe para o topo do bloco e vira aviso em{' '}
          <b className="text-foreground">Metas</b>.
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
            Nenhuma ação com data cadastrada ainda.
          </div>
        ) : (
          porBloco.map(b => (
            <section key={b.chave}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{b.titulo}</h2>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {b.feitas}/{b.itens.length}
                </span>
                {b.vencidas > 0 && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                    {b.vencidas} vencida{b.vencidas > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="mb-2.5 text-xs text-muted-foreground">{b.subtitulo}</p>

              <div className="space-y-2">
                {b.itens.map(a => {
                  const feita   = !!a.feito_em;
                  const vencida = !feita && a.prazo !== null && a.prazo < HOJE;
                  const aberta  = a.prazo === null;

                  return (
                    <div
                      key={a.id}
                      className={cn(
                        'flex gap-3 rounded-lg border bg-card px-4 py-3 transition-colors',
                        vencida ? 'border-amber-500/40' : 'border-border',
                        feita && 'opacity-60',
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
                            'text-sm text-foreground',
                            feita && 'line-through decoration-muted-foreground',
                          )}>
                            {a.titulo}
                          </span>

                          <span className={cn(
                            'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                            vencida  ? 'bg-amber-500/15 text-amber-400'
                            : aberta ? 'bg-muted text-muted-foreground'
                                     : 'bg-secondary text-muted-foreground',
                          )}>
                            {vencida && <AlertTriangle className="h-2.5 w-2.5" />}
                            {janela(a)}
                          </span>

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
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
