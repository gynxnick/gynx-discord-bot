import { apiRoute } from '@/server/api';
import { deleteRolePanel, updateRolePanel } from '../../_lib/role-panels';

export const dynamic = 'force-dynamic';

/** PATCH /api/community/panels/:id (community.manage). */
export const PATCH = apiRoute(updateRolePanel.opts, updateRolePanel.handler);
/** DELETE /api/community/panels/:id: removes the panel and its Discord message (community.manage). */
export const DELETE = apiRoute(deleteRolePanel.opts, deleteRolePanel.handler);
