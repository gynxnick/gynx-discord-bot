import { createElement, Fragment, type ReactNode } from 'react';

/**
 * Tiny, safe Markdown subset for generated reports: ATX headings, paragraphs,
 * bullet/numbered lists, pipe tables, horizontal rules and inline **bold**,
 * _italic_ / *italic* and `code`.
 *
 * Safety: the parser produces a plain data tree and the renderer turns it into
 * React elements (text is always rendered as text nodes, so React escapes it).
 * There is no raw-HTML passthrough, no links or images, no attributes derived
 * from input — `<script>`, `<img onerror>` and `[x](javascript:…)` stay inert text.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string };

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' };

const MAX_INPUT = 500_000;
const MAX_DEPTH = 4;

// ── Inline ─────────────────────────────────────────────────────────────────

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|<>~]/;

function pushText(out: Inline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1]!)) {
      pushText(out, src[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === '`') {
      const close = src.indexOf('`', i + 1);
      if (close > i + 1) {
        out.push({ t: 'code', v: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (depth < MAX_DEPTH && ch === '*' && src[i + 1] === '*') {
      const close = src.indexOf('**', i + 2);
      if (close > i + 2) {
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, close), depth + 1) });
        i = close + 2;
        continue;
      }
    }
    if (
      depth < MAX_DEPTH &&
      (ch === '_' || ch === '*') &&
      !isWordChar(src[i - 1]) &&
      src[i + 1] !== ' ' &&
      src[i + 1] !== ch
    ) {
      let close = src.indexOf(ch, i + 1);
      while (
        close > -1 &&
        (isWordChar(src[close + 1]) || src[close - 1] === ' ' || (ch === '*' && src[close + 1] === '*'))
      )
        close = src.indexOf(ch, close + 1);
      if (close > i + 1) {
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, close), depth + 1) });
        i = close + 1;
        continue;
      }
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

// ── Blocks ─────────────────────────────────────────────────────────────────

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Split a table row on unescaped pipes; `\|` stays as a literal pipe in the cell. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableRow = (l: string | undefined) => l !== undefined && l.trim().startsWith('|');

export function parseMarkdown(input: string): Block[] {
  const lines = input.slice(0, MAX_INPUT).replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: 'paragraph', c: parseInline(para.join(' ')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ t: 'heading', level: h[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline(h[2]!) });
      continue;
    }
    if (HR.test(line)) {
      flush();
      blocks.push({ t: 'hr' });
      continue;
    }
    if (isTableRow(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      flush();
      const header = splitRow(line).map((c) => parseInline(c));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitRow(lines[i]!);
        rows.push(header.map((_, ci) => parseInline(cells[ci] ?? '')));
        i++;
      }
      i--;
      blocks.push({ t: 'table', header, rows });
      continue;
    }
    const b = BULLET.exec(line);
    const o = b ? null : ORDERED.exec(line);
    if (b || o) {
      flush();
      const ordered = Boolean(o);
      const re = ordered ? ORDERED : BULLET;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
        i++;
      }
      i--;
      blocks.push({ t: 'list', ordered, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

// ── Rendering (React elements only; no HTML strings) ───────────────────────

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return createElement(Fragment, { key: i }, n.v);
      case 'strong':
        return createElement('strong', { key: i, className: 'font-semibold text-fg' }, ...renderInline(n.c));
      case 'em':
        return createElement('em', { key: i }, ...renderInline(n.c));
      case 'code':
        return createElement(
          'code',
          { key: i, className: 'rounded bg-surface-raised px-1 font-mono text-xs' },
          n.v,
        );
    }
  });
}

const HEADING_CLS: Record<number, string> = {
  1: 'mt-2 text-lg font-semibold text-fg',
  2: 'mt-6 border-b border-border pb-1 text-base font-semibold text-fg',
  3: 'mt-4 text-sm font-semibold text-fg',
  4: 'mt-3 text-sm font-medium text-fg',
  5: 'mt-3 text-sm font-medium text-fg',
  6: 'mt-3 text-sm font-medium text-fg',
};

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      // The page already has an h1; shift report headings down one level.
      const tag = `h${Math.min(6, b.level + 1)}` as 'h2';
      return createElement(tag, { key, className: HEADING_CLS[b.level] }, ...renderInline(b.c));
    }
    case 'paragraph':
      return createElement('p', { key, className: 'my-2 break-words text-sm text-fg' }, ...renderInline(b.c));
    case 'hr':
      return createElement('hr', { key, className: 'my-4 border-border' });
    case 'list':
      return createElement(
        b.ordered ? 'ol' : 'ul',
        { key, className: `my-2 space-y-1 pl-5 text-sm text-fg ${b.ordered ? 'list-decimal' : 'list-disc'}` },
        ...b.items.map((item, i) =>
          createElement('li', { key: i, className: 'break-words' }, ...renderInline(item)),
        ),
      );
    case 'table':
      return createElement(
        'div',
        { key, className: 'my-3 overflow-x-auto' },
        createElement(
          'table',
          { className: 'w-full border-collapse text-sm' },
          createElement(
            'thead',
            null,
            createElement(
              'tr',
              { className: 'border-b border-border' },
              ...b.header.map((c, i) =>
                createElement(
                  'th',
                  {
                    key: i,
                    scope: 'col',
                    className:
                      'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-fg-muted',
                  },
                  ...renderInline(c),
                ),
              ),
            ),
          ),
          createElement(
            'tbody',
            null,
            ...b.rows.map((row, ri) =>
              createElement(
                'tr',
                { key: ri, className: 'border-b border-border last:border-0' },
                ...row.map((c, ci) =>
                  createElement(
                    'td',
                    { key: ci, className: 'px-3 py-2 align-top tabular-nums text-fg' },
                    ...renderInline(c),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
  }
}

/** Render report Markdown safely as React elements. */
export function SafeMarkdown({ source, className }: { source: string; className?: string }) {
  return createElement('div', { className }, ...parseMarkdown(source).map(renderBlock));
}
