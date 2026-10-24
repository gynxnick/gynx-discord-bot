import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../../handlers';

export const dynamic = 'force-dynamic';

/** GET /api/troubleshooting/diagnostics/:id (troubleshooting.manage). */
export const GET = apiRoute(h.getDiagnostic.opts, h.getDiagnostic.handler);
