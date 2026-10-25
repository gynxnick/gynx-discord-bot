import { apiRoute } from '@/server/api';
import { createRolePanel, listRolePanels } from '../_lib/role-panels';

export const dynamic = 'force-dynamic';

/** GET /api/community/panels: role panels (community.manage). */
export const GET = apiRoute(listRolePanels.opts, listRolePanels.handler);
/** POST /api/community/panels: create a panel; the worker posts it (community.manage). */
export const POST = apiRoute(createRolePanel.opts, createRolePanel.handler);
