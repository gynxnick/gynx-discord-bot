import { z } from 'zod';
import { engagement } from '@gynx/services';
import { defineRoute } from '../../community/_lib/route-def';

/** Suggestion moderation route definitions (suggestions.manage). */

export const listSuggestionsQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['UNDER_REVIEW', 'PLANNED', 'IMPLEMENTED', 'DECLINED', 'DUPLICATE']).optional(),
  includeHidden: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().max(100).optional(),
});

export const listSuggestions = defineRoute(
  { permission: 'suggestions.manage', schema: listSuggestionsQuery },
  async ({ ctx, input }) => engagement.listSuggestions(ctx, input),
);

export const setSuggestionStatus = defineRoute(
  { permission: 'suggestions.manage', mutation: true, schema: engagement.setSuggestionStatusSchema },
  async ({ ctx, input, params }) => engagement.setSuggestionStatus(ctx, params.id ?? '', input),
);

export const suggestionHiddenSchema = z.object({
  hidden: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const setSuggestionHidden = defineRoute(
  { permission: 'suggestions.manage', mutation: true, schema: suggestionHiddenSchema },
  async ({ ctx, input, params }) =>
    engagement.setSuggestionHidden(ctx, params.id ?? '', input.hidden, input.reason),
);
