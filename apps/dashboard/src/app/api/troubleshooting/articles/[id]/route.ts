import { apiRoute } from '@/server/api';
import { troubleshootingHandlers as h } from '../../handlers';

export const dynamic = 'force-dynamic';

/** PATCH /api/troubleshooting/articles/:id (troubleshooting.manage). */
export const PATCH = apiRoute(h.updateArticle.opts, h.updateArticle.handler);
/** DELETE /api/troubleshooting/articles/:id (troubleshooting.manage). */
export const DELETE = apiRoute(h.deleteArticle.opts, h.deleteArticle.handler);
