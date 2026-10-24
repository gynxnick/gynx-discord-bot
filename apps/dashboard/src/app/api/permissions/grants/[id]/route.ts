import { deleteGrant } from '@gynx/services';
import { apiRoute } from '@/server/api';

export const dynamic = 'force-dynamic';

/** DELETE /api/permissions/grants/:id (permissions.manage). */
export const DELETE = apiRoute({ permission: 'permissions.manage' }, async ({ ctx, params }) => {
  await deleteGrant(ctx, params.id ?? '');
  return { ok: true };
});
