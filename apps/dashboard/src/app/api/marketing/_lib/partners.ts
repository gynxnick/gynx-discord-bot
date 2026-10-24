import { z } from 'zod';
import { engagement, getGuildConfig, marketing } from '@gynx/services';
import { validation } from '@gynx/shared';
import { defineRoute } from '../../community/_lib/route-def';

/**
 * Partner API route definitions (bound in the sibling route.ts files).
 * All require `partners.review`; the services re-check, forbid reviewing
 * your own application, and require `settings.manage` to let a campaign announce.
 */

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/** GET /api/marketing/partners/applications?status=&category=&cursor=&limit= (oldest first). */
export const listPartnerApplications = defineRoute(
  { permission: 'partners.review', schema: marketing.listApplicationsSchema },
  async ({ ctx, input }) => marketing.listPartnerApplications(ctx, input),
);

/** GET /api/marketing/partners/applications/:id */
export const getPartnerApplication = defineRoute({ permission: 'partners.review' }, async ({ ctx, params }) =>
  marketing.getPartnerApplication(ctx, params.id ?? ''),
);

/** POST /api/marketing/partners/applications/:id/review/start — claim a PENDING application. */
export const startPartnerReview = defineRoute(
  { permission: 'partners.review', mutation: true },
  async ({ ctx, params }) => marketing.startPartnerReview(ctx, params.id ?? ''),
);

/** POST /api/marketing/partners/applications/:id/decision — approve (creates a campaign) or reject. */
export const decidePartnerApplication = defineRoute(
  { permission: 'partners.review', mutation: true, schema: marketing.decideApplicationSchema },
  async ({ ctx, input, params }) => marketing.decidePartnerApplication(ctx, params.id ?? '', input),
);

export const listCampaignsQuerySchema = marketing.listCampaignsSchema.extend({ active: boolParam });

/** GET /api/marketing/partners/campaigns?active=true|false&partnerId=&cursor=&limit= */
export const listPartnerCampaigns = defineRoute(
  { permission: 'partners.review', schema: listCampaignsQuerySchema },
  async ({ ctx, input }) => marketing.listPartnerCampaigns(ctx, input),
);

/**
 * Body for PATCH campaigns/:id. `endsAt` is either an ISO timestamp or a
 * guild-local wall-clock value ("YYYY-MM-DD HH:MM" / "YYYY-MM-DDTHH:MM"),
 * converted here with the guild time zone; null clears it.
 */
export const updateCampaignBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    active: z.boolean().optional(),
    endsAt: z.string().trim().min(1).max(40).nullable().optional(),
    canAnnounce: z.boolean().optional(),
  })
  .strict();

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;

/** PATCH /api/marketing/partners/campaigns/:id — name, active, end date, canAnnounce (enabling needs settings.manage). */
export const updatePartnerCampaign = defineRoute(
  { permission: 'partners.review', mutation: true, schema: updateCampaignBodySchema },
  async ({ ctx, input, params }) => {
    let endsAt: Date | null | undefined;
    if (input.endsAt === null) endsAt = null;
    else if (input.endsAt !== undefined) {
      if (WALL_CLOCK.test(input.endsAt))
        endsAt = engagement.parseEventTime(
          input.endsAt,
          (await getGuildConfig(ctx.db, ctx.guildId)).timezone,
        );
      else {
        endsAt = new Date(input.endsAt);
        if (Number.isNaN(endsAt.getTime())) throw validation('Enter a valid end date and time.');
      }
    }
    return marketing.updatePartnerCampaign(ctx, params.id ?? '', {
      name: input.name,
      active: input.active,
      canAnnounce: input.canAnnounce,
      ...(endsAt !== undefined ? { endsAt } : {}),
    });
  },
);

/** GET /api/marketing/partners/campaigns/:id/analytics — measured outcomes only. */
export const getPartnerCampaignAnalytics = defineRoute(
  { permission: 'partners.review' },
  async ({ ctx, params }) => marketing.partnerCampaignAnalytics(ctx, params.id ?? ''),
);
