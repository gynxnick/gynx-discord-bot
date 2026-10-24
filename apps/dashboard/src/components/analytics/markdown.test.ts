import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, SafeMarkdown, splitRow } from './markdown';

const html = (source: string) => renderToStaticMarkup(createElement(SafeMarkdown, { source }));

describe('safe markdown: structure', () => {
  it('parses headings, lists, bold, italics, tables and paragraphs', () => {
    const md = [
      '# Weekly CEO report — GYNX.GG',
      '',
      'Period: 1 Oct – 8 Oct',
      'continued line',
      '',
      '## 1. Executive summary',
      '',
      '- **Joins:** 3 · vs previous: +2 (+200%)',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '_observed message activity_',
      '',
      '| Metric | This period |',
      '| --- | --- |',
      '| Pipes \\| inside | 5 |',
    ].join('\n');
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.t)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'list',
      'paragraph',
      'table',
    ]);
    expect(blocks[1]).toEqual({
      t: 'paragraph',
      c: [{ t: 'text', v: 'Period: 1 Oct – 8 Oct continued line' }],
    });
    const out = html(md);
    expect(out).toContain('<h2 class="mt-2 text-lg font-semibold text-fg">Weekly CEO report — GYNX.GG</h2>');
    expect(out).toContain('<strong class="font-semibold text-fg">Joins:</strong>');
    expect(out).toContain('<ol');
    expect(out).toContain('<em>observed message activity</em>');
    expect(out).toContain('<th scope="col"');
    expect(out).toContain('Pipes | inside');
  });

  it('splits table rows on unescaped pipes only', () => {
    expect(splitRow('| a | b \\| c | d |')).toEqual(['a', 'b \\| c', 'd']);
  });

  it('does not italicise snake_case words', () => {
    expect(parseInline('report_channel_id and 5 * 3 * 2')).toEqual([
      { t: 'text', v: 'report_channel_id and 5 * 3 * 2' },
    ]);
  });

  it('renders an empty document as an empty container', () => {
    expect(html('')).toBe('<div></div>');
  });
});

const ALLOWED_TAGS = [
  'div',
  'p',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

describe('safe markdown: XSS payloads stay inert', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '[click](javascript:alert(1))',
    '**<svg onload=alert(1)>**',
    '| <iframe src="javascript:alert(1)"> | x |\n| --- | --- |\n| <a href="javascript:alert(1)">y</a> | z |',
    '- <style>body{display:none}</style>',
    '`<script>alert(1)</script>`',
    '# <img src=x onerror=alert(1)>',
  ];

  for (const p of payloads) {
    it(`escapes ${JSON.stringify(p.slice(0, 40))}`, () => {
      const out = html(p);
      // Every real tag (raw '<' — text '<' is always escaped to &lt;) is from the allowlist
      // and carries only class/scope attributes: no handlers, no href/src.
      const tags = [...out.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)];
      expect(tags.length).toBeGreaterThan(0);
      for (const [, name, attrs] of tags) {
        expect(ALLOWED_TAGS).toContain(name!.toLowerCase());
        const attrNames = [...attrs!.matchAll(/\s([a-z-]+)=/gi)].map((m) => m[1]!.toLowerCase());
        for (const a of attrNames) expect(['class', 'scope']).toContain(a);
      }
      // The payload text is still visible (escaped), not silently dropped.
      if (p.includes('<')) expect(out).toContain('&lt;');
      else expect(out).toContain('javascript:alert(1)');
    });
  }

  it('renders javascript: links as plain text without an anchor', () => {
    const out = html('[click](javascript:alert(1))');
    expect(out).toBe(
      '<div><p class="my-2 break-words text-sm text-fg">[click](javascript:alert(1))</p></div>',
    );
  });
});
