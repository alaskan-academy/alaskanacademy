import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { sanitizarHtml } from '@/lib/sanitizar';
import { cn } from '@/lib/utils';

/**
 * Os blocos de um processo, na tela de leitura.
 *
 * Um artigo é uma lista ordenada de blocos, e a ordem é da autora: dá para
 * explicar um passo, mostrar o print dele e só então o vídeo — o que o formato
 * anterior não permitia, porque tinha o vídeo sempre no topo e as imagens
 * sempre no fim.
 */

export type TipoBloco = 'texto' | 'imagem' | 'video' | 'html' | 'checklist';

/** Uma linha do bloco de checklist: item para marcar, ou titulo de grupo. */
export interface ItemChecklist {
  texto: string;
  /** `true` separa um grupo ('Passo 1'), e nao e marcavel. */
  grupo?: boolean;
}

export interface Bloco {
  tipo: TipoBloco;
  dados: {
    html?: string;
    url?: string;
    legenda?: string;
    itens?: ItemChecklist[];
  };
}

/** Aceita o que vier do jsonb sem confiar no formato. */
export function lerBlocos(v: unknown): Bloco[] {
  if (!Array.isArray(v)) return [];
  return v.filter((b): b is Bloco =>
    !!b && typeof b === 'object' &&
    /* A LISTA VIVE AQUI E EM `semVazios`, e esquecer um dos dois e caro: sem
       este, o bloco some ao LER; sem o outro, ele e APAGADO ao salvar, em
       silencio. Ha um teste de ida-e-volta por tipo justamente por isso. */
    ['texto', 'imagem', 'video', 'html', 'checklist'].includes((b as Bloco).tipo));
}

/** Os títulos de dentro dos blocos de texto, para o sumário lateral. */
export function sumarioDosBlocos(blocos: Bloco[]): { id: string; text: string; level: number }[] {
  if (typeof window === 'undefined' || !window.DOMParser) return [];
  const doc = new DOMParser().parseFromString(
    `<body>${blocos.filter(b => b.tipo === 'texto').map(b => b.dados.html ?? '').join('')}</body>`,
    'text/html',
  );
  const vistos = new Map<string, number>();
  return Array.from(doc.querySelectorAll('h2, h3')).map(h => ({
    id: idComContador(h.textContent ?? '', vistos),
    text: h.textContent ?? '',
    level: h.tagName === 'H2' ? 2 : 3,
  }));
}

/** Mesmo id no sumário e no título, senão o clique não leva a lugar nenhum. */
export function idDoTitulo(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
}

/**
 * O id com desempate, quando o mesmo título aparece mais de uma vez.
 *
 * O id sai do TEXTO, então título repetido dava o mesmo endereço e o sumário
 * levava sempre ao primeiro. O "Checklist de Revisão de ADs" tem "Safezone" em
 * quatro passos: clicar no do Passo 5 desceria para o Passo 4, e a pessoa
 * conferiria o critério de lipsync achando que está conferindo o de imagem.
 * Errado, e sem nada na tela denunciando.
 *
 * O primeiro fica sem sufixo de propósito, para não quebrar link já existente.
 *
 * O `vistos` vem de FORA porque a contagem é do artigo inteiro: o sumário lê
 * todos os blocos juntos e o corpo é renderizado bloco a bloco. Numerando
 * separado, os dois discordariam — que é o defeito, só que invertido.
 */
export function idComContador(texto: string, vistos: Map<string, number>): string {
  const base = idDoTitulo(texto);
  const n = vistos.get(base) ?? 0;
  vistos.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

/**
 * Tira os blocos que ficaram sem nada dentro.
 *
 * Clicar em "Imagem" e desistir deixava um bloco vazio gravado — invisível na
 * leitura, mas ocupando lugar no editor toda vez que alguém voltasse.
 */
export function semVazios(blocos: Bloco[]): Bloco[] {
  return blocos.filter(b => {
    if (b.tipo === 'texto') {
      const semTags = (b.dados.html ?? '').replace(/<[^>]*>/g, '').trim();
      return semTags.length > 0;
    }
    if (b.tipo === 'html') return (b.dados.html ?? '').trim().length > 0;
    /* Sem este ramo o checklist cairia no `return b.dados.url` la embaixo — e,
       nao tendo url, seria apagado do banco no salvamento seguinte. */
    if (b.tipo === 'checklist') {
      return (b.dados.itens ?? []).some(i => (i?.texto ?? '').trim().length > 0);
    }
    return (b.dados.url ?? '').trim().length > 0;
  });
}

/** O texto puro, para contar o tempo de leitura. */
export function textoDosBlocos(blocos: Bloco[]): string {
  return blocos
    .map(b => `${b.dados.html ?? ''} ${b.dados.legenda ?? ''}`)
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function comIdsNosTitulos(html: string, vistos: Map<string, number>): string {
  if (typeof window === 'undefined' || !window.DOMParser) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('h2, h3').forEach(h => {
    h.setAttribute('id', idComContador(h.textContent ?? '', vistos));
  });
  return doc.body.innerHTML;
}

function BlocoTexto({ html }: { html: string }) {
  // Sanitizar SEMPRE, inclusive o que veio do editor rico. O editor produz HTML
  // limpo hoje; passar direto seria confiar que ele nunca vai mudar, e que o
  // valor no banco nunca foi tocado por outro caminho.
  /* O id dos titulos NAO e feito aqui: a numeracao tem de ser do artigo
     inteiro, senao um titulo repetido em DOIS blocos recebe o mesmo id e o
     sumario — que le tudo junto — aponta para o lugar errado. Quem prepara e
     `BlocosRenderer`, num passe so. */
  const limpo = useMemo(() => sanitizarHtml(html), [html]);
  return (
    <div
      className={cn(
        /*
          A hierarquia estava quase plana, e dava para medir: h2 tinha 18px e
          h3 tinha 15px contra 14.5px do corpo. A razão do h3 para o texto era
          de 1,03 — subtítulo do mesmo tamanho do parágrafo, separado só pelo
          peso. Num artigo como a Segunda Criativa, onde os cinco passos são
          h3, os passos sumiam no meio do texto e o documento virava um bloco
          só para quem bate o olho em vez de ler linha a linha.

          Agora são 21 / 17 / 14.5, ou seja 1,45 e 1,17. A cor faz o resto: o
          corpo desceu para 80% e os títulos ficaram em 100%.

          Sem cor de marca nos títulos de propósito. O azul é o que se clica e
          o vermelho é marca e prejuízo — título colorido gastaria um dos dois
          sinais para dizer algo que tamanho e peso já dizem.
        */
        'text-[14.5px] leading-7 text-foreground/80',
        '[&>h2]:text-[21px] [&>h2]:font-bold [&>h2]:tracking-tight [&>h2]:text-foreground [&>h2]:mt-12 [&>h2]:mb-4',
        '[&>h2]:pb-2.5 [&>h2]:border-b [&>h2]:border-border [&>h2]:first:mt-0 [&>h2]:scroll-mt-20',
        '[&>h3]:text-[17px] [&>h3]:font-semibold [&>h3]:text-foreground [&>h3]:mt-8 [&>h3]:mb-2.5 [&>h3]:scroll-mt-20',
        '[&>p]:my-4',
        '[&>ul]:list-disc [&>ol]:list-decimal [&>ul]:pl-6 [&>ol]:pl-6 [&>ul]:my-5 [&>ol]:my-5',
        // O marcador some no fundo escuro quando fica na cor do texto: ele
        // marca o ritmo da lista, então vale enxergar sem competir com ela.
        '[&_li]:my-2 [&_li]:pl-1 [&_li]:marker:text-foreground/35',
        '[&>blockquote]:border-l-2 [&>blockquote]:border-primary/40 [&>blockquote]:pl-4 [&>blockquote]:my-5 [&>blockquote]:text-muted-foreground',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_strong]:text-foreground [&_strong]:font-semibold',
        '[&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px]',
        '[&>hr]:border-border [&>hr]:my-7',
        '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0',
      )}
      dangerouslySetInnerHTML={{ __html: limpo }}
    />
  );
}

function BlocoHtml({ html }: { html: string }) {
  const limpo = useMemo(() => sanitizarHtml(html), [html]);
  return (
    <div
      className={cn(
        'my-6 text-[14px] text-foreground/85',
        // A tabela é o uso mais comum deste bloco, e sem rolagem própria ela
        // empurra a página inteira para o lado numa tela estreita.
        '[&_table]:w-full [&_table]:my-0 [&_table]:border-collapse',
        '[&_thead]:bg-muted/50',
        '[&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold',
        '[&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_th]:border-b [&_th]:border-border',
        '[&_td]:px-4 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-border/40',
        '[&_iframe]:w-full [&_iframe]:aspect-video [&_iframe]:rounded-xl [&_iframe]:border [&_iframe]:border-border',
        'overflow-x-auto rounded-xl border border-border',
      )}
      dangerouslySetInnerHTML={{ __html: limpo }}
    />
  );
}

function BlocoImagem({ url, legenda, onAmpliar }: {
  url: string; legenda?: string; onAmpliar?: (url: string) => void;
}) {
  const [quebrou, setQuebrou] = useState(false);
  const seguro = useMemo(() => sanitizarHtml(`<img src="${url.replace(/"/g, '&quot;')}">`), [url]);
  // Se o sanitizador recusou a URL, não há imagem para mostrar.
  if (!seguro.includes('src=') || quebrou) return null;
  return (
    <figure className="my-6">
      {/* Clicar amplia: print de processo costuma ter texto pequeno dentro, e
          era o que a grade de imagens antiga já fazia. */}
      <button
        type="button"
        onClick={() => onAmpliar?.(url)}
        className="block w-full rounded-xl overflow-hidden border border-border/60 bg-muted/30 hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title="Clique para ampliar"
      >
        <img
          src={url}
          alt={legenda || ''}
          loading="lazy"
          onError={() => setQuebrou(true)}
          className="w-full"
        />
      </button>
      {legenda && (
        <figcaption className="mt-2 text-xs text-muted-foreground text-center">{legenda}</figcaption>
      )}
    </figure>
  );
}

function BlocoVideo({ url, titulo }: { url: string; titulo: string }) {
  const seguro = useMemo(() => {
    const html = sanitizarHtml(`<iframe src="${url.replace(/"/g, '&quot;')}"></iframe>`);
    return html.includes('src=') ? url : null;
  }, [url]);
  // O `video_url` ia direto para o `src` do iframe, sem nenhuma checagem de
  // esquema -- era um dos achados da revisão. Agora passa pelo mesmo filtro.
  if (!seguro) return null;
  return (
    <div className="my-6">
      <div className="relative w-full rounded-xl overflow-hidden border border-border bg-black" style={{ paddingBottom: '56.25%' }}>
        <iframe
          src={seguro}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          title={titulo}
        />
      </div>
    </div>
  );
}

export function BlocosRenderer({ blocos, titulo, onAmpliar }: {
  blocos: Bloco[]; titulo: string; onAmpliar?: (url: string) => void;
}) {
  /*
   * Os ids dos títulos são gerados AQUI, num passe só sobre o artigo inteiro.
   *
   * Feito bloco a bloco, a contagem reiniciava a cada bloco e um título
   * repetido em dois blocos diferentes recebia o mesmo id — enquanto o sumário,
   * que lê tudo junto, numerava direito. Os dois discordariam, e o clique
   * levaria ao lugar errado.
   */
  const htmlPorBloco = useMemo(() => {
    const vistos = new Map<string, number>();
    return blocos.map(b =>
      b.tipo === 'texto' ? comIdsNosTitulos(sanitizarHtml(b.dados.html ?? ''), vistos) : '');
  }, [blocos]);

  /*
   * Link de um processo para outro é navegação do router, não recarga.
   *
   * O HTML dos blocos é string: um `<a href="/processos/...">` dentro dele é
   * âncora de verdade, e o navegador recarrega a aplicação inteira no clique.
   * Numa SPA com rota em `lazy()` isso custa o bundle de novo, e justo no
   * lugar onde mais se clica: o SOP de Edição é um hub com quatro módulos que
   * apontam entre si, e a matriz de navegação existe para ser usada.
   *
   * Não dá para trocar por `<Link>` porque o conteúdo não é JSX, é texto que
   * alguém escreveu no editor. Então o clique é interceptado aqui, uma vez,
   * para todos os blocos.
   *
   * O que NÃO é interceptado, de propósito:
   *
   * - clique com ctrl, cmd, shift ou alt, e clique que não é do botão
   *   esquerdo: a pessoa está pedindo outra aba, e tirar isso dela seria
   *   quebrar um gesto que todo navegador tem;
   * - link externo, que o sanitizador já marcou com `target="_blank"`;
   * - clique que alguém já tratou (`defaultPrevented`), como o do lightbox.
   */
  const navigate = useNavigate();
  const aoClicarNoLink = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const alvo = (e.target as HTMLElement | null)?.closest?.('a');
    if (!alvo || alvo.getAttribute('target')) return;

    const href = alvo.getAttribute('href');
    // Só caminho interno. `//outro.site` é externo apesar da barra inicial.
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;

    e.preventDefault();
    navigate(href);
  };

  return (
    <div onClick={aoClicarNoLink}>
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case 'texto':  return <BlocoTexto  key={i} html={htmlPorBloco[i]} />;
          case 'html':   return <BlocoHtml   key={i} html={b.dados.html ?? ''} />;
          case 'imagem': return <BlocoImagem key={i} url={b.dados.url ?? ''} legenda={b.dados.legenda} onAmpliar={onAmpliar} />;
          case 'video':  return <BlocoVideo  key={i} url={b.dados.url ?? ''} titulo={titulo} />;
          case 'checklist': return <BlocoChecklist key={i} itens={b.dados.itens ?? []} chave={`${titulo}#${i}`} />;
          default:       return null;
        }
      })}
    </div>
  );
}

/**
 * O checklist marcável, no fim de um processo.
 *
 * ── O que a marcação é, e o que ela NÃO é ──────────────────────────────────
 *
 * É um rascunho pessoal: fica no navegador de quem marcou, não sai dali e não
 * registra nada. Serve para não perder o lugar no meio de 43 itens com o vídeo
 * aberto do lado — que é exatamente o pedido.
 *
 * A tela diz isso em voz alta em vez de deixar a pessoa supor que alguém do
 * outro lado está vendo. Um checklist que parece registrar e não registra é
 * pior do que um que assume ser rascunho: o primeiro dá uma garantia falsa
 * sobre trabalho conferido.
 *
 * ── Por que não dá para escrever isso como texto ───────────────────────────
 *
 * O editor tem um botão de checklist (Tiptap TaskList), mas `sanitizarHtml`
 * não permite `input` nem `label`, e não tem entrada para `ul`/`li` — então
 * `data-type` e `data-checked` são removidos junto. Medido em 28/09/2026:
 *
 *   gravado:  <ul data-type="taskList"><li data-checked="false"><label><input…
 *   publicado: <ul><li><span></span><div>…
 *
 * Você veria as caixinhas ao editar e a equipe receberia bolinhas. Por isso o
 * checklist é um TIPO DE BLOCO, com dado próprio, e não HTML.
 */
function BlocoChecklist({ itens, chave }: { itens: ItemChecklist[]; chave: string }) {
  const armazem = `checklist:${chave}`;

  const [marcados, setMarcados] = useState<Set<string>>(() => {
    /* localStorage falha em aba anônima e com cookies bloqueados. A lista tem
       de aparecer de qualquer jeito — marcação é conforto, não requisito. */
    try {
      const cru = window.localStorage.getItem(armazem);
      return new Set(cru ? (JSON.parse(cru) as string[]) : []);
    } catch { return new Set(); }
  });

  /*
   * A chave leva a POSICAO, e nao so o texto.
   *
   * Os rotulos se repetem entre passos de proposito: 'Estilo' esta no Passo 1
   * (Legendas) e no Passo 3 (Headline); 'Safezone' esta no 4 e no 5. Guardando
   * so pelo texto, marcar um marcaria o outro — e a pessoa veria um item
   * conferido que ela nunca olhou, num checklist cujo trabalho e justamente
   * dizer o que ja foi olhado.
   *
   * O texto entra junto de proposito: reescrever um item limpa a marca dele,
   * que e o certo — item diferente, conferencia diferente.
   */
  const chaveDoItem = (i: number, texto: string) => `${i}:${texto}`;
  const marcaveis = useMemo(
    () => itens.map((item, i) => ({ item, i })).filter(({ item }) => !item.grupo && item.texto.trim()),
    [itens],
  );

  const alternar = (id: string) => {
    setMarcados(prev => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
      try { window.localStorage.setItem(armazem, JSON.stringify([...proximo])); } catch { /* sem espaço ou sem permissão: a marcação vale só para esta sessão */ }
      return proximo;
    });
  };

  const limpar = () => {
    setMarcados(new Set());
    try { window.localStorage.removeItem(armazem); } catch { /* idem */ }
  };

  const feitos = marcaveis.filter(({ item, i }) => marcados.has(chaveDoItem(i, item.texto))).length;

  if (marcaveis.length === 0) return null;

  return (
    <div className="my-6 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <p className="text-sm font-medium">{feitos} de {marcaveis.length}</p>
          <p className="text-[11px] text-muted-foreground">
            Marcação pessoal, só neste navegador. Não registra a revisão em lugar nenhum.
          </p>
        </div>
        {feitos > 0 && (
          <button
            type="button"
            onClick={limpar}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
          >
            Limpar
          </button>
        )}
      </div>

      <ul className="divide-y divide-border">
        {itens.map((item, i) => {
          if (item.grupo) {
            return (
              <li
                key={i}
                className="px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground bg-secondary/30"
              >
                {item.texto}
              </li>
            );
          }
          const id = chaveDoItem(i, item.texto);
          const feito = marcados.has(id);
          return (
            <li key={i}>
              {/* Botão, e não div com onClick: assim o Tab chega, o Enter e o
                  espaço funcionam, e o leitor de tela anuncia o estado. */}
              <button
                type="button"
                role="checkbox"
                aria-checked={feito}
                onClick={() => alternar(id)}
                className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center text-[10px] leading-none',
                    feito
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/40',
                  )}
                >
                  {feito ? '✓' : ''}
                </span>
                <span className={cn('text-sm', feito && 'line-through text-muted-foreground')}>
                  {item.texto}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
