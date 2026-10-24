import { z } from 'zod';
import { marketing } from '@gynx/services';
import { trackedLinkUrl } from '../../../../components/marketing/links/link-utils';
import { defineRoute } from '../../community/_lib/route-def';

/**
 * Tracked-link API route definitions (bound in /api/marketing/links/**).
 *
 * Permission limitation: the service accepts any of `announcements.create`,
 * `partners.review` or `referrals.manage`, but `apiRoute` takes one key, so
 * these routes declare `announcements.create`. Staff who only hold
 * `partners.review` / `referrals.manage` can view the server-rendered
 * /marketing/links page but cannot use these endpoints until `apiRoute`
 * supports any-of permissions.
 *
 * Only a click counter is stored per link — no visitor data.
 */

const withUrl = <T extends { slug: string }>(dashboardUrl: string | undefined, link: T) => ({
  ...link,
  url: trackedLinkUrl(dashboardUrl, link.slug),
});

/** GET /api/marketing/links?campaign=&announcementId=&partnerCampaignId=&cursor=&limit= */
export const listTrackedLinks = defineRoute(
  {
    permission: [
      'announcements.create',
      'partners.review',
      'referrals.manage',
      'referrals.view',
      'analytics.view',
    ],
    schema: marketing.listTrackedLinksSchema,
  },
  async ({ ctx, input }) => {
    const page = await marketing.listTrackedLinks(ctx, input);
    return { ...page, items: page.items.map((l) => withUrl(ctx.dashboardUrl, l)) };
  },
);

/** POST /api/marketing/links `{ targetUrl, campaign?, announcementId?, partnerCampaignId? }` */
export const createTrackedLink = defineRoute(
  {
    permission: ['announcements.create', 'partners.review', 'referrals.manage'],
    mutation: true,
    schema: marketing.createTrackedLinkSchema,
  },
  async ({ ctx, input }) => withUrl(ctx.dashboardUrl, await marketing.createTrackedLink(ctx, input)),
);

export const setTrackedLinkActiveBody = z.object({ active: z.boolean() }).strict();

/** PATCH /api/marketing/links/:id `{ active }` */
export const setTrackedLinkActive = defineRoute(
  {
    permission: ['announcements.create', 'partners.review', 'referrals.manage'],
    mutation: true,
    schema: setTrackedLinkActiveBody,
  },
  async ({ ctx, input, params }) =>
    withUrl(ctx.dashboardUrl, await marketing.setTrackedLinkActive(ctx, params.id ?? '', input.active)),
);
