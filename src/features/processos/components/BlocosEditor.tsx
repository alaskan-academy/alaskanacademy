import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/RichTextEditor';
import { cn } from '@/lib/utils';
import {
  Type, ImageIcon, Video, Code2, Trash2, ChevronUp, ChevronDown, Plus, Eye,
} from 'lucide-react';
import { Bloco, TipoBloco } from './BlocosRenderer';
import { sanitizarHtml } from '../sanitizar';

/**
 * Montar o processo em blocos, na ordem que a autora quiser.
 *
 * O formulário antigo tinha três campos fixos e uma ordem embutida no código:
 * vídeo no topo, texto no meio, imagens no fim. Aqui a ordem é conteúdo — dá
 * para explicar um passo, mostrar o print dele e só então o vídeo.
 */

const TIPOS: { tipo: TipoBloco; nome: string; icone: typeof Type; ajuda: string }[] = [
  { tipo: 'texto',  nome: 'Texto',  icone: Type,      ajuda: 'Título, parágrafo, lista, citação' },
  { tipo: 'imagem', nome: 'Imagem', icone: ImageIcon, ajuda: 'Um print, com legenda' },
  { tipo: 'video',  nome: 'Vídeo',  icone: Video,     ajuda: 'Embed do Panda' },
  { tipo: 'html',   nome: 'HTML',   icone: Code2,     ajuda: 'Tabela, embed de fora' },
];

function blocoVazio(tipo: TipoBloco): Bloco {
  switch (tipo) {
    case 'texto':  return { tipo, dados: { html: '' } };
    case 'html':   return { tipo, dados: { html: '' } };
    case 'imagem': return { tipo, dados: { url: '', legenda: '' } };
    case 'video':  return { tipo, dados: { url: '' } };
  }
}

/** O iframe colado vira só a URL — é o que o embed do Panda entrega. */
function urlDoEmbed(bruto: string): string {
  const m = bruto.match(/src=["']([^"']+)["']/);
  return m ? m[1] : bruto.trim();
}

function Cabecalho({
  bloco, indice, total, onSubir, onDescer, onRemover,
}: {
  bloco: Bloco; indice: number; total: number;
  onSubir: () => void; onDescer: () => void; onRemover: () => void;
}) {
  const def = TIPOS.find(t => t.tipo === bloco.tipo);
  const Icone = def?.icone ?? Type;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40">
      <Icone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs font-medium text-muted-foreground">{def?.nome ?? bloco.tipo}</span>
      <div className="flex-1" />
      {/* Setas e não arrastar: com o mouse dentro de um editor de texto, o
          arraste briga com a seleção do próprio texto. */}
      <Button
        type="button" size="sm" variant="ghost" className="h-6 w-6 p-0"
        onClick={onSubir} disabled={indice === 0} aria-label="Mover para cima"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button" size="sm" variant="ghost" className="h-6 w-6 p-0"
        onClick={onDescer} disabled={indice === total - 1} aria-label="Mover para baixo"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button" size="sm" variant="ghost"
        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
        onClick={onRemover} aria-label="Remover bloco"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CorpoDoBloco({ bloco, onMudar }: { bloco: Bloco; onMudar: (b: Bloco) => void }) {
  const [verHtml, setVerHtml] = useState(false);

  if (bloco.tipo === 'texto') {
    return (
      <RichTextEditor
        formato="html"
        content={bloco.dados.html ?? ''}
        onChange={html => onMudar({ ...bloco, dados: { ...bloco.dados, html } })}
        placeholder="Escreva o passo…"
        minHeight="120px"
      />
    );
  }

  if (bloco.tipo === 'imagem') {
    return (
      <div className="p-3 space-y-2">
        <Input
          className="h-9 text-sm font-mono"
          placeholder="https://… a URL da imagem"
          value={bloco.dados.url ?? ''}
          onChange={e => onMudar({ ...bloco, dados: { ...bloco.dados, url: e.target.value } })}
        />
        <Input
          className="h-9 text-sm"
          placeholder="Legenda (opcional)"
          value={bloco.dados.legenda ?? ''}
          onChange={e => onMudar({ ...bloco, dados: { ...bloco.dados, legenda: e.target.value } })}
        />
        {bloco.dados.url && (
          <img
            src={bloco.dados.url}
            alt=""
            className="max-h-40 rounded-md border border-border object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
      </div>
    );
  }

  if (bloco.tipo === 'video') {
    return (
      <div className="p-3">
        <Input
          className="h-9 text-sm font-mono"
          placeholder="Cole a URL de embed ou o código iframe do Panda Video"
          value={bloco.dados.url ?? ''}
          // Converte na hora de colar, e não no salvar: assim dá para ver que
          // o que ficou guardado é a URL, e não o iframe inteiro.
          onChange={e => onMudar({ ...bloco, dados: { ...bloco.dados, url: urlDoEmbed(e.target.value) } })}
        />
      </div>
    );
  }

  // HTML
  const limpo = sanitizarHtml(bloco.dados.html ?? '');
  const mudou = limpo !== (bloco.dados.html ?? '');
  return (
    <div className="p-3 space-y-2">
      <Textarea
        className="min-h-24 resize-y font-mono text-xs leading-relaxed"
        placeholder="<table>…</table> ou o embed de outro serviço"
        value={bloco.dados.html ?? ''}
        onChange={e => onMudar({ ...bloco, dados: { ...bloco.dados, html: e.target.value } })}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button" size="sm" variant="ghost" className="h-7 gap-1.5 text-xs"
          onClick={() => setVerHtml(v => !v)}
        >
          <Eye className="h-3.5 w-3.5" />
          {verHtml ? 'Esconder a prévia' : 'Ver como vai ficar'}
        </Button>
        {/* Avisar ANTES de salvar, e não em silêncio: quem cola um embed e vê
            parte dele sumir na página publicada não descobre o porquê. */}
        {mudou && (
          <span className="text-xs text-amber-500/90">
            parte do código será removida por segurança (script, style, on…)
          </span>
        )}
      </div>
      {verHtml && (
        <div
          className="rounded-md border border-border p-3 text-sm overflow-x-auto [&_table]:w-full [&_th]:text-left [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_iframe]:w-full [&_iframe]:aspect-video"
          dangerouslySetInnerHTML={{ __html: limpo }}
        />
      )}
    </div>
  );
}

export function BlocosEditor({
  blocos, onChange,
}: {
  blocos: Bloco[];
  /**
   * Recebe o `setState` do pai, e não uma função qualquer.
   *
   * Com `onChange([...blocos, novo])` os dois cliques de "Imagem" e "Vídeo"
   * dados no mesmo tique liam a MESMA lista do render anterior, e o segundo
   * apagava o primeiro — só o vídeo entrava. A forma funcional lê sempre o
   * valor mais recente.
   */
  onChange: React.Dispatch<React.SetStateAction<Bloco[]>>;
}) {
  const trocar = (i: number, j: number) => {
    onChange(prev => {
      if (j < 0 || j >= prev.length) return prev;
      const novo = [...prev];
      [novo[i], novo[j]] = [novo[j], novo[i]];
      return novo;
    });
  };

  return (
    <div className="space-y-2">
      {blocos.map((b, i) => (
        // A chave é o índice porque o bloco não tem id, e reordenar troca as
        // posições de propósito -- é o mesmo bloco mudando de lugar.
        <div key={i} className="rounded-md border border-border overflow-hidden bg-background">
          <Cabecalho
            bloco={b} indice={i} total={blocos.length}
            onSubir={() => trocar(i, i - 1)}
            onDescer={() => trocar(i, i + 1)}
            onRemover={() => onChange(prev => prev.filter((_, k) => k !== i))}
          />
          <CorpoDoBloco
            bloco={b}
            onMudar={nb => onChange(prev => prev.map((x, k) => (k === i ? nb : x)))}
          />
        </div>
      ))}

      {blocos.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-md">
          Nenhum bloco ainda. Comece por um de texto.
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap pt-1">
        <span className="text-xs text-muted-foreground mr-1">
          <Plus className="h-3 w-3 inline mr-0.5" />
          Adicionar:
        </span>
        {TIPOS.map(t => (
          <Button
            key={t.tipo}
            type="button" size="sm" variant="outline"
            className="h-8 gap-1.5 text-xs"
            title={t.ajuda}
            onClick={() => onChange(prev => [...prev, blocoVazio(t.tipo)])}
          >
            <t.icone className="h-3.5 w-3.5" />
            {t.nome}
          </Button>
        ))}
      </div>
    </div>
  );
}
