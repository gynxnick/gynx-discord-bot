import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../handlers';

export const dynamic = 'force-dynamic';

/** GET /api/troubleshooting/flows — flows incl. drafts + session stats (troubleshooting.manage). */
export const GET = apiRoute(h.listFlows.opts, h.listFlows.handler);
/** POST /api/troubleshooting/flows — create (troubleshooting.manage). */
export const POST = apiRoute(h.createFlow.opts, h.createFlow.handler);
