import { apiRoute } from '@/server/api';
import { listSuggestions } from '../_lib/suggestions';

export const dynamic = 'force-dynamic';

/** GET /api/engagement/suggestions — filtered list incl. hidden on request (suggestions.manage). */
export const GET = apiRoute(listSuggestions.opts, listSuggestions.handler);
