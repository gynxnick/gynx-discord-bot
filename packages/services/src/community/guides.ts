import { z } from 'zod';
import { isUniqueViolation, type Guide, type Prisma } from '@gynx/database';
import { conflict, cursorArgs, notFound, paginationSchema, toPage, validation, type Page } from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { httpsUrlSchema, pageSchema, slugify, slugSchema, type OffsetPage } from './schemas';

export const guideSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  category: z.string().trim().min(1).max(30),
  summary: z.string().trim().min(1).max(500),
  url: httpsUrlSchema,
  game: z.string().trim().min(1).max(30).nullish(),
  published: z.boolean().default(false),
});
export type GuideInput = z.input<typeof guideSchema>;

export async function createGuide(ctx: Ctx, raw: GuideInput): Promise<Guide> {
  await requirePermission(ctx, 'community.manage', 'community.guide.create');
  const input = guideSchema.parse(raw);
  const slug = input.slug ?? slugify(input.title);
  if (!slug) throw validation('Choose a slug using letters or numbers.');
  try {
    return await ctx.db.$transaction(async (tx) => {
      const row = await tx.guide.create({ data: { ...input, slug, game: input.game ?? null, guildId: ctx.guildId } });
      await audit(ctx, { action: 'community.guide.create', targetType: 'Guide', targetId: row.id, metadata: { slug, published: row.published } }, tx);
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A guide with that slug already exists.');
    throw e;
  }
}

export async function updateGuide(ctx: Ctx, id: string, raw: Partial<GuideInput>): Promise<Guide> {
  await requirePermission(ctx, 'community.manage', 'community.guide.update');
  const input = guideSchema.partial().strict().parse(raw);
  const row = await ctx.db.guide.findFirst({ where: { id, guildId: ctx.guildId }, select: { id: true } });
  if (!row) throw notFound('Guide');
  try {
    return await ctx.db.$transaction(async (tx) => {
      const updated = await tx.guide.update({ where: { id }, data: input });
      await audit(ctx, { action: 'community.guide.update', targetType: 'Guide', targetId: id, metadata: { fields: Object.keys(input), published: updated.published } }, tx);
      return updated;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('A guide with that slug already exists.');
    throw e;
  }
}

export async function deleteGuide(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'community.manage', 'community.guide.delete');
  const row = await ctx.db.guide.findFirst({ where: { id, guildId: ctx.guildId }, select: { id: true, slug: true } });
  if (!row) throw notFound('Guide');
  await ctx.db.$transaction(async (tx) => {
    await tx.guide.delete({ where: { id } });
    await audit(ctx, { action: 'community.guide.delete', targetType: 'Guide', targetId: id, metadata: { slug: row.slug } }, tx);
  });
}

/** Dashboard listing including drafts. */
export async function listAllGuides(ctx: Ctx, raw: z.input<typeof paginationSchema>): Promise<Page<Guide>> {
  await requirePermission(ctx, 'community.manage');
  const f = paginationSchema.parse(raw);
  const rows = await ctx.db.guide.findMany({ where: { guildId: ctx.guildId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...cursorArgs(f) });
  return toPage(rows, f.limit);
}

export const listGuidesSchema = pageSchema.extend({
  category: z.string().trim().min(1).max(30).optional(),
  game: z.string().trim().min(1).max(30).optional(),
});

/** Member-facing list: published guides only, filters are case-insensitive. */
export async function listGuides(ctx: Ctx, raw: z.input<typeof listGuidesSchema>): Promise<OffsetPage<Guide>> {
  await requireModule(ctx, 'community');
  const f = listGuidesSchema.parse(raw);
  const where: Prisma.GuideWhereInput = {
    guildId: ctx.guildId,
    published: true,
    ...(f.category ? { category: { equals: f.category, mode: 'insensitive' } } : {}),
    ...(f.game ? { game: { equals: f.game, mode: 'insensitive' } } : {}),
  };
  const [total, items] = await Promise.all([
    ctx.db.guide.count({ where }),
    ctx.db.guide.findMany({
      where,
      orderBy: [{ category: 'asc' }, { title: 'asc' }, { id: 'asc' }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / f.pageSize));
  if (f.page > pageCount && total > 0) return listGuides(ctx, { ...f, page: pageCount });
  return { items, total, page: f.page, pageCount };
}

/** Distinct categories and games among published guides (autocomplete / filters). */
export async function guideFacets(ctx: Ctx): Promise<{ categories: string[]; games: string[] }> {
  await requireModule(ctx, 'community');
  const rows = await ctx.db.guide.findMany({ where: { guildId: ctx.guildId, published: true }, select: { category: true, game: true }, take: 1000 });
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return {
    categories: sort(new Set(rows.map((r) => r.category))),
    games: sort(new Set(rows.flatMap((r) => (r.game ? [r.game] : [])))),
  };
}

export async function getGuide(ctx: Ctx, id: string): Promise<Guide> {
  await requireModule(ctx, 'community');
  const row = await ctx.db.guide.findFirst({ where: { id, guildId: ctx.guildId, ...(can(ctx, 'community.manage') ? {} : { published: true }) } });
  if (!row) throw notFound('Guide');
  return row;
}

/** Count a guide view (at most once per user per guide per 10 minutes). */
export async function recordGuideView(ctx: Ctx, id: string): Promise<void> {
  await getGuide(ctx, id);
  const r = await ctx.rateLimiter.consume(`${ctx.guildId}:${ctx.actor.userId}:community.guide.view:${id}`, 1, 600);
  if (r.allowed) await ctx.db.guide.update({ where: { id }, data: { views: { increment: 1 } } });
}

export async function recordGuideFeedback(ctx: Ctx, id: string, helpful: boolean): Promise<Guide> {
  const g = await getGuide(ctx, id);
  if (!g.published) throw notFound('Guide');
  await requireRate(ctx, `community.guide.feedback:${id}`, 1, 86_400);
  return ctx.db.guide.update({ where: { id }, data: helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } } });
}

