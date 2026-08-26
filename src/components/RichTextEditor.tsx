import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, UnderlineIcon, List, ListOrdered, CheckSquare,
  Heading2, Heading3, ChevronRight, Undo2, Redo2, Eraser,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * O editor de texto rico do projeto, num lugar só.
 *
 * Vivia em `features/copywriters` e Processos precisava do mesmo. Copiar seria
 * a armadilha nº 1 do CLAUDE.md em forma de componente: duas barras de
 * ferramentas que divergem na primeira vez que alguém acrescentar um botão em
 * uma delas.
 *
 * Guarda em JSON ou em HTML, e quem chama escolhe. Não é indecisão: o
 * Copywriters já tem conteúdo gravado como JSON do TipTap, e Processos guarda
 * HTML porque o bloco de texto e o bloco de HTML precisam ser renderizados pelo
 * mesmo caminho — um formato só do lado de quem lê.
 */

type Props = {
  placeholder?: string;
  minHeight?: string;
  autoFocus?: boolean;
} & (
  | { formato?: 'json'; content: object; onChange: (v: object) => void }
  | { formato: 'html';  content: string; onChange: (v: string) => void }
);

function ToolBtn({ active, onClick, children, title, disabled }: {
  active?: boolean; onClick: () => void; children: React.ReactNode;
  title: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // `onMouseDown` com `preventDefault`, e não `onClick`: clicar num botão
      // tira o foco do editor, e sem isso a seleção some antes do comando rodar
      // — o negrito não pegaria no texto selecionado.
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={cn(
        'p-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor(props: Props) {
  const { placeholder = 'Escreva aqui...', minHeight = '160px', autoFocus } = props;
  const emHtml = props.formato === 'html';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: emHtml
      ? ((props.content as string) || '')
      : (props.content && Object.keys(props.content).length > 0 ? (props.content as object) : undefined),
    autofocus: autoFocus,
    onUpdate: ({ editor }) => {
      if (emHtml) (props.onChange as (v: string) => void)(editor.getHTML());
      else (props.onChange as (v: object) => void)(editor.getJSON());
    },
  });

  if (!editor) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden bg-background focus-within:border-primary/50 transition-colors">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30 flex-wrap">
        <ToolBtn title="Negrito" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Itálico" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Sublinhado" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolBtn>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolBtn title="Título 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Título 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolBtn>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolBtn title="Lista" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Lista numerada" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Checklist" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <CheckSquare className="h-3.5 w-3.5" />
        </ToolBtn>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolBtn title="Citação" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <ChevronRight className="h-3.5 w-3.5" />
        </ToolBtn>
        {/* Colar de fora traz a formatação do lugar de origem junto, e é o que
            mais faz um documento ficar com três fontes diferentes. */}
        <ToolBtn title="Limpar formatação" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <Eraser className="h-3.5 w-3.5" />
        </ToolBtn>

        <div className="flex-1" />

        <ToolBtn
          title="Desfazer" disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Refazer" disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </ToolBtn>
      </div>

      <EditorContent
        editor={editor}
        style={{ minHeight }}
        className={cn(
          'px-3 py-2 text-sm [&_.ProseMirror]:min-h-[inherit] [&_.ProseMirror]:outline-none',
          // O texto do editor precisa parecer com o texto do artigo, senão a
          // pessoa escreve numa aparência e publica noutra.
          '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2',
          '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5',
          '[&_p]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic',
          '[&_a]:text-primary [&_a]:underline',
        )}
      />
    </div>
  );
}
