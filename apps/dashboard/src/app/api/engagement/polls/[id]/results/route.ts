import { apiRoute } from '@/server/api';
import { getPollResults } from '../../../_lib/polls';

export const dynamic = 'force-dynamic';

/** GET /api/engagement/polls/:id/results?voters=true (polls.manage; never voters for anonymous polls). */
export const GET = apiRoute(getPollResults.opts, getPollResults.handler);
