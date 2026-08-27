import { AlertTriangle, ArrowRight, CircleSlash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Defasagem, rotuloDoAdHook } from './tipos';

/**
 * O que falta, por projeto — e qual validado variar.
 *
 * Um aviso que só aponta o buraco vira ruído: foi o que aconteceu com os nove
 * anúncios órfãos em Criativos Meta, onde "nenhum card com este nome" calou por
 * meses um card que estava a um caractere de distância. Então aqui, quando
 * falta variação, a linha diz de qual AD validado ela sai.
 *
 * `compacto` é a versão que fica no topo da área inteira de Copywriters: só as
 * linhas urgentes, sem os números de estoque. A completa mora na aba Esteira.
 */
export function AlertaDefasagem({ linhas, compacto = false, onVerTudo }: {
  linhas: Defasagem[];
  compacto?: boolean;
  onVerTudo?: () => void;
}) {
  const urgentes = linhas.filter(l => l.prioridade < 2);
  if (urgentes.length === 0) {
    return compacto ? null : (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300/90">
        Todos os projetos ativos têm pelo menos um AD novo e uma variação em estoque.
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border', compacto
      ? 'border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5'
      : 'border-amber-500/30 bg-amber-500/10 p-3.5')}>
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-xs font-medium text-amber-200">
          {urgentes.length === 1
            ? '1 projeto sem o par completo'
            : `${urgentes.length} projetos sem o par completo`}
        </span>
        {compacto && onVerTudo && (
          <button onClick={onVerTudo}
                  className="ml-auto text-[11px] text-amber-300/80 underline-offset-2 hover:underline">
            ver a esteira
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {urgentes.map(l => <Linha key={l.projeto_id} l={l} compacto={compacto} />)}
      </div>
    </div>
  );
}

function Linha({ l, compacto }: { l: Defasagem; compacto: boolean }) {
  const vazio = l.falta_novo && l.falta_variacao;
  const faltas = [l.falta_novo && 'novo', l.falta_variacao && 'variação'].filter(Boolean);

  /*
    Bloco por projeto — ícone numa coluna, conteúdo na outra — e não uma linha
    corrida em `flex-wrap`: assim a sugestão quebrava para a linha seguinte e
    passava a ler como se fosse do PRÓXIMO projeto da lista. Aqui ela é uma
    linha própria, alinhada sob o nome de quem ela pertence.
  */
  return (
    <div className="flex gap-1.5 text-xs">
      <span className="w-3 shrink-0 pt-0.5">
        {vazio && <CircleSlash className="h-3 w-3 text-red-400/80" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{l.projeto ?? '—'}</span>

          {l.funis_projeto && (
            <span className="rounded bg-secondary px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
              {l.funis_projeto}
            </span>
          )}

          <span className={cn('text-[11px]', vazio ? 'text-red-300/90' : 'text-amber-200/90')}>
            {vazio ? 'nenhum criativo em produção' : `falta ${faltas.join(' e ')}`}
          </span>
        </div>

        {/*
          A sugestão só existe para o lado da variação: um AD novo não tem "de
          qual partir", ele é o ponto de partida. E só aparece na versão
          completa — no topo da página a linha precisa caber numa linha.
        */}
        {!compacto && l.falta_variacao && l.sug_ad != null && (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-[11px] text-muted-foreground">
            <ArrowRight className="h-3 w-3 shrink-0 translate-y-0.5" />
            <span>varie o</span>
            <span className="font-medium text-foreground">{rotuloDoAdHook(l.sug_ad, l.sug_hook)}</span>
            {l.sug_funil && <span className="text-muted-foreground/70">({l.sug_funil})</span>}
            {l.sug_validado_em && (
              <span className="text-muted-foreground/70">
                validado em {new Date(l.sug_validado_em + 'T12:00:00').toLocaleDateString('pt-BR')}
              </span>
            )}
            {l.sug_total > 1 && (
              <span className="text-muted-foreground/50">· +{l.sug_total - 1} sem variação</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
