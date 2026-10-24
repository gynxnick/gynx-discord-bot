import { apiRoute } from '@/server/api';
import { deleteSelfRole, updateSelfRole } from '../../_lib/handlers';

export const dynamic = 'force-dynamic';

/** PATCH /api/community/roles/:id (community.manage). */
export const PATCH = apiRoute(updateSelfRole.opts, updateSelfRole.handler);
/** DELETE /api/community/roles/:id (community.manage). */
export const DELETE = apiRoute(deleteSelfRole.opts, deleteSelfRole.handler);
