import { apiRoute } from '@/server/api';
import { listGuildRoles } from '@/server/queries/roles';

export const dynamic = 'force-dynamic';

/** GET /api/discord/roles — role picker data (settings.manage). */
export const GET = apiRoute(
  { permission: 'settings.manage', rateLimit: { limit: 20, windowSeconds: 60, key: 'roles' } },
  async ({ ctx }) => ({
    roles: await listGuildRoles(ctx.discord, ctx.guildId),
  }),
);
