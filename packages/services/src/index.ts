export * from './core';
// Domain modules are exported as namespaces to keep names unambiguous:
//   import { security } from '@gynx/services'; security.submitReport(ctx, input)
export * as community from './community';
export * as moderation from './moderation';
export * as security from './security';
export * as status from './status';
export * as troubleshooting from './troubleshooting';
export * as games from './games';
export * as engagement from './engagement';
export * as marketing from './marketing';
export * as analytics from './analytics';
export * as support from './support';
export * as updates from './updates';
export * as setup from './setup';
