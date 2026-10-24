import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../handlers';

export const dynamic = 'force-dynamic';

/** GET /api/troubleshooting/diagnostics — redacted diagnosis records (troubleshooting.manage). */
export const GET = apiRoute(h.listDiagnostics.opts, h.listDiagnostics.handler);
