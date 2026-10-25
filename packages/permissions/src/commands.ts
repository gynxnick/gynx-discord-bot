import type { PermissionKey } from './keys';

/**
 * Central slash-command → permission map. `null` means any member may run it
 * (the command itself may still check object-level access, e.g. own records).
 * Discord-native `default_member_permissions` is derived from `discordDefault`
 * to hide staff commands from members, but server-side checks are authoritative.
 */
export interface CommandPolicy {
  permission: PermissionKey | null;
  /** Discord native default permission hint for staff-only commands. */
  discordDefault?: 'ManageMessages' | 'ModerateMembers' | 'KickMembers' | 'BanMembers' | 'ManageGuild';
  /** Per-user rate limit: [count, windowSeconds]. */
  rateLimit?: [number, number];
}

export const COMMAND_POLICIES: Record<string, CommandPolicy> = {
  // General
  help: { permission: null, rateLimit: [10, 60] },
  about: { permission: null, rateLimit: [10, 60] },
  faq: { permission: null, rateLimit: [15, 60] },
  guides: { permission: null, rateLimit: [15, 60] },
  rules: { permission: null, rateLimit: [10, 60] },
  roles: { permission: null, rateLimit: [10, 60] },
  duty: { permission: 'support.duty', discordDefault: 'ManageMessages', rateLimit: [10, 60] },
  'role-panel': { permission: 'community.manage', discordDefault: 'ManageGuild' },
  // Status
  status: { permission: null, rateLimit: [10, 60] },
  uptime: { permission: null, rateLimit: [10, 60] },
  incidents: { permission: null, rateLimit: [10, 60] },
  'subscribe-status': { permission: null, rateLimit: [5, 60] },
  // Moderation
  warn: { permission: 'moderation.execute', discordDefault: 'ModerateMembers' },
  warnings: { permission: 'moderation.audit.view', discordDefault: 'ModerateMembers' },
  timeout: { permission: 'moderation.execute', discordDefault: 'ModerateMembers' },
  kick: { permission: 'moderation.execute', discordDefault: 'KickMembers' },
  ban: { permission: 'moderation.ban', discordDefault: 'BanMembers' },
  appeal: { permission: null, rateLimit: [2, 3600] },
  // Troubleshooting
  troubleshoot: { permission: null, rateLimit: [10, 60] },
  diagnose: { permission: null, rateLimit: [3, 300] },
  'knowledge-search': { permission: null, rateLimit: [15, 60] },
  // Game utilities
  gameinfo: { permission: null, rateLimit: [10, 60] },
  version: { permission: null, rateLimit: [10, 60] },
  playercount: { permission: null, rateLimit: [5, 60] },
  minecraft: { permission: null, rateLimit: [5, 60] },
  steam: { permission: null, rateLimit: [5, 60] },
  portcheck: { permission: null, rateLimit: [3, 300] },
  // Security
  'report-abuse': { permission: null, rateLimit: [3, 3600] },
  // Community
  event: { permission: null, rateLimit: [10, 60] }, // subcommands gate create/cancel
  poll: { permission: 'polls.manage', discordDefault: 'ManageMessages' },
  suggest: { permission: null, rateLimit: [3, 3600] },
  giveaway: { permission: 'giveaways.manage', discordDefault: 'ManageGuild' },
  // Marketing
  announce: { permission: 'announcements.publish', discordDefault: 'ManageGuild' },
  'schedule-announcement': { permission: 'announcements.publish', discordDefault: 'ManageGuild' },
  referral: { permission: null, rateLimit: [5, 60] }, // subcommands gate create/review
  partners: { permission: null, rateLimit: [3, 600] }, // apply is public; review gated
  // Analytics
  analytics: { permission: 'analytics.view', discordDefault: 'ManageGuild' },
  'staff-stats': { permission: 'analytics.view', discordDefault: 'ManageGuild' },
  // Administration
  config: { permission: 'settings.manage', discordDefault: 'ManageGuild' },
  'audit-log': { permission: 'audit.view', discordDefault: 'ManageGuild' },
};
