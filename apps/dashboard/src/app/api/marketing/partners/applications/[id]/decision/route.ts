import { apiRoute } from '@/server/api';
import { decidePartnerApplication } from '../../../../_lib/partners';

export const dynamic = 'force-dynamic';

/** POST /api/marketing/partners/applications/:id/decision (partners.review). */
export const POST = apiRoute(decidePartnerApplication.opts, decidePartnerApplication.handler);
