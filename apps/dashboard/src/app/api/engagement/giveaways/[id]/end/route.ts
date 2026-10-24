import { apiRoute } from '@/server/api';
import { endGiveaway } from '../../../_lib/giveaways';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/giveaways/:id/end (giveaways.manage). */
export const POST = apiRoute(endGiveaway.opts, endGiveaway.handler);
