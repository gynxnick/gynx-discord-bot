import { apiRoute } from '@/server/api';
import { reviewAttribution } from '../../../../_lib/referrals';

export const dynamic = 'force-dynamic';

/** POST /api/marketing/referrals/attributions/:id/review (referrals.manage). */
export const POST = apiRoute(reviewAttribution.opts, reviewAttribution.handler);
