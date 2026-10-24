import { apiRoute } from '@/server/api';
import { rerollGiveaway } from '../../../_lib/giveaways';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/giveaways/:id/reroll (giveaways.manage). */
export const POST = apiRoute(rerollGiveaway.opts, rerollGiveaway.handler);
