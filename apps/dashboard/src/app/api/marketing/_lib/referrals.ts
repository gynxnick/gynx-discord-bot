import { z } from 'zod';
import { marketing } from '@gynx/services';
import { defineRoute } from '../../community/_lib/route-def';

/**
 * Referral API route definitions (bound in the sibling route.ts files).
 * The read routes declare `referrals.view` (the services accept
 * `referrals.view` OR `referrals.manage` and re-check); review needs
 * `referrals.manage`.
 */

export const leaderboardQuerySchema = z.object({
  period: z.enum(marketing.LEADERBOARD_PERIODS).default('30'),
});

/** GET /api/marketing/referrals/leaderboard?period=7|30|all — counted = CONFIRMED + VALID only. */
export const getReferralLeaderboard = defineRoute(
  { permission: ['referrals.view', 'referrals.manage'], schema: leaderboardQuerySchema },
  async ({ ctx, input }) => ({
    period: input.period,
    items: await marketing.referralLeaderboard(ctx, input.period),
  }),
);

/** GET /api/marketing/referrals/attributions?status=&confidence=&referrerId=&campaign=&cursor=&limit= */
export const listReferralAttributions = defineRoute(
  { permission: ['referrals.view', 'referrals.manage'], schema: marketing.listAttributionsSchema },
  async ({ ctx, input }) => marketing.listAttributions(ctx, input),
);

/** GET /api/marketing/referrals/invites?ownerId=&campaign=&partnerCampaignId=&cursor=&limit= */
export const listReferralInvites = defineRoute(
  { permission: ['referrals.view', 'referrals.manage'], schema: marketing.listInvitesSchema },
  async ({ ctx, input }) => marketing.listReferralInvites(ctx, input),
);

/** POST /api/marketing/referrals/attributions/:id/review — VALID / INVALID / DISPUTED + note. */
export const reviewAttribution = defineRoute(
  { permission: 'referrals.manage', mutation: true, schema: marketing.reviewAttributionSchema },
  async ({ ctx, input, params }) => marketing.reviewAttribution(ctx, params.id ?? '', input),
);
