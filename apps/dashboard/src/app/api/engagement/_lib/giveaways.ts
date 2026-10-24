import { z } from 'zod';
import { engagement, getGuildConfig } from '@gynx/services';
import { inputToWallClock } from '../../../../components/community/datetime';
import { defineRoute } from '../../community/_lib/route-def';
import { fieldIssue, reasonBodySchema, wallClockSchema } from './events';

/**
 * Giveaway API route definitions (giveaways.manage). Free community prizes
 * only — there is no paid entry anywhere. The end time arrives as guild
 * wall-clock and becomes the service's `durationMs` here.
 */

export const listGiveawaysQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED']).optional(),
});

/** GET /api/engagement/giveaways — entrant counts, no identities. */
export const listGiveaways = defineRoute(
  { permission: 'giveaways.manage', schema: listGiveawaysQuery },
  async ({ ctx, input }) => engagement.listGiveaways(ctx, input),
);

export const giveawayCreateBodySchema = engagement.createGiveawaySchema
  .omit({ durationMs: true })
  .extend({ endsAt: wallClockSchema })
  .strict();

/** Duration from now until a wall-clock end time in `tz`, within the service's 1 min..30 day range. */
export function giveawayDurationMs(endsAt: string, tz: string, now: Date): number {
  const end = engagement.parseEventTime(inputToWallClock(endsAt), tz);
  const ms = end.getTime() - now.getTime();
  if (ms < engagement.GIVEAWAY_MIN_DURATION_MS)
    fieldIssue('endsAt', 'The end time must be at least 1 minute from now.');
  if (ms > engagement.GIVEAWAY_MAX_DURATION_MS)
    fieldIssue('endsAt', 'Giveaways can run for at most 30 days.');
  return ms;
}

/** POST /api/engagement/giveaways */
export const createGiveaway = defineRoute(
  { permission: 'giveaways.manage', mutation: true, schema: giveawayCreateBodySchema },
  async ({ ctx, input }) => {
    const { timezone } = await getGuildConfig(ctx.db, ctx.guildId);
    const { endsAt, ...rest } = input;
    return engagement.createGiveaway(ctx, {
      ...rest,
      durationMs: giveawayDurationMs(endsAt, timezone, ctx.now()),
    });
  },
);

/** POST /api/engagement/giveaways/:id/end — ACTIVE only; performs the INITIAL draw. */
export const endGiveaway = defineRoute(
  { permission: 'giveaways.manage', mutation: true },
  async ({ ctx, params }) => engagement.endGiveaway(ctx, params.id ?? ''),
);

/** POST /api/engagement/giveaways/:id/cancel — ACTIVE or SCHEDULED. */
export const cancelGiveaway = defineRoute(
  { permission: 'giveaways.manage', mutation: true, schema: reasonBodySchema },
  async ({ ctx, input, params }) =>
    engagement.cancelGiveaway(ctx, params.id ?? '', input.reason || undefined),
);

/** POST /api/engagement/giveaways/:id/reroll — ENDED only; reason required. */
export const rerollGiveaway = defineRoute(
  { permission: 'giveaways.manage', mutation: true, schema: engagement.rerollSchema },
  async ({ ctx, input, params }) => engagement.rerollGiveaway(ctx, params.id ?? '', input),
);

/** GET /api/engagement/giveaways/:id/audit — every draw re-verified against stored entries. */
export const getGiveawayAudit = defineRoute({ permission: 'giveaways.manage' }, async ({ ctx, params }) =>
  engagement.getGiveawayAudit(ctx, params.id ?? ''),
);
