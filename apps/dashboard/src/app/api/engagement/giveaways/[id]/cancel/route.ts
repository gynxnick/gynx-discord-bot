import { apiRoute } from '@/server/api';
import { cancelGiveaway } from '../../../_lib/giveaways';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/giveaways/:id/cancel (giveaways.manage). */
export const POST = apiRoute(cancelGiveaway.opts, cancelGiveaway.handler);
