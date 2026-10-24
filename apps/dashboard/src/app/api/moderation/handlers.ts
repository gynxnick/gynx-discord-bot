import { z } from 'zod';
import { moderation } from '@gynx/services';
import { defineRoute } from '../settings/define-route';

/**
 * Moderation API. Routes with any-of requirements declare `dashboard.access`
 * and the service enforces + audits the any-of check.
 *
 * Dashboard-initiated UNBAN / UNTIMEOUT are intentionally NOT exposed: they
 * need a Discord call and the shared DiscordPort has no unban/timeout method
 * (and UNTIMEOUT requires gateway hierarchy facts the dashboard does not have).
 */

const id = (params: Record<string, string>) => params.id ?? '';
const queryBool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

// ── Records ──────────────────────────────────────────────────────────────────

/** GET /api/moderation/records — any of moderation.audit.view / moderation.execute. Notes only with audit.view. */
export const searchRecordsRoute = defineRoute(
  { permission: 'dashboard.access', schema: moderation.searchActionsSchema },
  async ({ ctx, input }) => moderation.searchActions(ctx, input),
);

/** GET /api/moderation/records/:id (id or M-ref). */
export const getRecordRoute = defineRoute({ permission: 'dashboard.access' }, async ({ ctx, params }) =>
  moderation.getAction(ctx, id(params)),
);

export const noteBody = z.object({ note: z.string().trim().max(1000).nullable() });

/** PUT /api/moderation/records/:id/note { note | null } (moderation.audit.view). */
export const setNoteRoute = defineRoute(
  { permission: 'moderation.audit.view', schema: noteBody, mutation: true },
  async ({ ctx, input, params }) =>
    moderation.setModeratorNote(ctx, id(params), input.note ? input.note : null),
);

// ── Warnings ─────────────────────────────────────────────────────────────────

export const warningsQuery = z.object({
  userId: z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID'),
  includeInactive: queryBool,
});

/** GET /api/moderation/warnings?userId= (moderation.audit.view). */
export const listWarningsRoute = defineRoute(
  { permission: 'moderation.audit.view', schema: warningsQuery },
  async ({ ctx, input }) => {
    const summary = await moderation.getWarningSummary(ctx, input.userId);
    const all = input.includeInactive
      ? await moderation.listWarnings(ctx, input.userId, { includeInactive: true })
      : null;
    return { ...summary, all };
  },
);

export const revokeBody = z.object({
  reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(512),
});

/** POST /api/moderation/warnings/:id/revoke { reason } (moderation.execute). */
export const revokeWarningRoute = defineRoute(
  { permission: 'moderation.execute', schema: revokeBody },
  async ({ ctx, input, params }) => moderation.revokeWarning(ctx, id(params), input.reason),
);

// ── Automod ──────────────────────────────────────────────────────────────────

/** GET /api/moderation/automod/config (automod.manage). */
export const getAutomodConfigRoute = defineRoute({ permission: 'automod.manage' }, async ({ ctx }) =>
  moderation.getAutomodConfig(ctx),
);

/** PATCH /api/moderation/automod/config — partial update (automod.manage). */
export const updateAutomodConfigRoute = defineRoute(
  { permission: 'automod.manage', schema: moderation.automodConfigUpdateSchema },
  async ({ ctx, input }) => moderation.updateAutomodConfig(ctx, input),
);

export const automodEventsQuery = moderation.listAutomodEventsSchema.extend({ unreviewed: queryBool });

/** GET /api/moderation/automod/events — any of automod.manage / moderation.audit.view. */
export const listAutomodEventsRoute = defineRoute(
  { permission: 'dashboard.access', schema: automodEventsQuery },
  async ({ ctx, input }) => moderation.listAutomodEvents(ctx, input),
);

export const reviewEventBody = z.object({ falsePositive: z.boolean() });

/** POST /api/moderation/automod/events/:id/review { falsePositive } (automod.manage). */
export const reviewAutomodEventRoute = defineRoute(
  { permission: 'automod.manage', schema: reviewEventBody },
  async ({ ctx, input, params }) => moderation.reviewAutomodEvent(ctx, id(params), input.falsePositive),
);

// ── Appeals ──────────────────────────────────────────────────────────────────

/** GET /api/moderation/appeals — any of moderation.execute / moderation.ban / moderation.audit.view. */
export const listAppealsRoute = defineRoute(
  { permission: 'dashboard.access', schema: moderation.listAppealsSchema },
  async ({ ctx, input }) => moderation.listAppeals(ctx, input),
);

/**
 * POST /api/moderation/appeals/:id/review { decision, note? }. The service
 * requires moderation.ban for ban appeals and moderation.execute otherwise.
 * `requiresManualReversal` tells staff to lift a timeout/ban in Discord.
 */
export const reviewAppealRoute = defineRoute(
  { permission: 'dashboard.access', mutation: true, schema: moderation.reviewAppealSchema },
  async ({ ctx, input, params }) => moderation.reviewAppeal(ctx, id(params), input),
);
