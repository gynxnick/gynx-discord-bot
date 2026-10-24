import { describe, expect, it } from 'vitest';
import { troubleshooting } from '@gynx/services';
import { excerptVisible, parseFindings } from './diagnostics';
import {
  aiFormFrom,
  aiPayload,
  articlePayload,
  emptyArticle,
  helpfulRatio,
  normalizeTags,
  slugify,
  validateAiForm,
  validateArticleForm,
} from './forms';

describe('article form', () => {
  it('produces a payload the service schema accepts', () => {
    const f = {
      ...emptyArticle(),
      slug: 'my-article',
      title: ' My article ',
      summary: 'A summary of the article',
      body: 'Body text that is long enough.',
      tags: ['Net', 'net', ' DNS '],
      game: '',
    };
    const p = articlePayload(f);
    expect(p).toMatchObject({ game: null, url: null, tags: ['net', 'dns'], title: 'My article' });
    expect(validateArticleForm(f)).toEqual({});
    expect(troubleshooting.articleInputSchema.safeParse(p).success).toBe(true);
  });
  it('flags invalid fields like the service does', () => {
    const e = validateArticleForm({
      ...emptyArticle(),
      slug: 'Bad Slug',
      title: 'x',
      summary: 'short',
      body: 'tiny',
      url: 'http://x.example',
    });
    expect(Object.keys(e).sort()).toEqual(['body', 'slug', 'summary', 'title', 'url']);
  });
  it('helpers', () => {
    expect(slugify("Minecraft: Can't connect!")).toBe('minecraft-can-t-connect');
    expect(helpfulRatio(0, 0)).toBeNull();
    expect(helpfulRatio(3, 1)).toBe(75);
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
});

describe('AI provider form', () => {
  const stored = {
    id: 'i1',
    kind: 'AI_PROVIDER',
    name: 'openai',
    enabled: true,
    settings: { model: 'gpt-x', maxTokens: 500 },
    hasSecret: true,
    updatedAt: '',
  };
  it('never prefills the key and keeps it unless replaced or removed', () => {
    const f = aiFormFrom(stored);
    expect(f.secret).toBe('');
    expect(f.secretAction).toBe('keep');
    expect('secret' in aiPayload(f)).toBe(false);
    expect(aiPayload({ ...f, secretAction: 'remove' }).secret).toBe('');
    expect(aiPayload({ ...f, secretAction: 'replace', secret: 'sk-new' }).secret).toBe('sk-new');
    // Replace with an empty field keeps the stored key.
    expect('secret' in aiPayload({ ...f, secretAction: 'replace', secret: '' })).toBe(false);
  });
  it('maps settings and validates https base URLs', () => {
    const f = {
      ...aiFormFrom(null),
      name: 'Self-Hosted',
      baseUrl: 'https://ai.example/v1',
      maxTokens: '800',
    };
    expect(aiPayload(f)).toEqual({
      kind: 'AI_PROVIDER',
      name: 'self-hosted',
      enabled: false,
      settings: { baseUrl: 'https://ai.example/v1', maxTokens: 800 },
    });
    expect(validateAiForm({ ...f, baseUrl: 'http://ai.example' }).baseUrl).toBeDefined();
    expect(validateAiForm({ ...f, maxTokens: '0' }).maxTokens).toBeDefined();
  });
});

describe('diagnostic view model', () => {
  it('parses findings defensively', () => {
    expect(parseFindings('x')).toEqual([]);
    expect(
      parseFindings([
        { id: 'a', title: 'T', confidence: 'likely', explanation: 'E', evidence: 'ev' },
        { nope: 1 },
      ]),
    ).toEqual([
      { id: 'a', title: 'T', confidence: 'likely', explanation: 'E', evidence: 'ev', articleSlug: null },
    ]);
  });
  it('hides excerpts once purged or expired', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    expect(
      excerptVisible({ purgedAt: null, expiresAt: '2026-01-03T00:00:00Z', redactedExcerpt: 'x' }, now),
    ).toBe(true);
    expect(
      excerptVisible({ purgedAt: null, expiresAt: '2026-01-01T00:00:00Z', redactedExcerpt: 'x' }, now),
    ).toBe(false);
    expect(
      excerptVisible({ purgedAt: now, expiresAt: '2026-01-03T00:00:00Z', redactedExcerpt: 'x' }, now),
    ).toBe(false);
  });
});
