import { apiRoute } from '@/server/api';
import { listReferralInvites } from '../../_lib/referrals';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/referrals/invites (referrals.view). */
export const GET = apiRoute(listReferralInvites.opts, listReferralInvites.handler);
