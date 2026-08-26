import { useMemo, useState } from 'react';
import { sanitizarHtml } from '../sanitizar';
import { cn } from '@/lib/utils';

/**
 * Os blocos de um processo, na tela de leitura.
 *
 * Um artigo é uma lista ordenada de blocos, e a ordem é da autora: dá para
 * explicar um passo, mostrar o print dele e só então o vídeo — o que o formato
 * anterior não permitia, porque tinha o vídeo sempre no topo e as imagens
 * sempre no fim.
 */

export type TipoBloco = 'texto' | 'imagem' | 'video' | 'html';

export interface Bloco {
  tipo: TipoBloco;
  dados: {
    html?: string;
    url?: string;
    legenda?: string;
  };
}

/** Aceita o que vier do jsonb sem confiar no formato. */
export function lerBlocos(v: unknown): Bloco[] {
  if (!Array.isArray(v)) return [];
  return v.filter((b): b is Bloco =>
    !!b && typeof b === 'object' &&
    ['texto', 'imagem', 'video', 'html'].includes((b as Bloco).tipo));
}

/** Os títulos de dentro dos blocos de texto, para o sumário lateral. */
export function sumarioDosBlocos(blocos: Bloco[]): { id: string; text: string; level: number }[] {
  if (typeof window === 'undefined' || !window.DOMParser) return [];
  const doc = new DOMParser().parseFromString(
    `<body>${blocos.filter(b => b.tipo === 'texto').map(b => b.dados.html ?? '').join('')}</body>`,
    'text/html',
  );
  return Array.from(doc.querySelectorAll('h2, h3')).map(h => ({
    id: idDoTitulo(h.textContent ?? ''),
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

function comIdsNosTitulos(html: string): string {
  if (typeof window === 'undefined' || !window.DOMParser) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('h2, h3').forEach(h => {
    h.setAttribute('id', idDoTitulo(h.textContent ?? ''));
  });
  return doc.body.innerHTML;
}

function BlocoTexto({ html }: { html: string }) {
  // Sanitizar SEMPRE, inclusive o que veio do editor rico. O editor produz HTML
  // limpo hoje; passar direto seria confiar que ele nunca vai mudar, e que o
  // valor no banco nunca foi tocado por outro caminho.
  const limpo = useMemo(() => comIdsNosTitulos(sanitizarHtml(html)), [html]);
  return (
    <div
      className={cn(
        'text-[14.5px] leading-7 text-foreground/85',
        '[&>h2]:text-[18px] [&>h2]:font-bold [&>h2]:text-foreground [&>h2]:mt-10 [&>h2]:mb-3',
        '[&>h2]:pb-2.5 [&>h2]:border-b [&>h2]:border-border/50 [&>h2]:first:mt-0 [&>h2]:scroll-mt-6',
        '[&>h3]:text-[15px] [&>h3]:font-semibold [&>h3]:text-foreground [&>h3]:mt-7 [&>h3]:mb-2 [&>h3]:scroll-mt-6',
        '[&>p]:my-4',
        '[&>ul]:list-disc [&>ol]:list-decimal [&>ul]:pl-6 [&>ol]:pl-6 [&>ul]:my-5 [&>ol]:my-5',
        '[&_li]:my-2 [&_li]:pl-1',
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
  return (
    <>
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case 'texto':  return <BlocoTexto  key={i} html={b.dados.html ?? ''} />;
          case 'html':   return <BlocoHtml   key={i} html={b.dados.html ?? ''} />;
          case 'imagem': return <BlocoImagem key={i} url={b.dados.url ?? ''} legenda={b.dados.legenda} onAmpliar={onAmpliar} />;
          case 'video':  return <BlocoVideo  key={i} url={b.dados.url ?? ''} titulo={titulo} />;
          default:       return null;
        }
      })}
    </>
  );
}
