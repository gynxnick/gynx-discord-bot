import { apiRoute } from '@/server/api';
import { retryJob } from '@/server/queries/jobs';

export const dynamic = 'force-dynamic';

/** POST /api/jobs/:id/retry — requeue a dead-lettered job (settings.manage, audited as jobs.retry). */
export const POST = apiRoute(
  { permission: 'settings.manage', rateLimit: { limit: 20, windowSeconds: 60, key: 'jobs.retry' } },
  async ({ ctx, params }) => retryJob(ctx, params.id ?? ''),
);
