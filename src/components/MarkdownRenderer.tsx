import React from 'react';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generates a URL-safe id from a heading text */
export function makeHeadingId(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Inline parser (bold, italic, links) ──────────────────────────────────────

function parseInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const lm = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (lm) {
      return (
        <a
          key={i}
          href={lm[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          {lm[1]}
        </a>
      );
    }
    return part;
  });
}

// ── Block renderer ────────────────────────────────────────────────────────────

interface Props {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: Props) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith('### ')) {
      const text = line.slice(4);
      elements.push(
        <h3
          key={key++}
          id={makeHeadingId(text)}
          className="text-sm font-semibold text-foreground mt-6 mb-2 first:mt-0 scroll-mt-6"
        >
          {parseInline(text)}
        </h3>
      );
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      const text = line.slice(3);
      elements.push(
        <h2
          key={key++}
          id={makeHeadingId(text)}
          className="text-base font-bold text-foreground mt-8 mb-2.5 first:mt-0 border-b border-border/50 pb-1.5 scroll-mt-6"
        >
          {parseInline(text)}
        </h2>
      );
      i++;
      continue;
    }

    if (line.startsWith('# ')) {
      const text = line.slice(2);
      elements.push(
        <h1
          key={key++}
          id={makeHeadingId(text)}
          className="text-lg font-bold text-foreground mt-8 mb-3 first:mt-0 scroll-mt-6"
        >
          {parseInline(text)}
        </h1>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<hr key={key++} className="border-border my-5" />);
      i++;
      continue;
    }

    // Ordered list — collect consecutive items
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={key++} className="list-decimal list-outside pl-5 space-y-2 my-3.5">
          {items.map((item, j) => (
            <li key={j} className="text-sm text-foreground/90 leading-relaxed pl-0.5">
              {parseInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Unordered list — collect consecutive items
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc list-outside pl-5 space-y-2 my-3.5">
          {items.map((item, j) => (
            <li key={j} className="text-sm text-foreground/90 leading-relaxed pl-0.5">
              {parseInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={key++} className="border-l-2 border-primary/50 pl-4 my-4 text-sm text-muted-foreground italic space-y-1">
          {items.map((item, j) => <p key={j}>{parseInline(item)}</p>)}
        </blockquote>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    // Paragraph
    elements.push(
      <p key={key++} className="text-sm text-foreground/90 leading-relaxed">
        {parseInline(line)}
      </p>
    );
    i++;
  }

  return <div className={cn('space-y-0.5', className)}>{elements}</div>;
}

// ── TOC extractor (for use in article pages) ──────────────────────────────────

export interface TocItem {
  level: number;
  text: string;
  id: string;
}

export function extractTOC(content: string): TocItem[] {
  return content
    .split('\n')
    .filter(l => /^#{1,3}\s/.test(l))
    .map(l => {
      const m = l.match(/^(#{1,3})\s+(.+)/);
      const text = (m?.[2] ?? '').trim();
      return { level: (m?.[1] ?? '#').length, text, id: makeHeadingId(text) };
    });
}
