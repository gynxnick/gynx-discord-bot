import { apiRoute } from '@/server/api';
import { closePoll } from '../../../_lib/polls';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/polls/:id/close (polls.manage). */
export const POST = apiRoute(closePoll.opts, closePoll.handler);
