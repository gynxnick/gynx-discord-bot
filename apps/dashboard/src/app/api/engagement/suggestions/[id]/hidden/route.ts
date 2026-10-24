import { apiRoute } from '@/server/api';
import { setSuggestionHidden } from '../../../_lib/suggestions';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/suggestions/:id/hidden { hidden, reason? } (suggestions.manage). */
export const POST = apiRoute(setSuggestionHidden.opts, setSuggestionHidden.handler);
