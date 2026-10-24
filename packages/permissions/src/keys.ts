/**
 * The single source of truth for permission keys. Discord role IDs are never
 * hard-coded: guilds map roles (or individual users) to keys or presets in the
 * StaffPermission table, editable from the dashboard.
 */
export const PERMISSIONS = {
  'dashboard.access': 'Sign in to the web dashboard',

  'incidents.view': 'View incidents and monitoring internals',
  'incidents.manage': 'Create and update incidents and maintenance windows',
  'status.manage': 'Configure monitored services, endpoints and thresholds',

  'moderation.execute': 'Warn, timeout and kick members',
  'moderation.ban': 'Ban and unban members',
  'moderation.audit.view': 'View moderation records and moderator notes',
  'automod.manage': 'Configure automod thresholds, blocked terms and domains',

  'security.reports.view': 'View abuse and security reports',
  'security.reports.manage': 'Triage, investigate and resolve reports',
  'audit.view': 'View the security audit log',

  'community.manage': 'Edit welcome flow, self-roles, FAQs and guides',
  'suggestions.manage': 'Respond to and moderate suggestions',
  'troubleshooting.manage': 'Edit knowledge base and troubleshooting flows',

  'events.manage': 'Create and manage events',
  'polls.manage': 'Create and close polls',
  'giveaways.manage': 'Create, end and reroll giveaways',

  'announcements.create': 'Draft announcements',
  'announcements.publish': 'Publish and schedule announcements',
  'announcements.mass_mention': 'Use @everyone/@here and role mentions in announcements',

  'referrals.view': 'View referral analytics',
  'referrals.manage': 'Create tracked invites and review attribution disputes',
  'partners.review': 'Review partner applications and campaigns',

  'analytics.view': 'View analytics dashboards and weekly reports',
  'analytics.export': 'Export analytics reports',

  'settings.manage': 'Change module, channel and integration settings',
  'permissions.manage': 'Change staff permissions',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(v: string): v is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, v);
}

/**
 * Keys that can only be granted by someone who already holds them AND
 * `permissions.manage`, and that are never granted to partner/community roles.
 */
export const PRIVILEGED_PERMISSIONS: readonly PermissionKey[] = [
  'settings.manage',
  'permissions.manage',
  'moderation.ban',
  'audit.view',
  'security.reports.manage',
  'announcements.mass_mention',
];
