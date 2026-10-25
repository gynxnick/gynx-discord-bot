import { z } from 'zod';
import { community } from '@gynx/services';
import { defineRoute } from './route-def';

/** Role panels: public self-role button messages (community.manage). */
export const listRolePanels = defineRoute({ permission: 'community.manage' }, async ({ ctx }) => ({
  items: await community.listRolePanels(ctx),
}));

export const createRolePanel = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.rolePanelCreateSchema },
  async ({ ctx, input }) => community.createRolePanel(ctx, input),
);

export const updateRolePanel = defineRoute(
  { permission: 'community.manage', mutation: true, schema: community.rolePanelUpdateSchema },
  async ({ ctx, input, params }) => community.updateRolePanel(ctx, params.id ?? '', input),
);

export const deleteRolePanel = defineRoute(
  { permission: 'community.manage', mutation: true },
  async ({ ctx, params }) => {
    await community.deleteRolePanel(ctx, params.id ?? '');
    return { ok: true };
  },
);

export const refreshRolePanels = defineRoute(
  {
    permission: 'community.manage',
    mutation: true,
    schema: z.object({ id: z.string().min(1).max(40).optional() }).strict(),
    rateLimit: { limit: 10, windowSeconds: 60, key: 'rolepanel-refresh' },
  },
  async ({ ctx, input }) => ({ queued: await community.refreshRolePanels(ctx, input.id) }),
);
