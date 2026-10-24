import { describe, expect, it } from 'vitest';
import { escapeHtml, renderSafeMarkdown, safeHttpsUrl } from './markdown';

/** Every tag in the output must be one the renderer emits itself. */
const ALLOWED_TAGS = new Set([
  'h3',
  'h4',
  'h5',
  'p',
  'br',
  'strong',
  'em',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'a',
]);
function tagsOf(html: string): string[] {
  return [...html.matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((m) => m[1]!.toLowerCase());
}
function attrsOf(html: string): string[] {
  return [...html.matchAll(/<[a-z0-9]+(\s[^>]*)?>/gi)].map((m) => m[1] ?? '').filter(Boolean);
}

describe('renderSafeMarkdown', () => {
  it('renders the supported subset', () => {
    const html = renderSafeMarkdown(
      [
        '# Title',
        '## Sub',
        'Some **bold**, *italic* and `code`.',
        '',
        '- one',
        '- two',
        '',
        '1. first',
        '2. second',
        '',
        '```',
        'raw <b>',
        '```',
        '[Docs](https://example.com/a?b=1&c=2)',
      ].join('\n'),
    );
    expect(html).toContain('<h3>Title</h3>');
    expect(html).toContain('<h4>Sub</h4>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(html).toContain('<pre><code>raw &lt;b&gt;</code></pre>');
    expect(html).toContain(
      '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">Docs</a>',
    );
  });

  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '"><iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '**<b onmouseover=alert(1)>bold</b>**',
    '`<script>`',
    '[x](https://ok.example/"onmouseover="alert(1))',
    '<style>body{display:none}</style>',
    '&lt;script&gt; already-escaped',
  ];

  it.each(payloads)('keeps XSS payload inert: %s', (payload) => {
    const html = renderSafeMarkdown(payload);
    for (const t of tagsOf(html)) expect(ALLOWED_TAGS.has(t)).toBe(true);
    for (const a of attrsOf(html)) {
      // Only our own link attributes may appear.
      expect(a).toMatch(/^ href="https:\/\/[^"]*" target="_blank" rel="noopener noreferrer nofollow"$/);
      expect(a.toLowerCase()).not.toContain('javascript:');
    }
    // Text like "onerror=" may remain, but only as escaped text outside any tag.
    expect(html).not.toMatch(/<(script|img|svg|iframe|style)/i);
  });

  it('drops javascript:, data:, http: and relative links but keeps their text', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'http://example.com',
      '/relative',
      'vbscript:x',
      'java\tscript:alert(1)',
    ]) {
      const html = renderSafeMarkdown(`[click me](${href})`);
      expect(html).not.toContain('<a ');
      expect(html).toContain('click me');
    }
  });

  it('escapes quotes so attributes cannot be broken out of', () => {
    const html = renderSafeMarkdown('[x](https://a.example/?q="><script>)');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/href="[^"]*"[^ >]/);
  });

  it('cannot forge placeholders', () => {
    const html = renderSafeMarkdown('0 `<b>`');
    expect(html).toBe('<p>0 <code>&lt;b&gt;</code></p>');
  });
});

describe('safeHttpsUrl', () => {
  it('accepts only absolute https URLs without credentials', () => {
    expect(safeHttpsUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHttpsUrl('http://example.com')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('https://user:pw@example.com')).toBeNull();
    expect(safeHttpsUrl('https://exa mple.com')).toBeNull();
    expect(safeHttpsUrl('')).toBeNull();
  });
  it('escapeHtml covers the five significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
