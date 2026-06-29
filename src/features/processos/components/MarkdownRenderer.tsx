import React from 'react';
import { cn } from '@/lib/utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function makeHeadingId(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
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

    // ── H1
    if (line.startsWith('# ')) {
      const text = line.slice(2);
      elements.push(
        <h1
          key={key++}
          id={makeHeadingId(text)}
          className="text-[22px] font-bold text-foreground mt-10 mb-4 first:mt-0 leading-tight scroll-mt-6"
        >
          {parseInline(text)}
        </h1>
      );
      i++; continue;
    }

    // ── H2
    if (line.startsWith('## ')) {
      const text = line.slice(3);
      elements.push(
        <h2
          key={key++}
          id={makeHeadingId(text)}
          className="text-[18px] font-bold text-foreground mt-10 mb-3 pb-2.5 border-b border-border/50 first:mt-0 leading-snug scroll-mt-6"
        >
          {parseInline(text)}
        </h2>
      );
      i++; continue;
    }

    // ── H3
    if (line.startsWith('### ')) {
      const text = line.slice(4);
      elements.push(
        <h3
          key={key++}
          id={makeHeadingId(text)}
          className="text-[15px] font-semibold text-foreground mt-7 mb-2 first:mt-0 scroll-mt-6"
        >
          {parseInline(text)}
        </h3>
      );
      i++; continue;
    }

    // ── Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<hr key={key++} className="border-border my-7" />);
      i++; continue;
    }

    // ── Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={key++} className="list-decimal list-outside pl-6 my-5 space-y-2">
          {items.map((item, j) => (
            <li key={j} className="text-[14.5px] text-foreground/85 leading-7 pl-1">
              {parseInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // ── Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc list-outside pl-6 my-5 space-y-2">
          {items.map((item, j) => (
            <li key={j} className="text-[14.5px] text-foreground/85 leading-7 pl-1">
              {parseInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Block image: ![alt](url)
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line.trim())) {
      const m = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (m) {
        elements.push(
          <div key={key++} className="my-5 rounded-xl overflow-hidden border border-border/60 bg-muted/30">
            <img
              src={m[2]}
              alt={m[1]}
              className="w-full object-cover"
              loading="lazy"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        );
        i++; continue;
      }
    }

    // ── Table: line starts with | and next line is separator |---|---|
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1])) {
      const parseRow = (row: string) =>
        row.split('|').slice(1, -1).map(c => c.trim());

      const headers = parseRow(line);
      i += 2; // skip separator line

      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(parseRow(lines[i]));
        i++;
      }

      elements.push(
        <div key={key++} className="my-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {headers.map((h, j) => (
                  <th
                    key={j}
                    className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                  >
                    {parseInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-muted/20 transition-colors">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-4 py-3 text-[13.5px] leading-snug ${
                        ci === 0
                          ? 'font-medium text-foreground'
                          : 'text-foreground/75'
                      }`}
                    >
                      {parseInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ── Blockquote
    if (line.startsWith('> ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote
          key={key++}
          className="my-5 pl-5 py-1 border-l-[3px] border-primary/50 text-[14px] text-muted-foreground italic space-y-1.5"
        >
          {items.map((item, j) => <p key={j}>{parseInline(item)}</p>)}
        </blockquote>
      );
      continue;
    }

    // ── Empty line → paragraph break spacer
    if (line.trim() === '') {
      // Only emit if adjacent to content (skip consecutive empty lines)
      const prev = elements[elements.length - 1];
      if (prev !== undefined) {
        elements.push(<div key={key++} aria-hidden className="h-1" />);
      }
      i++; continue;
    }

    // ── Paragraph
    elements.push(
      <p key={key++} className="text-[14.5px] text-foreground/85 leading-7 mb-1">
        {parseInline(line)}
      </p>
    );
    i++;
  }

  return <div className={cn('prose-alaskan', className)}>{elements}</div>;
}

// ── TOC extractor ─────────────────────────────────────────────────────────────

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
