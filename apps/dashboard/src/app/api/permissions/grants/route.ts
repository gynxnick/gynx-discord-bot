import { getGuildConfig, grantInputSchema, listGrants, upsertGrant } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** GET /api/permissions/grants (settings.manage). */
export const GET = apiRoute({ permission: 'settings.manage' }, async ({ ctx }) => ({
  grants: await listGrants(ctx),
}));

/**
 * POST /api/permissions/grants { subjectType, subjectId, permission, effect } (permissions.manage).
 * Anti-escalation (cannot grant what you don't hold; no privileged keys for the partner role) is enforced by the service.
 */
export const POST = apiRoute(
  { permission: 'permissions.manage', schema: grantInputSchema },
  async ({ ctx, input }) => {
    const cfg = await getGuildConfig(ctx.db, ctx.guildId);
    return { grant: await upsertGrant(ctx, input, cfg.partnerRoleId) };
  },
);
