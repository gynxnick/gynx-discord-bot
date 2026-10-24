import { apiRoute } from '@/server/api';
import { getPartnerCampaignAnalytics } from '../../../../_lib/partners';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/partners/campaigns/:id/analytics (partners.review). */
export const GET = apiRoute(getPartnerCampaignAnalytics.opts, getPartnerCampaignAnalytics.handler);
