import { AlertTriangle, ArrowRight, CircleSlash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { Defasagem, rotuloDoAdHook } from './tipos';

/**
 * O que falta, por projeto — e qual validado variar.
 *
 * Um aviso que só aponta o buraco vira ruído: foi o que aconteceu com os nove
 * anúncios órfãos em Criativos Meta, onde "nenhum card com este nome" calou por
 * meses um card que estava a um caractere de distância. Então aqui, quando
 * falta variação, a linha diz de qual AD validado ela sai — e quanto esse AD
 * recebeu de verba nos últimos 30 dias, que é o que decide se vale variar.
 *
 * Só projetos com investimento nos últimos 7 dias entram (o filtro está na
 * `fn_esteira_defasagem`). Projeto sem verba não tem defasagem de criativo.
 */
export function AlertaDefasagem({ linhas }: { linhas: Defasagem[] }) {
  const urgentes = linhas.filter(l => l.prioridade < 5);

  if (linhas.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground">
        Nenhum projeto ativo recebeu investimento nos últimos 7 dias.
      </div>
    );
  }

  if (urgentes.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300/90">
        Os {linhas.length} projetos com verba têm novo, iteração e variação em estoque, e o mix está na meta.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-xs font-medium text-amber-200">
          {urgentes.length === 1
            ? '1 projeto com verba fora do alvo'
            : `${urgentes.length} projetos com verba fora do alvo`}
        </span>
        <span className="text-[10px] text-muted-foreground/70">
          em ordem de prioridade · iteração vem antes de novo
        </span>
      </div>

      <div className="space-y-2">
        {urgentes.map(l => <Linha key={l.projeto_id} l={l} />)}
      </div>
    </div>
  );
}

function Linha({ l }: { l: Defasagem }) {
  const vazio = l.prioridade === 0;

  /*
    A ordem das faltas na frase segue a mesma escada da prioridade: iteração,
    variação, novo. Quem lê rápido lê a primeira.
  */
  const faltas = [
    l.falta_iteracao && 'iteração',
    l.falta_variacao && 'variação',
    l.falta_novo && 'novo',
  ].filter(Boolean) as string[];

  return (
    <div className="flex gap-1.5 text-xs">
      <span className="w-3 shrink-0 pt-0.5">
        {vazio && <CircleSlash className="h-3 w-3 text-red-400/80" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{l.projeto ?? '—'}</span>

          {/* O quanto de verba está em jogo — é o que ordena a lista. */}
          {l.inv_7d != null && (
            <span className="tabular-nums text-[10px] text-muted-foreground/70">
              {formatCurrency(l.inv_7d)} / 7d
            </span>
          )}

          {l.funis_projeto && (
            <span className="rounded bg-secondary px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
              {l.funis_projeto}
            </span>
          )}

          {faltas.length > 0 && (
            <span className={cn('text-[11px]', vazio ? 'text-red-300/90' : 'text-amber-200/90')}>
              {vazio ? 'nenhum criativo em produção' : `falta ${faltas.join(' e ')}`}
            </span>
          )}

          {/*
            O mix é uma falta de outro tipo: o projeto TEM os três, mas está
            fazendo novo demais. Só aparece quando não há falta gritante — duas
            reclamações na mesma linha viram nenhuma, e quem não tem variação
            nenhuma já sabe que o mix está torto.
          */}
          {faltas.length === 0 && l.mix_estourado && (
            <span className="text-[11px] text-amber-200/90">
              {l.pct_novo}% do estoque é novo — a meta é {l.pct_novo_meta}%
            </span>
          )}
        </div>

        {/*
          A sugestão só existe para o lado da variação: um AD novo não tem "de
          qual partir", ele é o ponto de partida.

          Também aparece com o mix estourado, e não só quando falta variação:
          "novo demais" quer dizer "faça mais do outro lado", e a Saponaria é o
          caso — tem os três em estoque, está 22 pontos acima da meta, e tem um
          validado com R$ 6.659 esperando variação. Sem isto a linha cobraria o
          mix sem dizer por onde começar.
        */}
        {(l.falta_variacao || l.mix_estourado) && (
          l.sug_ad != null ? (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[11px] text-muted-foreground">
              <ArrowRight className="h-3 w-3 shrink-0 translate-y-0.5" />
              <span>varie o</span>
              <span className="font-medium text-foreground">{rotuloDoAdHook(l.sug_ad, l.sug_hook)}</span>
              {l.sug_funil && <span className="text-muted-foreground/70">({l.sug_funil})</span>}
              {l.sug_investido != null && (
                <span className="font-medium text-emerald-400/90">
                  {formatCurrency(l.sug_investido)} em 30d
                </span>
              )}
              {l.sug_total > 1 && (
                <span className="text-muted-foreground/50">· +{l.sug_total - 1} sem variação</span>
              )}
            </div>
          ) : (
            /*
              Sem sugestão é informação, não buraco — e são dois motivos: ou
              nenhum validado deste projeto recebeu verba em 30 dias (o caso do
              Desafios, onde a tela sugeria variar um AD de maio de 2025 sem um
              centavo há mais de um mês), ou todos os que receberam já têm
              pedido humano na fila logo abaixo. A frase serve para os dois.
            */
            <div className="mt-0.5 flex items-baseline gap-1 pl-4 text-[11px] text-muted-foreground/60">
              nenhum validado com verba recente esperando variação
            </div>
          )
        )}
      </div>
    </div>
  );
}
