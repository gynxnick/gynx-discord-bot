import { z } from 'zod';
import { isUniqueViolation, type FaqCategory, type FaqEntry, type Prisma } from '@gynx/database';
import {
  conflict,
  cursorArgs,
  notFound,
  paginationSchema,
  toPage,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { linksSchema, pageSchema, slugify, slugSchema, toOffsetPage, type OffsetPage } from './schemas';
import { rankFaqEntries, tokenize } from './search';

// ── Categories ───────────────────────────────────────────────────────────────

export const faqCategorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  slug: slugSchema.optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const cleanSlug = (name: string, slug?: string) => {
  const s = slug ?? slugify(name);
  if (!s) throw validation('Choose a slug using letters or numbers.');
  return s;
};

export type FaqCategoryWithCount = FaqCategory & { publishedCount: number };

/** Categories with the number of published entries (members see only categories that have any). */
export async function listFaqCategories(ctx: Ctx): Promise<FaqCategoryWithCount[]> {
  await requireModule(ctx, 'community');
  const cats = await ctx.db.faqCategory.findMany({
    where: { guildId: ctx.guildId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { entries: { where: { published: true } } } } },
  });
  const rows = cats.map(({ _count, ...c }) => ({ ...c, publishedCount: _count.entries }));
  return can(ctx, 'community.manage') ? rows : rows.filter((c) => c.publishedCount > 0);
}

export async function createFaqCategory(
  ctx: Ctx,
  raw: z.input<typeof faqCategorySchema>,
): Promise<FaqCategory> {
  await requirePermission(ctx, 'community.manage', 'community.faq.category.create');
  const input = faqCategorySchema.parse(raw);
  const slug = cleanSlug(input.name, input.slug);
  try {
    return await ctx.db.$transaction(async (tx) => {
      const row = await tx.faqCategory.create({
        data: { guildId: ctx.guildId, name: input.name, slug, sortOrder: input.sortOrder },
      });
      await audit(
        ctx,
        {
          action: 'community.faq.category.create',
          targetType: 'FaqCategory',
          targetId: row.id,
          metadata: { slug },
        },
        tx,
      );
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A category with that slug already exists.');
    throw e;
  }
}

export async function updateFaqCategory(
  ctx: Ctx,
  id: string,
  raw: Partial<z.input<typeof faqCategorySchema>>,
): Promise<FaqCategory> {
  await requirePermission(ctx, 'community.manage', 'community.faq.category.update');
  const input = faqCategorySchema.partial().strict().parse(raw);
  const row = await ctx.db.faqCategory.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!row) throw notFound('FAQ category');
  try {
    return await ctx.db.$transaction(async (tx) => {
      const updated = await tx.faqCategory.update({ where: { id }, data: input });
      await audit(
        ctx,
        {
          action: 'community.faq.category.update',
          targetType: 'FaqCategory',
          targetId: id,
          metadata: { fields: Object.keys(input) },
        },
        tx,
      );
      return updated;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A category with that slug already exists.');
    throw e;
  }
}

/** Deleting a category keeps its entries (they become uncategorised). */
export async function deleteFaqCategory(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'community.manage', 'community.faq.category.delete');
  const row = await ctx.db.faqCategory.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!row) throw notFound('FAQ category');
  await ctx.db.$transaction(async (tx) => {
    await tx.faqCategory.delete({ where: { id } });
    await audit(
      ctx,
      {
        action: 'community.faq.category.delete',
        targetType: 'FaqCategory',
        targetId: id,
        metadata: { slug: row.slug },
      },
      tx,
    );
  });
}

// ── Entries ──────────────────────────────────────────────────────────────────

const keywordsSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(20)
  .default([])
  .transform((k) => [...new Set(k)]);

export const faqEntrySchema = z.object({
  categoryId: z.string().min(1).max(64).nullish(),
  question: z.string().trim().min(5).max(200),
  answer: z.string().trim().min(1).max(4000),
  keywords: keywordsSchema,
  links: linksSchema,
  published: z.boolean().default(false),
});
export type FaqEntryInput = z.input<typeof faqEntrySchema>;

async function assertCategory(ctx: Ctx, categoryId: string | null | undefined): Promise<void> {
  if (!categoryId) return;
  const c = await ctx.db.faqCategory.findFirst({
    where: { id: categoryId, guildId: ctx.guildId },
    select: { id: true },
  });
  if (!c) throw notFound('FAQ category');
}

export async function createFaqEntry(ctx: Ctx, raw: FaqEntryInput): Promise<FaqEntry> {
  await requirePermission(ctx, 'community.manage', 'community.faq.create');
  const input = faqEntrySchema.parse(raw);
  await assertCategory(ctx, input.categoryId);
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.faqEntry.create({
      data: {
        ...input,
        categoryId: input.categoryId ?? null,
        guildId: ctx.guildId,
        updatedById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'community.faq.create',
        targetType: 'FaqEntry',
        targetId: row.id,
        metadata: { published: row.published },
      },
      tx,
    );
    return row;
  });
}

export async function updateFaqEntry(ctx: Ctx, id: string, raw: Partial<FaqEntryInput>): Promise<FaqEntry> {
  await requirePermission(ctx, 'community.manage', 'community.faq.update');
  const input = faqEntrySchema
    .extend({ keywords: keywordsSchema.optional(), links: linksSchema.optional() })
    .partial()
    .strict()
    .parse(raw);
  const row = await ctx.db.faqEntry.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!row) throw notFound('FAQ entry');
  await assertCategory(ctx, input.categoryId);
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.faqEntry.update({
      where: { id },
      data: { ...input, updatedById: ctx.actor.userId },
    });
    await audit(
      ctx,
      {
        action: 'community.faq.update',
        targetType: 'FaqEntry',
        targetId: id,
        metadata: { fields: Object.keys(input), published: updated.published },
      },
      tx,
    );
    return updated;
  });
}

export async function deleteFaqEntry(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'community.manage', 'community.faq.delete');
  const row = await ctx.db.faqEntry.findFirst({ where: { id, guildId: ctx.guildId }, select: { id: true } });
  if (!row) throw notFound('FAQ entry');
  await ctx.db.$transaction(async (tx) => {
    await tx.faqEntry.delete({ where: { id } });
    await audit(ctx, { action: 'community.faq.delete', targetType: 'FaqEntry', targetId: id }, tx);
  });
}

export const listFaqEntriesSchema = paginationSchema.extend({
  categoryId: z.string().min(1).max(64).optional(),
  published: z.boolean().optional(),
});

/** Dashboard listing (includes drafts). */
export async function listFaqEntries(
  ctx: Ctx,
  raw: z.input<typeof listFaqEntriesSchema>,
): Promise<Page<FaqEntry>> {
  await requirePermission(ctx, 'community.manage');
  const f = listFaqEntriesSchema.parse(raw);
  const rows = await ctx.db.faqEntry.findMany({
    where: { guildId: ctx.guildId, categoryId: f.categoryId, published: f.published },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

/** Visibility rule: members only ever see published entries. */
const visibleWhere = (ctx: Ctx, includeDrafts: boolean): Prisma.FaqEntryWhereInput => ({
  guildId: ctx.guildId,
  ...(includeDrafts && can(ctx, 'community.manage') ? {} : { published: true }),
});

export type FaqEntryWithCategory = FaqEntry & { category: FaqCategory | null };

/** Fetch a single entry (published only unless the caller manages community content). */
export async function getFaqEntry(
  ctx: Ctx,
  id: string,
  opts: { includeDrafts?: boolean } = {},
): Promise<FaqEntryWithCategory> {
  await requireModule(ctx, 'community');
  const row = await ctx.db.faqEntry.findFirst({
    where: { ...visibleWhere(ctx, opts.includeDrafts ?? false), id },
    include: { category: true },
  });
  if (!row) throw notFound('FAQ entry');
  return row;
}

/**
 * Show a published entry to a member and count the view. Views are counted at
 * most once per user per entry per 10 minutes so they can't be trivially inflated.
 */
export async function viewFaqEntry(ctx: Ctx, id: string): Promise<FaqEntryWithCategory> {
  const row = await getFaqEntry(ctx, id);
  const r = await ctx.rateLimiter.consume(
    `${ctx.guildId}:${ctx.actor.userId}:community.faq.view:${id}`,
    1,
    600,
  );
  if (r.allowed) {
    await ctx.db.faqEntry.update({ where: { id }, data: { views: { increment: 1 } } });
    row.views += 1;
  }
  return row;
}

export const faqSearchSchema = pageSchema.extend({
  query: z.string().trim().min(1).max(100),
  categoryId: z.string().min(1).max(64).optional(),
});

const SEARCH_CANDIDATES = 500;

/**
 * Case-insensitive keyword search over published entries, ranked
 * keyword hit > question hit > answer hit, then by views.
 */
export async function searchFaq(
  ctx: Ctx,
  raw: z.input<typeof faqSearchSchema>,
): Promise<OffsetPage<FaqEntry>> {
  await requireModule(ctx, 'community');
  const q = faqSearchSchema.parse(raw);
  const tokens = tokenize(q.query);
  if (tokens.length === 0) return { items: [], total: 0, page: 1, pageCount: 1 };
  const candidates = await ctx.db.faqEntry.findMany({
    where: {
      ...visibleWhere(ctx, false),
      categoryId: q.categoryId,
      OR: tokens.flatMap((t) => [
        { question: { contains: t, mode: 'insensitive' as const } },
        { answer: { contains: t, mode: 'insensitive' as const } },
        { keywords: { has: t } },
      ]),
    },
    take: SEARCH_CANDIDATES,
    orderBy: [{ views: 'desc' }, { id: 'asc' }],
  });
  // Keywords are stored lower-cased; partial keyword hits are scored in memory.
  return toOffsetPage(rankFaqEntries(candidates, q.query), q.page, q.pageSize);
}

/** Autocomplete: published questions matching the typed prefix (or most viewed when empty). */
export async function suggestFaqQuestions(
  ctx: Ctx,
  typed: string,
  limit = 25,
): Promise<Array<{ id: string; question: string }>> {
  const text = typed.trim().slice(0, 100);
  if (tokenize(text).length > 0) {
    const page = await searchFaq(ctx, { query: text, pageSize: Math.min(25, limit) });
    return page.items.map((e) => ({ id: e.id, question: e.question }));
  }
  const rows = await mostViewedFaq(ctx, limit);
  return rows.map((e) => ({ id: e.id, question: e.question }));
}

export async function mostViewedFaq(ctx: Ctx, limit = 5): Promise<FaqEntry[]> {
  await requireModule(ctx, 'community');
  return ctx.db.faqEntry.findMany({
    where: visibleWhere(ctx, false),
    orderBy: [{ views: 'desc' }, { updatedAt: 'desc' }],
    take: Math.min(Math.max(1, limit), 25),
  });
}

/** Published entries of a category (for browsing). */
export async function listPublishedFaqByCategory(
  ctx: Ctx,
  categoryId: string,
  limit = 25,
): Promise<FaqEntry[]> {
  await requireModule(ctx, 'community');
  return ctx.db.faqEntry.findMany({
    where: { ...visibleWhere(ctx, false), categoryId },
    orderBy: [{ views: 'desc' }, { id: 'asc' }],
    take: Math.min(Math.max(1, limit), 25),
  });
}

/** "Was this helpful?" — one vote per user per entry per day. */
export async function recordFaqFeedback(ctx: Ctx, id: string, helpful: boolean): Promise<FaqEntry> {
  await getFaqEntry(ctx, id);
  await requireRate(ctx, `community.faq.feedback:${id}`, 1, 86_400);
  return ctx.db.faqEntry.update({
    where: { id },
    data: helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } },
  });
}
