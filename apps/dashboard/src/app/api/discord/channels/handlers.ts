import { defineRoute } from '../../settings/define-route';
import { listGuildChannels } from './channels';

/**
 * GET /api/discord/channels — text, announcement and category channels for
 * pickers. Any signed-in staff member (several sections need channel pickers);
 * cached for 60s and rate limited per session.
 */
export const listChannelsRoute = defineRoute(
  { permission: 'dashboard.access', rateLimit: { limit: 20, windowSeconds: 60, key: 'channels' } },
  async ({ ctx }) => ({
    channels: await listGuildChannels(ctx.discord, ctx.guildId),
  }),
);
