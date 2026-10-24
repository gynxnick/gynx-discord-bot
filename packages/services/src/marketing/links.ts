import { z } from 'zod';
import { isUniqueViolation, type Db, type TrackedLink } from '@gynx/database';
import { cursorArgs, notFound, paginationSchema, toPage, type Page } from '@gynx/shared';
import { audit } from '../core/audit';
import { requireAny } from '../core/authz';
import type { Ctx } from '../core/context';
import { publicHttpsUrl, publicHttpsUrlProblem, randomBase62, SLUG_RE } from './common';

export const createTrackedLinkSchema = z.object({
  targetUrl: publicHttpsUrl,
  campaign: z.string().trim().min(1).max(64).optional(),
  announcementId: z.string().min(1).max(64).optional(),
  partnerCampaignId: z.string().min(1).max(64).optional(),
});
export type CreateTrackedLinkInput = z.input<typeof createTrackedLinkSchema>;

const LINK_MANAGERS = ['announcements.create', 'partners.review', 'referrals.manage'] as const;

/**
 * Create a tracked redirect (`/r/<slug>` on the dashboard). Only a click
 * counter is kept — no IP addresses, user agents or other visitor data.
 */
export async function createTrackedLink(ctx: Ctx, raw: CreateTrackedLinkInput): Promise<TrackedLink> {
  await requireAny(ctx, LINK_MANAGERS, 'marketing.link.create');
  const input = createTrackedLinkSchema.parse(raw);
  if (input.announcementId) {
    const a = await ctx.db.announcement.findFirst({ where: { id: input.announcementId, guildId: ctx.guildId }, select: { id: true } });
    if (!a) throw notFound('Announcement');
  }
  if (input.partnerCampaignId) {
    const c = await ctx.db.partnerCampaign.findFirst({ where: { id: input.partnerCampaignId, guildId: ctx.guildId }, select: { id: true } });
    if (!c) throw notFound('Partner campaign');
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await ctx.db.$transaction(async (tx) => {
        const link = await tx.trackedLink.create({
          data: {
            guildId: ctx.guildId,
            slug: randomBase62(8),
            targetUrl: input.targetUrl,
            campaign: input.campaign ?? null,
            announcementId: input.announcementId ?? null,
            partnerCampaignId: input.partnerCampaignId ?? null,
            createdById: ctx.actor.userId,
          },
        });
        await audit(ctx, { action: 'marketing.link.create', targetType: 'TrackedLink', targetId: link.id, metadata: { slug: link.slug, host: new URL(link.targetUrl).hostname, campaign: link.campaign } }, tx);
        return link;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // slug collision → retry with a new slug
    }
  }
  throw new Error('Could not allocate a unique link slug');
}

export const listTrackedLinksSchema = paginationSchema.extend({
  campaign: z.string().trim().max(64).optional(),
  announcementId: z.string().max(64).optional(),
  partnerCampaignId: z.string().max(64).optional(),
});

export async function listTrackedLinks(ctx: Ctx, raw: z.input<typeof listTrackedLinksSchema> = {}): Promise<Page<TrackedLink>> {
  await requireAny(ctx, [...LINK_MANAGERS, 'analytics.view', 'referrals.view']);
  const f = listTrackedLinksSchema.parse(raw);
  const rows = await ctx.db.trackedLink.findMany({
    where: { guildId: ctx.guildId, campaign: f.campaign, announcementId: f.announcementId, partnerCampaignId: f.partnerCampaignId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

export async function setTrackedLinkActive(ctx: Ctx, id: string, active: boolean): Promise<TrackedLink> {
  await requireAny(ctx, LINK_MANAGERS, 'marketing.link.update');
  const link = await ctx.db.trackedLink.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!link) throw notFound('Link');
  return ctx.db.$transaction(async (tx) => {
    const l = await tx.trackedLink.update({ where: { id }, data: { active } });
    await audit(ctx, { action: 'marketing.link.update', targetType: 'TrackedLink', targetId: id, metadata: { active } }, tx);
    return l;
  });
}

/**
 * Public redirect resolution. Atomically increments the click counter and
 * returns the target, or null for unknown/inactive slugs. Stores nothing about
 * the visitor. The target is re-validated in case validation rules tightened.
 */
export async function resolveTrackedLink(db: Db, slug: string): Promise<string | null> {
  if (!SLUG_RE.test(slug)) return null;
  try {
    const link = await db.trackedLink.update({
      where: { slug, active: true },
      data: { clicks: { increment: 1 } },
      select: { targetUrl: true },
    });
    return publicHttpsUrlProblem(link.targetUrl) ? null : link.targetUrl;
  } catch (e) {
    if ((e as { code?: string }).code === 'P2025') return null; // not found / inactive
    throw e;
  }
}
