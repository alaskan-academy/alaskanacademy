/**
 * Limpa o HTML antes de ele virar página.
 *
 * O bloco de HTML existe para colar embed — Panda, Loom, Figma, uma tabela
 * pronta. Isso é, por definição, deixar alguém escrever markup que a página vai
 * executar. Sem filtro, um `<script>` colado ali roda com a sessão de quem
 * estiver lendo, e um `onerror=` numa imagem faz o mesmo com menos alarde.
 *
 * Só admin escreve processo, o que reduz o risco mas não o elimina: o texto
 * pode ter sido copiado de qualquer lugar, e ninguém lê um embed inteiro antes
 * de colar. E o CLAUDE.md é explícito — nada de HTML de entrada sem filtro.
 *
 * LISTA DE PERMITIDOS, não de proibidos. Lista de proibidos sempre fica para
 * trás: basta uma tag nova, um atributo novo, uma grafia diferente. Aqui o que
 * não está na lista some, e o padrão é recusar.
 */

/** O que pode existir. Qualquer outra tag some, mas o texto dentro dela fica. */
const TAGS = new Set([
  'p', 'br', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'sub', 'sup',
  'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'blockquote', 'hr', 'pre', 'code',
  'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'iframe',
]);

/** O que pode acompanhar cada tag. O resto é descartado sem dó. */
const ATRIBUTOS: Record<string, Set<string>> = {
  a:      new Set(['href', 'title']),
  img:    new Set(['src', 'alt', 'title', 'width', 'height', 'loading']),
  iframe: new Set(['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'loading']),
  th:     new Set(['colspan', 'rowspan']),
  td:     new Set(['colspan', 'rowspan']),
};

/**
 * `style` e `class` ficam de fora de propósito, e não por descuido.
 *
 * `style` deixa posicionar coisa por cima da página — um `position:fixed`
 * cobrindo a tela inteira é ataque sem precisar de script. E `class` deixaria
 * o conteúdo colado herdar estilos do dashboard e brigar com o layout.
 */

const ESQUEMAS_DE_LINK = ['http:', 'https:', 'mailto:'];
const ESQUEMAS_DE_MIDIA = ['http:', 'https:'];

function urlSegura(valor: string, permitidos: string[]): string | null {
  const limpo = valor.trim();
  // Relativa (`/algo`, `algo.png`) é sempre do próprio site: não dá para
  // escapar para `javascript:` sem os dois pontos de esquema.
  if (/^[^a-zA-Z]|^[a-zA-Z][a-zA-Z0-9+.-]*[^a-zA-Z0-9+.:-]/.test(limpo) && !limpo.includes(':')) {
    return limpo;
  }
  try {
    // A base só existe para a URL relativa não explodir; o que importa é o
    // protocolo que sair daqui.
    const u = new URL(limpo, 'https://alaskan.local/');
    return permitidos.includes(u.protocol) ? limpo : null;
  } catch {
    return null;
  }
}

/**
 * Devolve o HTML sem nada que execute.
 *
 * Usa o parser do próprio navegador em vez de expressão regular. HTML não é
 * linguagem regular, e todo sanitizador escrito com regex já foi furado da
 * mesma forma: `<scr<script>ipt>`, atributo sem aspas, comentário no meio da
 * tag. O parser vê a mesma árvore que a página veria.
 */
export function sanitizarHtml(html: string): string {
  if (!html) return '';
  if (typeof window === 'undefined' || !window.DOMParser) return '';

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const limpar = (no: Element) => {
    // Copia a lista: remover filho durante a iteração pula elementos.
    for (const filho of Array.from(no.children)) limpar(filho);

    const tag = no.tagName.toLowerCase();

    if (!TAGS.has(tag)) {
      // O CONTEÚDO sobrevive, a tag não. Um `<section>` colado perde a moldura
      // e mantém o texto; um `<script>` não tem conteúdo que valha e some
      // inteiro, junto com o código dentro dele.
      if (tag === 'script' || tag === 'style' || tag === 'template') {
        no.remove();
      } else {
        no.replaceWith(...Array.from(no.childNodes));
      }
      return;
    }

    const permitidos = ATRIBUTOS[tag] ?? new Set<string>();
    for (const attr of Array.from(no.attributes)) {
      const nome = attr.name.toLowerCase();

      // Todo `on*` sai antes de qualquer outra checagem: é o caminho mais curto
      // para executar código e não depende da tag ser exótica.
      if (nome.startsWith('on') || !permitidos.has(nome)) {
        no.removeAttribute(attr.name);
        continue;
      }

      if (nome === 'href' || nome === 'src') {
        const ok = urlSegura(attr.value, nome === 'href' ? ESQUEMAS_DE_LINK : ESQUEMAS_DE_MIDIA);
        if (ok === null) no.removeAttribute(attr.name);
        else no.setAttribute(attr.name, ok);
      }
    }

    // Link para fora sempre abre em outra aba e sem passar o `window.opener` —
    // sem `noopener` a página de destino consegue trocar o endereço desta.
    if (tag === 'a' && no.getAttribute('href')?.startsWith('http')) {
      no.setAttribute('target', '_blank');
      no.setAttribute('rel', 'noopener noreferrer');
    }
  };

  for (const filho of Array.from(doc.body.children)) limpar(filho);
  return doc.body.innerHTML;
}
