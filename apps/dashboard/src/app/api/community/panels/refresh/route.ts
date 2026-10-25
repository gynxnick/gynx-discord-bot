import { apiRoute } from '@/server/api';
import { refreshRolePanels } from '../../_lib/role-panels';

export const dynamic = 'force-dynamic';

/** POST /api/community/panels/refresh: re-render one panel ({ id }) or all (community.manage). */
export const POST = apiRoute(refreshRolePanels.opts, refreshRolePanels.handler);
