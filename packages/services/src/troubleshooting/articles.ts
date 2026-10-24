import { z } from 'zod';
import { isUniqueViolation, type KnowledgeArticle, type Prisma } from '@gynx/database';
import { conflict, cursorArgs, notFound, paginationSchema, redactSecrets, toPage, type Page } from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { gameKeySchema } from './common';
import { slugSchema } from './flow-definition';

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https:\/\//i.test(u), 'Links must use https://');

export const articleInputSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(300),
  body: z.string().trim().min(20).max(6000),
  game: gameKeySchema.nullish(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(32)).max(10).default([]),
  url: httpsUrl.nullish(),
  published: z.boolean().default(false),
});
export type ArticleInput = z.input<typeof articleInputSchema>;
export const articleUpdateSchema = articleInputSchema.partial();

function clean<T extends Partial<z.infer<typeof articleInputSchema>>>(a: T): T {
  // Staff text is stored; scrub accidental credentials just in case.
  return {
    ...a,
    ...(a.title !== undefined ? { title: redactSecrets(a.title, { maskIps: false, keepEmails: true }) } : {}),
    ...(a.summary !== undefined ? { summary: redactSecrets(a.summary, { maskIps: false, keepEmails: true }) } : {}),
    ...(a.body !== undefined ? { body: redactSecrets(a.body, { maskIps: false, keepEmails: true }) } : {}),
    ...(a.tags !== undefined ? { tags: [...new Set(a.tags)] } : {}),
  };
}

export async function createArticle(ctx: Ctx, raw: ArticleInput): Promise<KnowledgeArticle> {
  await requirePermission(ctx, 'troubleshooting.manage', 'troubleshooting.article.create');
  const input = clean(articleInputSchema.parse(raw));
  try {
    return await ctx.db.$transaction(async (tx) => {
      const a = await tx.knowledgeArticle.create({
        data: { ...input, game: input.game ?? null, url: input.url ?? null, guildId: ctx.guildId },
      });
      await audit(ctx, { action: 'troubleshooting.article.create', targetType: 'KnowledgeArticle', targetId: a.id, metadata: { slug: a.slug, published: a.published } }, tx);
      return a;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`An article with the slug "${input.slug}" already exists.`);
    throw e;
  }
}

async function loadManaged(ctx: Ctx, id: string): Promise<KnowledgeArticle> {
  const a = await ctx.db.knowledgeArticle.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!a) throw notFound('Article');
  return a;
}

export async function updateArticle(ctx: Ctx, id: string, raw: z.input<typeof articleUpdateSchema>): Promise<KnowledgeArticle> {
  await requirePermission(ctx, 'troubleshooting.manage', 'troubleshooting.article.update');
  const input = clean(articleUpdateSchema.parse(raw));
  const existing = await loadManaged(ctx, id);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const a = await tx.knowledgeArticle.update({ where: { id: existing.id }, data: input });
      await audit(ctx, { action: 'troubleshooting.article.update', targetType: 'KnowledgeArticle', targetId: a.id, metadata: { slug: a.slug, fields: Object.keys(input) } }, tx);
      return a;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`An article with the slug "${input.slug}" already exists.`);
    throw e;
  }
}

export async function setArticlePublished(ctx: Ctx, id: string, published: boolean): Promise<KnowledgeArticle> {
  return updateArticle(ctx, id, { published });
}

export async function deleteArticle(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'troubleshooting.manage', 'troubleshooting.article.delete');
  const a = await loadManaged(ctx, id);
  await ctx.db.$transaction(async (tx) => {
    await tx.knowledgeArticle.delete({ where: { id: a.id } });
    await audit(ctx, { action: 'troubleshooting.article.delete', targetType: 'KnowledgeArticle', targetId: a.id, metadata: { slug: a.slug } }, tx);
  });
}

export const listArticlesSchema = paginationSchema.extend({
  game: gameKeySchema.optional(),
  published: z.boolean().optional(),
});

/** Staff listing including drafts. */
export async function listArticles(ctx: Ctx, raw: z.input<typeof listArticlesSchema> = {}): Promise<Page<KnowledgeArticle>> {
  await requirePermission(ctx, 'troubleshooting.manage');
  const f = listArticlesSchema.parse(raw);
  const rows = await ctx.db.knowledgeArticle.findMany({
    where: { guildId: ctx.guildId, game: f.game, published: f.published },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

/** Get by id or slug. Drafts are only visible to `troubleshooting.manage`. */
export async function getArticle(ctx: Ctx, idOrSlug: string): Promise<KnowledgeArticle> {
  await requireModule(ctx, 'troubleshooting');
  const key = z.string().trim().min(1).max(64).parse(idOrSlug);
  const a = await ctx.db.knowledgeArticle.findFirst({ where: { guildId: ctx.guildId, OR: [{ id: key }, { slug: key }] } });
  if (!a || (!a.published && !can(ctx, 'troubleshooting.manage'))) throw notFound('Article');
  return a;
}

/** Fetch an article for display and count the view. */
export async function viewArticle(ctx: Ctx, idOrSlug: string): Promise<KnowledgeArticle> {
  const a = await getArticle(ctx, idOrSlug);
  if (!a.published) return a;
  return ctx.db.knowledgeArticle.update({ where: { id: a.id }, data: { views: { increment: 1 } } });
}

/** Members rate an article once per day per article. */
export async function voteArticle(ctx: Ctx, id: string, helpful: boolean): Promise<{ helpfulYes: number; helpfulNo: number }> {
  const a = await getArticle(ctx, id);
  if (!a.published) throw notFound('Article');
  await requireRate(ctx, 'troubleshooting.vote', 20, 3600);
  const once = await ctx.rateLimiter.consume(`${ctx.guildId}:${ctx.actor.userId}:kbvote:${a.id}`, 1, 86_400);
  if (!once.allowed) throw conflict('You already rated this article. Thanks for the feedback!');
  const updated = await ctx.db.knowledgeArticle.update({
    where: { id: a.id },
    data: helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } },
    select: { helpfulYes: true, helpfulNo: true },
  });
  return updated;
}

// ───────────────────────────── Search ─────────────────────────────

export const searchArticlesSchema = z.object({
  query: z.string().trim().min(2, 'Search for at least 2 characters.').max(100),
  game: gameKeySchema.optional(),
  /** Offset cursor (results are ranked, not id-ordered). */
  cursor: z.string().regex(/^\d{1,4}$/).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(5),
  includeDrafts: z.boolean().default(false),
});

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'my', 'is', 'to', 'a', 'an', 'of', 'on', 'in', 'it', 'i', 'cant', "can't", 'how', 'why', 'what', 'can', 'not', 'dont', 'doesnt', 'wont', 'help']);

export function tokenize(q: string): string[] {
  const terms = q
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  return [...new Set(terms)].slice(0, 8);
}

type Scorable = Pick<KnowledgeArticle, 'title' | 'summary' | 'body' | 'tags' | 'game' | 'helpfulYes' | 'helpfulNo' | 'views'>;

/** Weighted relevance: title ≫ tags > summary > body, plus game match and helpfulness. Pure. */
export function scoreArticle(a: Scorable, terms: readonly string[], phrase: string, game?: string): number {
  if (terms.length === 0) return 0;
  const title = a.title.toLowerCase();
  const summary = a.summary.toLowerCase();
  const body = a.body.toLowerCase();
  const tags = a.tags.map((t) => t.toLowerCase());
  let score = 0;
  let matchedTerms = 0;
  for (const t of terms) {
    let s = 0;
    if (title.includes(t)) s += 10;
    if (tags.some((tag) => tag === t)) s += 6;
    else if (tags.some((tag) => tag.includes(t))) s += 3;
    if (summary.includes(t)) s += 4;
    if (body.includes(t)) s += 1 + Math.min(2, body.split(t).length - 2);
    if (s > 0) matchedTerms++;
    score += s;
  }
  if (score === 0) return 0;
  score += (matchedTerms / terms.length) * 10; // prefer articles matching all terms
  const p = phrase.toLowerCase().trim();
  if (p.length > 3 && (title.includes(p) || summary.includes(p))) score += 8;
  if (game && a.game === game) score += 5;
  const votes = a.helpfulYes + a.helpfulNo;
  if (votes >= 3) score += (a.helpfulYes / votes - 0.5) * 4;
  return Math.round(score * 100) / 100;
}

export interface SearchHit {
  article: KnowledgeArticle;
  score: number;
}

export async function searchArticles(ctx: Ctx, raw: z.input<typeof searchArticlesSchema>): Promise<{ items: SearchHit[]; nextCursor: string | null; total: number }> {
  await requireModule(ctx, 'troubleshooting');
  const f = searchArticlesSchema.parse(raw);
  const drafts = f.includeDrafts && can(ctx, 'troubleshooting.manage');
  const terms = tokenize(f.query);
  if (terms.length === 0) return { items: [], nextCursor: null, total: 0 };

  const ci = (field: 'title' | 'summary' | 'body', t: string): Prisma.KnowledgeArticleWhereInput => ({ [field]: { contains: t, mode: 'insensitive' } });
  const rows = await ctx.db.knowledgeArticle.findMany({
    where: {
      guildId: ctx.guildId,
      ...(drafts ? {} : { published: true }),
      // A game filter keeps general (game = null) articles too.
      ...(f.game ? { AND: [{ OR: [{ game: f.game }, { game: null }] }] } : {}),
      OR: [...terms.flatMap((t) => [ci('title', t), ci('summary', t), ci('body', t)]), { tags: { hasSome: terms } }],
    },
    take: 200,
    orderBy: { id: 'asc' },
  });
  const ranked = rows
    .map((article) => ({ article, score: scoreArticle(article, terms, f.query, f.game) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.article.views - a.article.views || a.article.id.localeCompare(b.article.id));
  const offset = f.cursor ? Number(f.cursor) : 0;
  const items = ranked.slice(offset, offset + f.limit);
  const next = offset + f.limit < ranked.length ? String(offset + f.limit) : null;
  return { items, nextCursor: next, total: ranked.length };
}

/** Title autocomplete for /knowledge-search (published only, ≤ 25). */
export async function autocompleteArticles(ctx: Ctx, prefix: string, game?: string): Promise<Array<{ slug: string; title: string }>> {
  await requireModule(ctx, 'troubleshooting');
  const q = prefix.trim().slice(0, 100);
  const g = game ? gameKeySchema.safeParse(game) : undefined;
  return ctx.db.knowledgeArticle.findMany({
    where: {
      guildId: ctx.guildId,
      published: true,
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      ...(g?.success ? { OR: [{ game: g.data }, { game: null }] } : {}),
    },
    select: { slug: true, title: true },
    orderBy: [{ views: 'desc' }, { title: 'asc' }],
    take: 25,
  });
}
