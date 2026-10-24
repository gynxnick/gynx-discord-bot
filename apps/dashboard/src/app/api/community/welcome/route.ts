import { apiRoute } from '@/server/api';
import { getWelcome, updateWelcome } from '../_lib/handlers';

export const dynamic = 'force-dynamic';

/** GET /api/community/welcome (community.manage). */
export const GET = apiRoute(getWelcome.opts, getWelcome.handler);
/** PUT /api/community/welcome — partial WelcomeConfig update (community.manage; verified role checked live). */
export const PUT = apiRoute(updateWelcome.opts, updateWelcome.handler);
