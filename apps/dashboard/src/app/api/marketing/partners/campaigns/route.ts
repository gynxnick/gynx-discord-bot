import { apiRoute } from '@/server/api';
import { listPartnerCampaigns } from '../../_lib/partners';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/partners/campaigns (partners.review). */
export const GET = apiRoute(listPartnerCampaigns.opts, listPartnerCampaigns.handler);
