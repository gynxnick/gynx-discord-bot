import { apiRoute } from '@/server/api';
import { jobListSchema, listProblemJobs } from '@/server/queries/jobs';

export const dynamic = 'force-dynamic';

/** GET /api/jobs — dead-lettered and retrying jobs (settings.manage). */
export const GET = apiRoute(
  { permission: 'settings.manage', schema: jobListSchema },
  async ({ ctx, input }) => listProblemJobs(ctx, input),
);
