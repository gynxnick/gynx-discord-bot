import { setup } from '@gynx/services';
import type { WorkerModule } from '../framework/types';

/** Server setup wizard: executes confirmed operations (idempotent and resumable). */
export const setupJobs: WorkerModule = {
  name: 'setup',
  handlers: {
    async [setup.SETUP_APPLY_JOB](job, w) {
      const operationId = (job.payload as { operationId?: unknown } | null)?.operationId;
      if (typeof operationId !== 'string') {
        w.log.warn({ jobId: job.id }, 'setup job without an operation id');
        return;
      }
      const summary = await setup.runSetupOperation(w.deps, operationId);
      w.log.info(
        {
          operationId,
          status: summary.status,
          created: summary.created,
          failed: summary.failed,
          verified: summary.verified,
        },
        'setup operation finished',
      );
    },
  },
};
