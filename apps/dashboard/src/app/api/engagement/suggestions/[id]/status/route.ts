import { apiRoute } from '@/server/api';
import { setSuggestionStatus } from '../../../_lib/suggestions';

export const dynamic = 'force-dynamic';

/** POST /api/engagement/suggestions/:id/status { status, response?, duplicateOf? } (suggestions.manage). */
export const POST = apiRoute(setSuggestionStatus.opts, setSuggestionStatus.handler);
