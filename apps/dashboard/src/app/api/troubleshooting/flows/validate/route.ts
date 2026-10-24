import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../../handlers';

export const dynamic = 'force-dynamic';

/** POST /api/troubleshooting/flows/validate { definition } — dry-run validation (troubleshooting.manage). */
export const POST = apiRoute(h.validateFlow.opts, h.validateFlow.handler);
