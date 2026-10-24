import { apiRoute } from '@/server/api';
import { createGiveaway, listGiveaways } from '../_lib/giveaways';

export const dynamic = 'force-dynamic';

/** GET /api/engagement/giveaways (giveaways.manage). */
export const GET = apiRoute(listGiveaways.opts, listGiveaways.handler);
/** POST /api/engagement/giveaways (giveaways.manage). */
export const POST = apiRoute(createGiveaway.opts, createGiveaway.handler);
