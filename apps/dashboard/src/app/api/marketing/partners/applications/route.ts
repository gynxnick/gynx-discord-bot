import { apiRoute } from '@/server/api';
import { listPartnerApplications } from '../../_lib/partners';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/partners/applications (partners.review). */
export const GET = apiRoute(listPartnerApplications.opts, listPartnerApplications.handler);
