import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Defasagem } from './tipos';

/**
 * O que escrever, por projeto e por funil.
 *
 * Duas versões anteriores erraram o alvo pelo mesmo motivo: diagnosticavam em
 * vez de mandar fazer. "falta iteração e novo" é uma lista do que não existe, e
 * quem lê ainda precisa traduzir para trabalho. Cada linha é uma ordem de
 * serviço com quantidade — "escreva 1 iteração e 1 novo".
 *
 * Nenhum valor em dinheiro aparece. A lista É ordenada por investimento — quem
 * mais gasta cobra primeiro — mas o número não vai para a tela.
 *
 * TRÊS COISAS SAÍRAM DA FRENTE, PORQUE ERAM PROVA E NÃO ORDEM
 *
 * 1. O quadro inteiro era tingido de âmbar, com borda âmbar e fundo âmbar. Uma
 *    superfície grande tingida diz "tudo aqui dentro é alerta" — inclusive as
 *    linhas em dia. O âmbar ficou só no ícone e na frase de cada linha, que é
 *    onde ele significa alguma coisa.
 *
 * 2. As três colunas de contagem (Novo · Iter. · Var.) eram a coisa mais
 *    barulhenta da tela: seis zeros vermelhos competindo com a ordem de serviço
 *    que fica ao lado. Elas são a PROVA da conta, não a conta — foram para trás
 *    de "ver as contas".
 *
 * 3. As linhas em dia ocupavam uma linha inteira cada para dizer que não há o
 *    que fazer. Viraram uma frase no rodapé. Continuam visíveis, que é a regra
 *    que ela pediu: ausência não diz "está ok", diz "não sei".
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
  const [verContas, setVerContas] = useState(false);
  const [verRessalvas, setVerRessalvas] = useState(false);

  /*
    Só o que pede trabalho entra na tabela.

    Todos os funis continuam na tela — o que está em dia vai para o rodapé, numa
    frase. Antes cada um gastava uma linha da tabela para dizer que não havia o
    que fazer, e com seis funis metade da lista era ruído.
  */
  const foraDoAlvo = useMemo(() => linhas.filter(l => l.prioridade < 5), [linhas]);
  const emDia      = useMemo(() => linhas.filter(l => l.prioridade === 5), [linhas]);

  /*
    Um projeto vira um bloco, com uma linha por funil: quem roda TSL e VSL
    aparecia duas vezes seguidas e lia como duplicata.
  */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Defasagem[]>();
    for (const l of foraDoAlvo) {
      const k = l.projeto ?? '—';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k)!.push(l);
    }
    return Array.from(mapa, ([projeto, funis]) => ({ projeto, funis }));
  }, [foraDoAlvo]);

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

  const tudoOk = foraDoAlvo.length === 0;

  /*
    As duas ressalvas viraram uma linha dobrada no pé do quadro.

    Elas eram dois cartões de largura inteira entre o que escrever e a fila de
    pedidos — o terceiro e o quarto blocos da página, ocupando o lugar mais
    nobre da tela para dizer um rodapé de contabilidade. São verdadeiras e
    precisam existir; só não são o assunto.

    Dobrar em vez de fechar, e nada de `localStorage`: um "não me avise mais"
    faria metade dos ADs sumirem da conta em silêncio, que é exatamente o
    defeito que escondeu 4 REVs por um `ativo=false`.
  */
  const ressalvas: React.ReactNode[] = [];
  if (semFunil.length > 0) {
    ressalvas.push(
      <>
        <span className="text-foreground">
          {semFunil.reduce((s, l) => s + l.lotes_sem_funil, 0)} ADs sem funil informado
        </span>
        {' '}ficam fora das contas —{' '}
        {semFunil.map(l => `${l.projeto} (${l.lotes_sem_funil})`).join(' · ')}.
        {' '}Preencher o campo Funil na Produção faz eles contarem.
      </>,
    );
  }
  if (semVerba.length > 0) {
    ressalvas.push(
      <>
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
      </>,
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3.5 py-3">
        {tudoOk
          ? <Check className="h-4 w-4 shrink-0 text-emerald-400" />
          : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />}
        <span className="text-sm font-semibold text-foreground">
          {tudoOk ? 'Todos os funis em dia' : 'O que escrever agora'}
        </span>
        {!tudoOk && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            {foraDoAlvo.length} de {linhas.length} funis
          </span>
        )}
        {!tudoOk && (
          <span className="text-[11px] text-muted-foreground">
            do que mais gasta para o que menos gasta
          </span>
        )}

        {!tudoOk && (
          <button
            type="button"
            onClick={() => setVerContas(v => !v)}
            className="ml-auto shrink-0 text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {verContas ? 'esconder as contas' : 'ver as contas'}
          </button>
        )}
      </div>

      {!tudoOk && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            {/*
              O cabeçalho só existe quando há coluna de número para nomear.
              Sem as contagens, "Projeto · Funil · O que escrever" é óbvio pelo
              conteúdo, e três títulos em maiúscula sobre três colunas seriam
              mais uma fileira de texto de 10px numa tela que já tem demais.
            */}
            {verContas && (
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
            )}
            <tbody>
              {grupos.map(g => g.funis.map((l, i) => (
                <LinhaDoFunil key={`${g.projeto}-${l.funil}`} l={l}
                              projeto={i === 0 ? g.projeto : null}
                              linhasDoProjeto={g.funis.length}
                              primeiraDoGrupo={i === 0}
                              verContas={verContas} />
              )))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        O que está em dia continua na tela, como ela pediu — mas numa frase, não
        numa linha de tabela por funil.
      */}
      {emDia.length > 0 && !tudoOk && (
        <p className="border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
          <Check className="mr-1 inline h-3 w-3 -translate-y-px text-emerald-400" />
          Em dia: {emDia.map(l => `${l.projeto} ${l.funil}`).join(' · ')}
        </p>
      )}

      {ressalvas.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setVerRessalvas(v => !v)}
            className="flex w-full items-center gap-1.5 px-3.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            {ressalvas.length === 1 ? '1 ressalva nas contas' : `${ressalvas.length} ressalvas nas contas`}
            <ChevronDown className={cn('h-3 w-3 transition-transform', verRessalvas && 'rotate-180')} />
          </button>
          {verRessalvas && (
            <div className="space-y-1.5 border-t border-border/60 px-3.5 py-2.5">
              {ressalvas.map((r, i) => (
                <p key={i} className="text-[11px] leading-relaxed text-muted-foreground">{r}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "a, b e c" — `join(' e ')` produzia "a e b e c". */
function emLista(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

function LinhaDoFunil({ l, projeto, linhasDoProjeto, primeiraDoGrupo, verContas }: {
  l: Defasagem; projeto: string | null; linhasDoProjeto: number;
  primeiraDoGrupo: boolean; verContas: boolean;
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

  const critico = total === 0;

  const ordem = pedidos.length > 0
    ? `Escreva ${emLista(pedidos)}`
    : paraOMix > 0
      ? `Escreva mais ${paraOMix} de iteração ou variação`
      : 'Em dia';

  return (
    <tr className={cn(primeiraDoGrupo && 'border-t border-border/60')}>
      {/* O nome do projeto ocupa as linhas dos seus funis: repetido em cada uma
          fazia dois funis do mesmo projeto lerem como duplicata. */}
      {projeto !== null && (
        <td rowSpan={linhasDoProjeto}
            className="whitespace-nowrap px-3.5 py-2 align-top text-xs font-medium text-foreground">
          {projeto}
        </td>
      )}

      <td className="px-2 py-2">
        <span className="rounded bg-secondary px-1.5 py-px text-[10px] font-medium tracking-wide text-foreground">
          {l.funil}
        </span>
      </td>

      {/* O zero é a informação, então é o único número que muda de cor — e só
          aparece em modo prova. */}
      {verContas && <Num n={l.ads_novo} />}
      {verContas && <Num n={l.ads_iteracao} />}
      {verContas && <Num n={l.ads_variacao} />}

      {/* `w-full` na coluna da ordem: sem o `thead` visível não há nada dizendo
          qual coluna absorve a largura sobrando, e a folga ia parar entre o
          projeto e o funil, abrindo um vão no meio da frase. */}
      <td className="w-full px-3 py-2">
        <span className={cn('flex items-baseline gap-1 text-xs font-medium',
          critico ? 'text-red-300' : 'text-amber-200')}>
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
    <td className={cn('px-1 py-2 text-right text-xs tabular-nums',
      n === 0 ? 'font-medium text-red-400' : 'text-muted-foreground')}>
      {n}
    </td>
  );
}
