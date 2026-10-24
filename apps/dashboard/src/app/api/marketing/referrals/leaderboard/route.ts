import { apiRoute } from '@/server/api';
import { getReferralLeaderboard } from '../../_lib/referrals';

export const dynamic = 'force-dynamic';

/** GET /api/marketing/referrals/leaderboard?period=7|30|all (referrals.view). */
export const GET = apiRoute(getReferralLeaderboard.opts, getReferralLeaderboard.handler);
