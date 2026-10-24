import { apiRoute } from '@/server/api';
import { createPoll, listPolls } from '../_lib/polls';

export const dynamic = 'force-dynamic';

/** GET /api/engagement/polls (polls.manage). */
export const GET = apiRoute(listPolls.opts, listPolls.handler);
/** POST /api/engagement/polls (polls.manage). */
export const POST = apiRoute(createPoll.opts, createPoll.handler);
