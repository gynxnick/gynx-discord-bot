import { support } from '@gynx/services';
import { defineRoute } from '../settings/define-route';

/** GET /api/support/profiles: approved public names + who is on duty (support.duty.manage). */
export const listDuty = defineRoute({ permission: 'support.duty.manage' }, async ({ ctx }) => ({
  profiles: await support.listDutyProfiles(ctx),
  onDuty: await support.listOnDuty(ctx.db, ctx.guildId, ctx.now()),
}));

/** POST /api/support/profiles: approve or rename a public name, or disable it. */
export const setProfile = defineRoute(
  { permission: 'support.duty.manage', mutation: true, schema: support.dutyProfileSchema },
  async ({ ctx, input }) => support.setDutyProfile(ctx, input),
);

/** DELETE /api/support/profiles/:userId: remove the name (ends any active session). */
export const removeProfile = defineRoute(
  { permission: 'support.duty.manage', mutation: true },
  async ({ ctx, params }) => {
    await support.removeDutyProfile(ctx, params.userId ?? '');
    return { ok: true };
  },
);

/** POST /api/support/sessions/:userId/end: end someone's duty session. */
export const endSession = defineRoute(
  { permission: 'support.duty.manage', mutation: true },
  async ({ ctx, params }) => ({ name: await support.endDutyFor(ctx, params.userId ?? '') }),
);
