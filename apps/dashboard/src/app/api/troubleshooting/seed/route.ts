import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../handlers';

export const dynamic = 'force-dynamic';

/** POST /api/troubleshooting/seed — install default articles/flows; never overwrites existing slugs (troubleshooting.manage). */
export const POST = apiRoute(h.seed.opts, h.seed.handler);
