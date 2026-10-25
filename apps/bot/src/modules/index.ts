import type { BotModule } from '../framework/types';
import { analyticsModule } from './analytics';
import { communityModule } from './community';
import { coreModule } from './core';
import { engagementModule } from './engagement';
import { gamesModule } from './games';
import { marketingModule } from './marketing';
import { moderationModule } from './moderation';
import { securityModule } from './security';
import { setupModule } from './setup';
import { statusModule } from './status';
import { supportModule } from './support';
import { troubleshootingModule } from './troubleshooting';

/** Every feature module. Each folder owns its commands, components and gateway listeners. */
export const modules: BotModule[] = [
  coreModule,
  communityModule,
  moderationModule,
  securityModule,
  statusModule,
  troubleshootingModule,
  gamesModule,
  engagementModule,
  marketingModule,
  analyticsModule,
  supportModule,
  setupModule,
];
