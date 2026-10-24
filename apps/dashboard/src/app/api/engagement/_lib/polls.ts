import { z } from 'zod';
import { engagement } from '@gynx/services';
import { defineRoute } from '../../community/_lib/route-def';
import { boolParam } from './events';

/** Poll API route definitions (polls.manage), bound in the sibling route.ts files. */

export const listPollsQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  q: z.string().trim().max(100).optional(),
});

/** GET /api/engagement/polls — no voter identities. */
export const listPolls = defineRoute(
  { permission: 'polls.manage', schema: listPollsQuery },
  async ({ ctx, input }) => engagement.listPolls(ctx, input),
);

/** POST /api/engagement/polls — body is the service's createPollSchema (durationMs computed by the form). */
export const createPoll = defineRoute(
  { permission: 'polls.manage', mutation: true, schema: engagement.createPollSchema },
  async ({ ctx, input }) => engagement.createPoll(ctx, input),
);

/** POST /api/engagement/polls/:id/close — OPEN polls only; final results are posted by the worker. */
export const closePoll = defineRoute(
  { permission: 'polls.manage', mutation: true },
  async ({ ctx, params }) => engagement.closePoll(ctx, params.id ?? ''),
);

export const pollResultsQuery = z.object({ voters: boolParam });

/**
 * GET /api/engagement/polls/:id/results[?voters=true] — voter ids only for
 * non-anonymous polls (the service never returns them for anonymous polls).
 */
export const getPollResults = defineRoute(
  { permission: 'polls.manage', schema: pollResultsQuery },
  async ({ ctx, input, params }) =>
    engagement.getPollResults(ctx, params.id ?? '', { includeVoters: input.voters === true }),
);
