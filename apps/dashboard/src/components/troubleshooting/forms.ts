/** Form state ↔ API payload mapping for the troubleshooting section. Pure; safe on the client. */

import { safeHttpsUrl } from './markdown';

export const GENERAL_GAME = '';

export interface ArticleFormState {
  slug: string;
  title: string;
  summary: string;
  body: string;
  /** '' = general (no game). */
  game: string;
  tags: string[];
  url: string;
  published: boolean;
}

export interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  game: string | null;
  tags: string[];
  url: string | null;
  published: boolean;
  views: number;
  helpfulYes: number;
  helpfulNo: number;
  updatedAt: string;
}

export const emptyArticle = (): ArticleFormState => ({
  slug: '',
  title: '',
  summary: '',
  body: '',
  game: GENERAL_GAME,
  tags: [],
  url: '',
  published: false,
});

export const articleToForm = (a: ArticleRow): ArticleFormState => ({
  slug: a.slug,
  title: a.title,
  summary: a.summary,
  body: a.body,
  game: a.game ?? GENERAL_GAME,
  tags: [...a.tags],
  url: a.url ?? '',
  published: a.published,
});

export function articlePayload(f: ArticleFormState) {
  return {
    slug: f.slug.trim(),
    title: f.title.trim(),
    summary: f.summary.trim(),
    body: f.body.trim(),
    game: f.game.trim() === '' ? null : f.game.trim().toLowerCase(),
    tags: normalizeTags(f.tags),
    url: f.url.trim() === '' ? null : f.url.trim(),
    published: f.published,
  };
}

/** Lower-case, trimmed, de-duplicated, ≤ 10 tags of ≤ 32 chars. */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim().toLowerCase().slice(0, 32);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 10);
}

/** Split typed text on commas/whitespace into tags. */
export const splitTags = (text: string): string[] => text.split(/[,\s]+/).filter(Boolean);

/** "Yes / (yes+no)" as a percentage, or null without votes. */
export function helpfulRatio(yes: number, no: number): number | null {
  const total = yes + no;
  return total === 0 ? null : Math.round((yes / total) * 100);
}

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Client-side checks mirroring articleInputSchema (the service re-validates). */
export function validateArticleForm(f: ArticleFormState): Record<string, string> {
  const p = articlePayload(f);
  const e: Record<string, string> = {};
  if (!SLUG_RE.test(p.slug) || p.slug.length > 64)
    e.slug = 'Use lowercase-kebab-case (letters, digits and single dashes), up to 64 characters.';
  if (p.title.length < 3 || p.title.length > 120) e.title = 'Title must be 3–120 characters.';
  if (p.summary.length < 10 || p.summary.length > 300) e.summary = 'Summary must be 10–300 characters.';
  if (p.body.length < 20 || p.body.length > 6000) e.body = 'Body must be 20–6000 characters.';
  if (p.url && !safeHttpsUrl(p.url)) e.url = 'Links must use https://';
  return e;
}

// ───────────────────────── AI provider ─────────────────────────

export interface AiFormState {
  name: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
  maxTokens: string;
  /** Secret input value; only sent when `secretAction` is 'replace'. */
  secret: string;
  secretAction: 'keep' | 'replace' | 'remove';
}

export interface IntegrationRow {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  hasSecret: boolean;
  updatedAt: string;
}

export const AI_KIND = 'AI_PROVIDER' as const;

export function aiFormFrom(row: IntegrationRow | null): AiFormState {
  const s = row?.settings ?? {};
  return {
    name: row?.name ?? '',
    enabled: row?.enabled ?? false,
    model: typeof s.model === 'string' ? s.model : '',
    baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
    maxTokens: typeof s.maxTokens === 'number' ? String(s.maxTokens) : '',
    secret: '',
    // A new integration with no key yet behaves like "replace" (the field is shown).
    secretAction: row?.hasSecret ? 'keep' : 'replace',
  };
}

export function aiPayload(f: AiFormState) {
  const settings: Record<string, string | number> = {};
  if (f.model.trim()) settings.model = f.model.trim();
  if (f.baseUrl.trim()) settings.baseUrl = f.baseUrl.trim();
  if (f.maxTokens.trim()) settings.maxTokens = Number(f.maxTokens.trim());
  const payload: {
    kind: typeof AI_KIND;
    name: string;
    enabled: boolean;
    settings: typeof settings;
    secret?: string;
  } = {
    kind: AI_KIND,
    name: f.name.trim().toLowerCase(),
    enabled: f.enabled,
    settings,
  };
  if (f.secretAction === 'remove') payload.secret = '';
  else if (f.secretAction === 'replace' && f.secret !== '') payload.secret = f.secret;
  return payload;
}

/** Client-side checks mirroring the integrations route (the server re-validates). */
export function validateAiForm(f: AiFormState): Record<string, string> {
  const e: Record<string, string> = {};
  const name = f.name.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(name)) e.name = 'Use lowercase letters, digits and dashes.';
  if (f.model.trim() && !/^[\w.:/-]{1,100}$/.test(f.model.trim()))
    e.model = 'Use a model id of up to 100 letters, digits, . : / _ or -.';
  if (f.baseUrl.trim() && !safeHttpsUrl(f.baseUrl.trim()))
    e.baseUrl = 'The base URL must be an https:// URL without credentials.';
  if (f.maxTokens.trim()) {
    const n = Number(f.maxTokens.trim());
    if (!Number.isInteger(n) || n < 1 || n > 32_000)
      e.maxTokens = 'Max tokens must be a whole number between 1 and 32000.';
  }
  if (f.secret.length > 4096) e.secret = 'The key is too long.';
  return e;
}
