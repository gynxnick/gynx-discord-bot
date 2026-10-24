import { analytics } from '@gynx/services';
import { defineRoute } from './define-route';

/** GET /api/settings — current guild settings (settings.manage). */
export const getSettingsRoute = defineRoute({ permission: 'settings.manage' }, async ({ ctx }) =>
  analytics.getSettings(ctx),
);

/** PATCH /api/settings — partial update; only changed fields are sent (settings.manage, audited by the service). */
export const updateSettingsRoute = defineRoute(
  {
    permission: 'settings.manage',
    schema: analytics.settingsPatchSchema,
    rateLimit: { limit: 20, windowSeconds: 60, key: 'settings' },
  },
  async ({ ctx, input }) => analytics.updateSettings(ctx, input),
);
