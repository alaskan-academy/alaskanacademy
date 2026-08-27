import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Defasagem, rotuloDoAdHook } from './tipos';

/**
 * O que falta, por projeto E POR FUNIL.
 *
 * A primeira versão era uma linha corrida por funil — nome, selo, o que falta e
 * as três contagens em prosa cinza, tudo brigando pelo mesmo espaço. Ficava
 * ilegível por dois motivos: as contagens em texto não davam para comparar
 * entre linhas, e um projeto que roda TSL e VSL aparecia duas vezes seguidas,
 * lendo como duplicata em vez de dois funis.
 *
 * Agora é grade: o projeto aparece UMA vez, cada funil é uma linha, e novo /
 * iteração / variação são três colunas alinhadas. O zero fica na vertical, que
 * é como o olho acha buraco.
 *
 * Nenhum valor em dinheiro aparece. A lista É ordenada por investimento — quem
 * mais gasta cobra primeiro, e a sugestão é sempre o AD que mais recebeu verba
 * — mas o número não vai para a tela.
 */
export function AlertaDefasagem({ linhas }: { linhas: Defasagem[] }) {
  const urgentes = useMemo(() => linhas.filter(l => l.prioridade < 5), [linhas]);

  /* Um projeto vira um bloco, com uma linha por funil. A ordem entre projetos é
     a da prioridade mais alta que cada um tem. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Defasagem[]>();
    for (const l of urgentes) {
      const k = l.projeto ?? '—';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k)!.push(l);
    }
    return Array.from(mapa, ([projeto, funis]) => ({ projeto, funis }));
  }, [urgentes]);

  /* O aviso de "sem funil" é por PROJETO — repetido em cada linha viraria eco. */
  const semFunil = useMemo(() => Array.from(
    new Map(linhas.filter(l => l.lotes_sem_funil > 0)
      .map(l => [l.projeto_id, l])).values()), [linhas]);

  if (linhas.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground">
        Nenhum projeto ativo recebeu investimento nos últimos 7 dias.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {urgentes.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300/90">
          Os {linhas.length} funis com verba têm novo, iteração e variação em estoque, e o mix está na meta.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/[0.07]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-amber-500/20 px-3.5 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-200">
              {urgentes.length === 1 ? '1 funil precisa de criativo' : `${urgentes.length} funis precisam de criativo`}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              TSL e VSL são contas separadas · iteração antes de novo
            </span>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/50">
                <th className="px-3.5 py-1 text-left font-medium">Funil</th>
                <th className="w-12 px-1 py-1 text-right font-medium" title="ADs do tipo Novo">Novo</th>
                <th className="w-14 px-1 py-1 text-right font-medium" title="ADs do tipo Iteração">Iter.</th>
                <th className="w-14 px-1 py-1 text-right font-medium" title="Vertical, Horizontal, Formato ou Corpo">Var.</th>
                <th className="px-3.5 py-1 text-left font-medium">Precisa de</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(g => (
                <BlocoDoProjeto key={g.projeto} projeto={g.projeto} funis={g.funis} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Um lote sem funil não entra na conta de TSL nem de VSL, porque ninguém
        sabe qual ele serve — chutar produziria um estoque que não existe. São
        metade dos lotes hoje, então este aviso não é detalhe: é o que impede os
        números acima de parecerem piores do que são.
      */}
      {semFunil.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-foreground">
              {semFunil.reduce((s, l) => s + l.lotes_sem_funil, 0)} ADs sem funil informado
            </span>
            {' '}ficam fora das contas acima —{' '}
            {semFunil.map(l => `${l.projeto} (${l.lotes_sem_funil})`).join(' · ')}.
            {' '}Preencher o campo Funil na Produção faz eles contarem.
          </div>
        </div>
      )}
    </div>
  );
}

function BlocoDoProjeto({ projeto, funis }: { projeto: string; funis: Defasagem[] }) {
  return (
    <>
      <tr className="border-t border-amber-500/15">
        <td colSpan={5} className="px-3.5 pb-0.5 pt-2 text-xs font-medium text-foreground">
          {projeto}
        </td>
      </tr>
      {funis.map(l => <LinhaDoFunil key={l.funil} l={l} />)}
    </>
  );
}

function LinhaDoFunil({ l }: { l: Defasagem }) {
  const vazio = l.prioridade === 0;

  /* A ordem das faltas segue a escada da prioridade: iteração, variação, novo.
     Quem lê rápido lê a primeira. */
  const faltas = [
    l.falta_iteracao && 'iteração',
    l.falta_variacao && 'variação',
    l.falta_novo && 'novo',
  ].filter(Boolean) as string[];

  /* A sugestão vale para o lado da variação — e também com o mix estourado,
     porque "novo demais" quer dizer "faça mais do outro lado". */
  const mostrarSugestao = (l.falta_variacao || l.mix_estourado) && !vazio;

  return (
    <>
      <tr>
        <td className="py-0.5 pl-6 pr-2">
          <span className="rounded bg-secondary px-1.5 py-px text-[10px] font-medium tracking-wide text-foreground">
            {l.funil}
          </span>
        </td>
        <Num n={l.ads_novo} />
        <Num n={l.ads_iteracao} />
        <Num n={l.ads_variacao} />
        <td className="py-0.5 pl-3.5 pr-3.5">
          <span className={cn('text-[11px]', vazio ? 'text-red-300' : 'text-amber-200/90')}>
            {vazio ? 'nada em produção para este funil'
              : faltas.length > 0 ? faltas.join(' e ')
              : `menos novo — está em ${l.pct_novo}%, a meta é ${l.pct_novo_meta}%`}
          </span>
        </td>
      </tr>

      {mostrarSugestao && (
        <tr>
          <td />
          <td colSpan={4} className="pb-1 pl-3.5 pr-3.5 pt-0">
            {l.sug_ad != null ? (
              <span className="flex flex-wrap items-baseline gap-x-1 text-[11px] text-muted-foreground">
                <ArrowRight className="h-3 w-3 shrink-0 translate-y-0.5" />
                <span>comece variando o</span>
                <span className="font-medium text-foreground">{rotuloDoAdHook(l.sug_ad, l.sug_hook)}</span>
                {l.sug_total > 1 && (
                  <span className="text-muted-foreground/50">e outros {l.sug_total - 1} validados sem variação</span>
                )}
              </span>
            ) : l.falta_variacao ? (
              /* Só aparece onde alguém esperaria uma sugestão e não há: nenhum
                 validado deste funil recebeu verba em 30 dias, ou os que
                 receberam já têm pedido na fila abaixo. */
              <span className="text-[11px] text-muted-foreground/50">
                sem validado recente para partir — o AD terá que ser do zero
              </span>
            ) : null}
          </td>
        </tr>
      )}
    </>
  );
}

/** O zero é a informação, então ele é o único que muda de cor. */
function Num({ n }: { n: number }) {
  return (
    <td className={cn('px-1 py-0.5 text-right text-xs tabular-nums',
      n === 0 ? 'font-medium text-red-400' : 'text-muted-foreground')}>
      {n}
    </td>
  );
}
