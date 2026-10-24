import { apiRoute } from '@/server/api';
import { getPartnerApplication } from '../../../_lib/partners';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/partners/applications/:id (partners.review). */
export const GET = apiRoute(getPartnerApplication.opts, getPartnerApplication.handler);
