import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../../handlers';

export const dynamic = 'force-dynamic';

/** PATCH /api/troubleshooting/flows/:id (troubleshooting.manage). */
export const PATCH = apiRoute(h.updateFlow.opts, h.updateFlow.handler);
/** DELETE /api/troubleshooting/flows/:id (troubleshooting.manage). */
export const DELETE = apiRoute(h.deleteFlow.opts, h.deleteFlow.handler);
