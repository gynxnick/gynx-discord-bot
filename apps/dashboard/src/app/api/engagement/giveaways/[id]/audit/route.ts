import { apiRoute } from '@/server/api';
import { getGiveawayAudit } from '../../../_lib/giveaways';

export const dynamic = 'force-dynamic';

/** GET /api/engagement/giveaways/:id/audit (giveaways.manage). */
export const GET = apiRoute(getGiveawayAudit.opts, getGiveawayAudit.handler);
