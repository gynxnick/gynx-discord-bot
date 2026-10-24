import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../handlers';

export const dynamic = 'force-dynamic';

/** GET /api/troubleshooting/articles — staff list incl. drafts (troubleshooting.manage). */
export const GET = apiRoute(h.listArticles.opts, h.listArticles.handler);
/** POST /api/troubleshooting/articles — create (troubleshooting.manage). */
export const POST = apiRoute(h.createArticle.opts, h.createArticle.handler);
