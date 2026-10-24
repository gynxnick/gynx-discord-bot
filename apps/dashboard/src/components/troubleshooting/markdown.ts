/**
 * Minimal, safe Markdown → HTML for the knowledge-base editor preview.
 *
 * Escape-first: the whole source is HTML-escaped before any formatting is
 * applied, so no tag or attribute from the input can survive. Only a small
 * subset is recognised: headings (#–###), **bold**, *italics* / _italics_,
 * `inline code`, fenced code blocks, unordered/ordered lists and
 * [links](https://…). Links are emitted only for absolute https:// URLs;
 * anything else (javascript:, data:, http:, relative) is rendered as plain text.
 * Pure; safe on server and client.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function unescapeHtml(s: string): string {
  return s.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!,
  );
}

const hasControlChars = (s: string): boolean =>
  [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** Absolute https URL without credentials, or null. */
export function safeHttpsUrl(raw: string): string | null {
  const trimmed = raw.trim();
  // Reject whitespace/control characters outright (browsers strip some of them inside schemes).
  if (!trimmed || /\s/.test(trimmed) || hasControlChars(trimmed)) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return u.href;
}

// Private-use code points delimit placeholders; they are stripped from the input first.
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';

/** Inline formatting on already-escaped text. */
function renderInline(escaped: string): string {
  const slots: string[] = [];
  const hold = (html: string) => `${PH_OPEN}${slots.push(html) - 1}${PH_CLOSE}`;

  // 1. Code spans: content is shown literally (no further formatting).
  let s = escaped.replace(/`([^`\n]{1,500})`/g, (_, code: string) => hold(`<code>${code}</code>`));

  // 2. Links: https only; anything else degrades to its text.
  s = s.replace(/\[([^\]\n]{1,200})\]\(([^()\s]{1,500})\)/g, (_, text: string, href: string) => {
    const url = safeHttpsUrl(unescapeHtml(href));
    const label = formatEmphasis(text);
    return url
      ? hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`)
      : hold(label);
  });

  // 3. Emphasis.
  s = formatEmphasis(s);

  return s.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_, i: string) => slots[Number(i)] ?? '');
}

function formatEmphasis(s: string): string {
  return s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lines: string[] };

const HEADING = /^(#{1,3})\s+(.+)$/;
const UL = /^\s*[-*+]\s+(.+)$/;
const OL = /^\s*\d{1,3}[.)]\s+(.+)$/;
const FENCE = /^\s*```/;

function parseBlocks(src: string): Block[] {
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // closing fence (or end of input)
      blocks.push({ kind: 'code', lines: body });
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ kind: 'heading', level: h[1]!.length as 1 | 2 | 3, text: h[2]!.trim() });
      i++;
      continue;
    }
    if (UL.test(line) || OL.test(line)) {
      const ordered = !UL.test(line);
      const re = ordered ? OL : UL;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(re.exec(lines[i++]!)![1]!);
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !HEADING.test(lines[i]!) &&
      !UL.test(lines[i]!) &&
      !OL.test(lines[i]!) &&
      !FENCE.test(lines[i]!)
    ) {
      para.push(lines[i++]!);
    }
    blocks.push({ kind: 'paragraph', lines: para });
  }
  return blocks;
}

export const MAX_PREVIEW_CHARS = 20_000;

/** Render the supported Markdown subset to inert HTML. */
export function renderSafeMarkdown(source: string): string {
  const clean = source
    .slice(0, MAX_PREVIEW_CHARS)
    .replace(/\r\n?/g, '\n')
    .replace(/[\uE000\uE001]/g, '')
    .split(String.fromCharCode(0))
    .join('');
  const escaped = escapeHtml(clean);
  return parseBlocks(escaped)
    .map((b) => {
      switch (b.kind) {
        case 'heading':
          return `<h${b.level + 2}>${renderInline(b.text)}</h${b.level + 2}>`;
        case 'code':
          return `<pre><code>${b.lines.join('\n')}</code></pre>`;
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          return `<${tag}>${b.items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</${tag}>`;
        }
        case 'paragraph':
          return `<p>${b.lines.map((l) => renderInline(l)).join('<br>')}</p>`;
      }
    })
    .join('\n');
}
