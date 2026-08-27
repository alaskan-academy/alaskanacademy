import { useMemo, useState } from 'react';
import { AlertTriangle, Check, HelpCircle, MinusCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Defasagem } from './tipos';

/**
 * O que escrever, por projeto e por funil.
 *
 * Duas versões anteriores erraram o alvo pelo mesmo motivo: diagnosticavam em
 * vez de mandar fazer. "falta iteração e novo" é uma lista do que não existe, e
 * quem lê ainda precisa traduzir para trabalho. Agora cada linha é uma ordem de
 * serviço com quantidade — "escreva 1 iteração e 1 novo" — e as contagens ficam
 * ao lado como prova, não como a mensagem.
 *
 * Nenhum valor em dinheiro aparece. A lista É ordenada por investimento — quem
 * mais gasta cobra primeiro — mas o número não vai para a tela.
 *
 * A coluna "A partir de", que sugeria qual validado variar, saiu a pedido dela.
 * A função ainda calcula a sugestão (`sug_ad` e companhia continuam vindo da
 * `fn_esteira_defasagem`) — só não é mostrada aqui.
 */
export function AlertaDefasagem({ linhas, semVerba = [] }: {
  linhas: Defasagem[];
  /** Projetos ativos que não entraram na conta por não terem gasto em 7 dias. */
  semVerba?: { projeto: string; ads: number }[];
}) {
  const urgentes = useMemo(() => linhas.filter(l => l.prioridade < 5), [linhas]);

  /*
    TODOS os funis aparecem, inclusive os que estão em dia.

    Antes só os problemáticos entravam, e o Saponaria VSL sumia da tela — sem
    dar para saber se estava bem ou se tinha sido esquecido. Ausência não diz
    "está ok", diz "não sei"; e um painel que só mostra o que está ruim obriga
    a lembrar de cor o que deveria estar lá.

    Um projeto vira um bloco, com uma linha por funil: quem roda TSL e VSL
    aparecia duas vezes seguidas e lia como duplicata.
  */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Defasagem[]>();
    for (const l of linhas) {
      const k = l.projeto ?? '—';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k)!.push(l);
    }
    return Array.from(mapa, ([projeto, funis]) => ({ projeto, funis }));
  }, [linhas]);

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

  const tudoOk = urgentes.length === 0;

  return (
    <div className="space-y-2">
      <div className={cn('overflow-hidden rounded-lg border',
        tudoOk ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
               : 'border-amber-500/30 bg-amber-500/[0.07]')}>
        <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-3.5 py-2.5',
          tudoOk ? 'border-emerald-500/20' : 'border-amber-500/20')}>
          {tudoOk
            ? <Check className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-emerald-400" />
            : <AlertTriangle className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-amber-400" />}
          <span className={cn('text-xs font-medium', tudoOk ? 'text-emerald-200' : 'text-amber-200')}>
            {tudoOk ? 'Todos os funis em dia' : 'O que escrever agora'}
          </span>
          <span className="text-[10px] text-muted-foreground/70">
            {urgentes.length > 0 && `${urgentes.length} de ${linhas.length} funis com verba fora do alvo · `}
            do que mais gasta para o que menos gasta
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/50">
                <th className="whitespace-nowrap px-3.5 py-1 text-left font-medium">Projeto</th>
                <th className="px-2 py-1 text-left font-medium">Funil</th>
                <th className="w-11 px-1 py-1 text-right font-medium">Novo</th>
                <th className="w-11 px-1 py-1 text-right font-medium">Iter.</th>
                <th className="w-11 px-1 py-1 text-right font-medium">Var.</th>
                <th className="w-full px-3 py-1 text-left font-medium">O que escrever</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(g => g.funis.map((l, i) => (
                <LinhaDoFunil key={`${g.projeto}-${l.funil}`} l={l}
                              projeto={i === 0 ? g.projeto : null}
                              linhasDoProjeto={g.funis.length}
                              primeiraDoGrupo={i === 0} />
              )))}
            </tbody>
          </table>
        </div>
      </div>

      {/*
        Um lote sem funil não entra na conta de TSL nem de VSL, porque ninguém
        sabe qual ele serve — chutar produziria um estoque que não existe. São
        metade dos lotes hoje, então este aviso não é detalhe: é o que impede os
        números acima de parecerem piores do que são.
      */}
      {semFunil.length > 0 && (
        <AvisoFechavel icone={HelpCircle}>
          <span className="text-foreground">
            {semFunil.reduce((s, l) => s + l.lotes_sem_funil, 0)} ADs sem funil informado
          </span>
          {' '}ficam fora das contas acima —{' '}
          {semFunil.map(l => `${l.projeto} (${l.lotes_sem_funil})`).join(' · ')}.
          {' '}Preencher o campo Funil na Produção faz eles contarem.
        </AvisoFechavel>
      )}

      {/*
        Os projetos ativos que NÃO entraram, e por quê.

        O Guia dos Comportamentos sumia da tela por não ter verba, e ela
        perguntou "cadê o Guia dos Comportamentos?" — que é a mesma coisa que
        tinha acontecido com o Saponaria VSL. Sumir sem explicação faz o painel
        parecer quebrado; dizer o motivo transforma a ausência em informação.
      */}
      {semVerba.length > 0 && (
        <AvisoFechavel icone={MinusCircle}>
          Fora da conta por não ter investimento nos últimos 7 dias:{' '}
          {semVerba.map((p, i) => (
            <span key={p.projeto}>
              {i > 0 && ' · '}
              <span className="text-foreground">{p.projeto}</span>
              {p.ads > 0 && (
                <span className="text-muted-foreground/70">
                  {' '}({p.ads} {p.ads === 1 ? 'AD parado' : 'ADs parados'} na esteira)
                </span>
              )}
            </span>
          ))}
          . Sem verba não há defasagem de criativo — é outra conversa.
        </AvisoFechavel>
      )}
    </div>
  );
}

/**
 * Um aviso que dá para fechar, e que volta ao recarregar.
 *
 * O estado é local de propósito — nada de `localStorage`. Estes dois avisos
 * dizem que metade dos ADs não entra na conta e que um projeto ativo está sem
 * verba: se o "fechar" fosse permanente, alguém fecharia uma vez e o problema
 * sumiria da tela para sempre, exatamente como aconteceu com os 4 REVs
 * escondidos por um `ativo=false`. Fechar aqui é "vi, sai da frente agora", não
 * "não me avise mais".
 */
function AvisoFechavel({ icone: Icone, children }: {
  icone: typeof HelpCircle;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(true);
  if (!aberto) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card py-2.5 pl-3.5 pr-2">
      <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      <div className="flex-1 text-[11px] leading-relaxed text-muted-foreground">
        {children}
      </div>
      <button onClick={() => setAberto(false)}
              aria-label="Fechar aviso"
              className="-mt-0.5 shrink-0 rounded p-1 text-muted-foreground/40 transition-colors hover:bg-secondary hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/** "a, b e c" — `join(' e ')` produzia "a e b e c". */
function emLista(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

function LinhaDoFunil({ l, projeto, linhasDoProjeto, primeiraDoGrupo }: {
  l: Defasagem; projeto: string | null; linhasDoProjeto: number; primeiraDoGrupo: boolean;
}) {
  const total = l.ads_novo + l.ads_iteracao + l.ads_variacao;

  /*
    Quantos ADs de iteração ou variação faltam para o "novo" caber na meta.
    Com 1 novo e meta de 20%, o funil precisa de 5 ADs no total — então com 3
    faltam 2. Sem essa conta a linha dizia "menos novo", que é impossível: não
    dá para desfazer um AD já escrito, só para escrever mais do outro lado.
  */
  const paraOMix = l.pct_novo_meta > 0
    ? Math.max(0, Math.ceil(l.ads_novo / (l.pct_novo_meta / 100)) - total)
    : 0;

  /*
    A ordem de serviço, em imperativo e com quantidade. A escada segue a
    prioridade: iteração, variação, novo — iteração antes de novo, e novo por
    último porque é só 20% do alvo.
  */
  const pedidos: string[] = [];
  if (l.falta_iteracao) pedidos.push('1 iteração');
  if (l.falta_variacao) pedidos.push('1 variação');
  if (l.falta_novo)     pedidos.push('1 novo');

  const emDia = l.prioridade === 5;
  const critico = total === 0;

  const ordem = emDia
    ? 'Em dia'
    : pedidos.length > 0
      ? `Escreva ${emLista(pedidos)}`
      : paraOMix > 0
        ? `Escreva mais ${paraOMix} de iteração ou variação`
        : 'Em dia';

  return (
    <tr className={cn(primeiraDoGrupo && 'border-t border-amber-500/15',
      emDia && 'text-muted-foreground')}>
      {/* O nome do projeto ocupa as linhas dos seus funis: repetido em cada uma
          fazia dois funis do mesmo projeto lerem como duplicata. */}
      {projeto !== null && (
        <td rowSpan={linhasDoProjeto}
            className="whitespace-nowrap px-3.5 py-1.5 align-top text-xs font-medium text-foreground">
          {projeto}
        </td>
      )}

      <td className="px-2 py-1.5">
        <span className="rounded bg-secondary px-1.5 py-px text-[10px] font-medium tracking-wide text-foreground">
          {l.funil}
        </span>
      </td>

      {/* O zero é a informação, então é o único número que muda de cor. */}
      <Num n={l.ads_novo} />
      <Num n={l.ads_iteracao} />
      <Num n={l.ads_variacao} />

      <td className="px-3 py-1.5">
        <span className={cn('flex items-baseline gap-1 text-xs font-medium',
          emDia ? 'text-emerald-400/90' : critico ? 'text-red-300' : 'text-amber-200')}>
          {emDia && <Check className="h-3 w-3 shrink-0 translate-y-0.5" />}
          {ordem}
        </span>
        {/* O porquê da ordem do mix, que não cabe no imperativo */}
        {pedidos.length === 0 && paraOMix > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            novo em {l.pct_novo}%, a meta é {l.pct_novo_meta}%
          </span>
        )}
      </td>

    </tr>
  );
}

function Num({ n }: { n: number }) {
  return (
    <td className={cn('px-1 py-1.5 text-right text-xs tabular-nums',
      n === 0 ? 'font-medium text-red-400' : 'text-muted-foreground')}>
      {n}
    </td>
  );
}
