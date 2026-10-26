import { updates } from '@gynx/services';
import { defineRoute } from '../settings/define-route';

/** GET /api/updates/repos: tracked GitHub repositories (updates.manage). */
export const listReposRoute = defineRoute({ permission: 'updates.manage' }, async ({ ctx }) => ({
  repos: await updates.listRepos(ctx),
}));

/** POST /api/updates/repos: add a repository. */
export const createRepoRoute = defineRoute(
  { permission: 'updates.manage', mutation: true, schema: updates.repoInputSchema },
  async ({ ctx, input }) => ({ repo: await updates.upsertRepo(ctx, input) }),
);

/** PATCH /api/updates/repos/:id: edit a repository (name, colour, branch, switches). */
export const updateRepoRoute = defineRoute(
  { permission: 'updates.manage', mutation: true, schema: updates.repoInputSchema },
  async ({ ctx, input, params }) => ({ repo: await updates.upsertRepo(ctx, { ...input, id: params.id }) }),
);

/** DELETE /api/updates/repos/:id: stop tracking a repository (its delivery history is removed). */
export const deleteRepoRoute = defineRoute(
  { permission: 'updates.manage', mutation: true },
  async ({ ctx, params }) => {
    await updates.deleteRepo(ctx, params.id ?? '');
    return { ok: true };
  },
);

/** GET /api/updates/events: the last 20 accepted deliveries. */
export const listEventsRoute = defineRoute({ permission: 'updates.manage' }, async ({ ctx }) => ({
  events: await updates.listRecentEvents(ctx, 20),
}));
