import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react';

interface Alerta {
  codigo: string;
  severidade: 'critico' | 'atencao';
  titulo: string;
  detalhe: string;
}

interface Fonte {
  fonte: string;
  rotulo: string;
  ultimo_evento: string | null;
  registros: number;
  horas_atras: number | null;
  limiar_horas: number;
  defasado: boolean;
}

interface Agendamento {
  nome: string;
  agenda: string;
  ativo: boolean;
  ultimo_status: string | null;
  ultima_execucao: string | null;
  horas_atras: number | null;
  falhas_7d: number;
}

function haQuanto(horas: number | null): string {
  if (horas === null) return 'nunca rodou';
  if (horas < 1) return `há ${Math.round(horas * 60)} min`;
  if (horas < 48) return `há ${Math.round(horas)}h`;
  return `há ${Math.round(horas / 24)} dias`;
}

/**
 * Saúde do sistema — só para admin e sócio.
 *
 * Junta num lugar o que estava espalhado: os avisos de coerência dos dados
 * (`vw_alertas`, que até aqui só apareciam numa faixa que se fecha), a
 * frescura de cada fonte (`vw_ingest_health`) e o estado dos agendamentos.
 *
 * Mostra o que está **certo** também, e não só o que quebrou. Um painel que
 * fica vazio quando está tudo bem não diz se foi conferido ou se parou de
 * conferir — e essa diferença já custou julho inteiro de transações, quando o
 * `cs-sync` falhou 52 vezes seguidas sem ninguém perceber.
 *
 * O contador de falhas dos últimos 7 dias é o que a última execução esconde:
 * um agendamento pode ter dado certo agora e ter falhado seis vezes na semana.
 */
export function SaudeSistema() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [fontes, setFontes] = useState<Fonte[]>([]);
  const [jobs, setJobs] = useState<Agendamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [a, f, j] = await Promise.all([
      supabase.from('vw_alertas').select('codigo, severidade, titulo, detalhe'),
      supabase.from('vw_ingest_health').select('*'),
      supabase.from('vw_saude_agendamentos').select('*'),
    ]);
    // Consulta que falha não pode virar lista vazia: "nada aqui" e "não
    // consegui olhar" são coisas diferentes, e esta tela existe justamente
    // para dizer qual das duas é.
    const falha = a.error ?? f.error ?? j.error;
    setErro(falha ? falha.message : null);

    setAlertas((a.data as Alerta[]) ?? []);
    setFontes((f.data as Fonte[]) ?? []);
    setJobs((j.data as Agendamento[]) ?? []);
    setAtualizadoEm(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [carregar]);

  const fontesRuins = fontes.filter(f => f.defasado).length;
  const jobsRuins = jobs.filter(j => !j.ativo || j.falhas_7d > 0 || j.ultimo_status !== 'succeeded').length;
  const tudoCerto = !erro && alertas.length === 0 && fontesRuins === 0 && jobsRuins === 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Saúde do sistema
        </h3>
        <div className="flex items-center gap-2.5">
          {atualizadoEm && (
            <span className="text-[11px] text-muted-foreground">
              {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={carregar}
            aria-label="Conferir agora"
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      {erro && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">
            Não consegui ler o estado do sistema: {erro}
          </p>
        </div>
      )}

      {/* ---- avisos ativos ---- */}
      {alertas.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {alertas.map(a => (
            <li
              key={a.codigo}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5',
                a.severidade === 'critico'
                  ? 'border-destructive/40 bg-destructive/10'
                  : 'border-amber-500/30 bg-amber-500/10',
              )}
            >
              {a.severidade === 'critico'
                ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />}
              <div className="min-w-0 text-xs">
                <p className={cn('font-medium', a.severidade === 'critico' ? 'text-destructive' : 'text-amber-200')}>
                  {a.titulo}
                </p>
                <p className={cn('mt-0.5', a.severidade === 'critico' ? 'text-destructive/80' : 'text-amber-200/70')}>
                  {a.detalhe}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !loading && tudoCerto && (
          <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-xs text-emerald-200/90">
              Nenhum problema detectado nas checagens de dados, fontes e agendamentos.
            </p>
          </div>
        )
      )}

      {/* ---- fontes e agendamentos ---- */}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Fontes de dados
          </p>
          <ul className="flex flex-col gap-1.5">
            {fontes.map(f => (
              <li key={f.fonte} className="flex items-center gap-2.5 text-xs">
                <span className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  f.defasado ? 'bg-destructive' : 'bg-emerald-400',
                )} />
                <span className="min-w-0 flex-1 truncate text-foreground">{f.rotulo}</span>
                <span className={cn('shrink-0 tabular-nums', f.defasado ? 'text-destructive' : 'text-muted-foreground')}>
                  {haQuanto(f.horas_atras)}
                </span>
              </li>
            ))}
            {fontes.length === 0 && !loading && (
              <li className="text-xs text-muted-foreground">Nenhuma fonte monitorada.</li>
            )}
          </ul>
        </div>

        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Agendamentos
          </p>
          <ul className="flex flex-col gap-1.5">
            {jobs.map(j => {
              const ruim = !j.ativo || j.ultimo_status !== 'succeeded';
              return (
                <li key={j.nome} className="flex items-center gap-2.5 text-xs">
                  <span className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    ruim ? 'bg-destructive' : j.falhas_7d > 0 ? 'bg-amber-400' : 'bg-emerald-400',
                  )} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{j.nome}</span>
                  {j.falhas_7d > 0 && (
                    <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-300">
                      {j.falhas_7d} {j.falhas_7d === 1 ? 'falha' : 'falhas'} em 7d
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums text-muted-foreground">{haQuanto(j.horas_atras)}</span>
                </li>
              );
            })}
            {jobs.length === 0 && !loading && (
              <li className="text-xs text-muted-foreground">Nenhum agendamento visível.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
