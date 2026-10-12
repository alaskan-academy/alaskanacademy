import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { MetasNav } from '../components/MetasNav';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Loader2, Lightbulb, Target } from 'lucide-react';

/*
  As ideias do brainstorm, com o veredito que cada uma recebeu no plano.

  Duas decisões que não são óbvias:

  1. A ORDEM É O VEREDITO, não a seção. Agrupar por "Fazer já / Testar / Não
     agora / Feito" responde a pergunta com que se abre esta tela — "o que eu
     faço agora?". Ordenar pela seção responderia "onde isso está escrito no
     documento", que é a pergunta de quem já está lendo o documento.

  2. "Não agora" NÃO some. Ela é diferente de descartada: as duas de hoje
     trazem a condição de retomada escrita ("só se o piloto de aula esgotar",
     "rever com 2 mil assinantes"). Esconder transformaria a lista num registro
     só do que foi aprovado, que é metade da informação.

  A coluna de resultado é o selo "virou meta": quando a ideia tem um indicador
  ligado, a tela mostra como aquela meta vai. Sem isso, isto seria mais uma
  lista de cadastro envelhecendo sem ninguém voltar para avaliar — que é o erro
  que este projeto já pagou com 134 links de UTM e 36 order bumps.
*/

type Unidade = 'moeda' | 'percentual' | 'numero' | 'multiplicador';

interface Ideia {
  id: string;
  ideia: string;
  veredito: string;
  quando: string | null;
  secao: number | null;
  kpi: string | null;
  ordem: number;
  plano_secoes: { titulo: string } | null;
  metas_kpi: { nome: string; unidade: Unidade } | null;
}

interface MetaCurta { kpi: string; prazo: string; valor_alvo: number }

/* A ordem em que os vereditos aparecem. "Fazer já" primeiro porque é a
   resposta à pergunta com que se abre a tela. */
const ORDEM_VEREDITO = ['Fazer já', 'Testar', 'Não agora', 'Feito'];

const COR_VEREDITO: Record<string, string> = {
  'Fazer já':  'bg-emerald-500/15 text-emerald-400',
  'Testar':    'bg-sky-500/15 text-sky-400',
  'Não agora': 'bg-muted text-muted-foreground',
  'Feito':     'bg-primary/15 text-primary',
};

function formatar(valor: number | null | undefined, unidade: Unidade) {
  if (valor === null || valor === undefined) return '—';
  switch (unidade) {
    case 'moeda':         return formatCurrency(valor);
    case 'percentual':    return `${valor.toFixed(1).replace('.', ',')}%`;
    case 'multiplicador': return `${valor.toFixed(2).replace('.', ',')}x`;
    default:              return formatNumber(valor);
  }
}

export default function BrainstormPage() {
  const { empresaId } = useFilters();

  const [ideias, setIdeias]   = useState<Ideia[]>([]);
  const [metas, setMetas]     = useState<MetaCurta[]>([]);
  const [medido, setMedido]   = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);

    const [lista, alvos, medicao] = await Promise.all([
      supabase
        .from('brainstorm')
        .select('id, ideia, veredito, quando, secao, kpi, ordem, plano_secoes(titulo), metas_kpi(nome, unidade)')
        .order('ordem'),
      supabase.from('metas').select('kpi, prazo, valor_alvo').order('prazo'),
      supabase.rpc('fn_metas_medir', { p_empresa: empresaId }),
    ]);

    // Erro visível em vez de lista vazia: "não tem ideia" e "não consegui ler"
    // são coisas diferentes.
    if (lista.error) {
      setErro(lista.error.message);
      setLoading(false);
      return;
    }

    const medidas: Record<string, number> = {};
    for (const r of (medicao.data ?? []) as { kpi: string; valor: number | null }[]) {
      if (r.valor !== null) medidas[r.kpi] = Number(r.valor);
    }

    setIdeias((lista.data ?? []) as unknown as Ideia[]);
    setMetas((alvos.data ?? []) as MetaCurta[]);
    setMedido(medidas);
    setLoading(false);
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const hoje = new Date().toISOString().slice(0, 10);
  /** O alvo que vale é o próximo que ainda não venceu. */
  const proximoAlvo = (kpi: string) =>
    metas.filter(m => m.kpi === kpi && m.prazo >= hoje).sort((a, b) => a.prazo.localeCompare(b.prazo))[0];

  const grupos = ORDEM_VEREDITO
    .map(v => ({ veredito: v, itens: ideias.filter(i => i.veredito === v) }))
    .filter(g => g.itens.length > 0);

  return (
    <DashboardLayout title="Brainstorm" hideFilters>
      <MetasNav />

      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          As ideias anotadas, com o veredito que cada uma recebeu no{' '}
          <b className="text-foreground">Plano de crescimento Out/26 a Jul/27</b>. O número ao
          lado é a <b className="text-foreground">seção</b> do plano que trata do assunto — não é
          prioridade. Quando a ideia virou meta medível, o resultado dela aparece junto.
        </p>

        {erro && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Não consegui ler o brainstorm: {erro}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando ideias…
          </div>
        ) : grupos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Lightbulb className="h-5 w-5" />
            Nenhuma ideia registrada ainda.
          </div>
        ) : (
          grupos.map(g => (
            <section key={g.veredito}>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.veredito}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                  {g.itens.length}
                </span>
              </h2>

              <div className="space-y-2">
                {g.itens.map(i => {
                  const alvo  = i.kpi ? proximoAlvo(i.kpi) : undefined;
                  const agora = i.kpi ? medido[i.kpi] : undefined;

                  return (
                    <div
                      key={i.id}
                      className="rounded-lg border border-border bg-card px-4 py-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                          COR_VEREDITO[i.veredito] ?? 'bg-muted text-muted-foreground',
                        )}>
                          {i.veredito}
                        </span>
                        <span className="text-sm text-foreground">{i.ideia}</span>
                        {i.secao !== null && (
                          <span
                            className="text-xs text-muted-foreground"
                            title={i.plano_secoes?.titulo ?? undefined}
                          >
                            seção {i.secao}
                            {i.plano_secoes?.titulo && ` · ${i.plano_secoes.titulo}`}
                          </span>
                        )}
                      </div>

                      {i.quando && (
                        <div className="mt-1 text-xs text-muted-foreground">{i.quando}</div>
                      )}

                      {/* A coluna de resultado: a ideia que virou meta mostra como a meta vai. */}
                      {i.metas_kpi && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs">
                          <Target className="h-3 w-3 text-primary" />
                          <span className="text-muted-foreground">virou meta —</span>
                          <b className="text-foreground">{i.metas_kpi.nome}</b>
                          <span className="text-muted-foreground">
                            {agora !== undefined
                              ? `${formatar(agora, i.metas_kpi.unidade)} agora`
                              : 'medição manual'}
                            {alvo && `, alvo ${formatar(alvo.valor_alvo, i.metas_kpi.unidade)} até ${alvo.prazo.slice(5, 7)}/${alvo.prazo.slice(2, 4)}`}
                          </span>
                        </div>
                      )}
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
