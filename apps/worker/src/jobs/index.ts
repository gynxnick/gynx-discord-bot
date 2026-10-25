import type { WorkerModule } from '../framework/types';
import { analyticsJobs } from './analytics';
import { communityJobs } from './community';
import { coreJobs } from './core';
import { engagementJobs } from './engagement';
import { marketingJobs } from './marketing';
import { moderationJobs } from './moderation';
import { securityJobs } from './security';
import { setupJobs } from './setup';
import { statusJobs } from './status';
import { supportJobs } from './support';
import { troubleshootingJobs } from './troubleshooting';

export const workerModules: WorkerModule[] = [
  coreJobs,
  communityJobs,
  moderationJobs,
  securityJobs,
  statusJobs,
  troubleshootingJobs,
  engagementJobs,
  marketingJobs,
  analyticsJobs,
  supportJobs,
  setupJobs,
];
