import { apiRoute } from '@/server/api';
import { updatePartnerCampaign } from '../../../_lib/partners';

export const dynamic = 'force-dynamic';

/** PATCH /api/marketing/partners/campaigns/:id (partners.review; enabling canAnnounce also needs settings.manage). */
export const PATCH = apiRoute(updatePartnerCampaign.opts, updatePartnerCampaign.handler);
