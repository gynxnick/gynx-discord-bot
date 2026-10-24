import { apiRoute } from '@/server/api';
import { createSelfRole, listSelfRoles } from '../_lib/handlers';

export const dynamic = 'force-dynamic';

/** GET /api/community/roles — self-assignable allowlist (community.manage). */
export const GET = apiRoute(listSelfRoles.opts, listSelfRoles.handler);
/** POST /api/community/roles — add a role (community.manage; role safety checked against live Discord data). */
export const POST = apiRoute(createSelfRole.opts, createSelfRole.handler);
