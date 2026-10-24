import { apiRoute } from '@/server/api';
import { listReferralAttributions } from '../../_lib/referrals';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/referrals/attributions (referrals.view; review notes only for referrals.manage). */
export const GET = apiRoute(listReferralAttributions.opts, listReferralAttributions.handler);
