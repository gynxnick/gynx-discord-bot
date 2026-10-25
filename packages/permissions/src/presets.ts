import { ALL_PERMISSIONS, type PermissionKey } from './keys';

export const ROLE_PRESETS = [
  'OWNER',
  'ADMINISTRATOR',
  'SENIOR_STAFF',
  'SUPPORT_STAFF',
  'MODERATOR',
  'MARKETING_STAFF',
  'ANALYST',
] as const;
export type RolePreset = (typeof ROLE_PRESETS)[number];

const SUPPORT: PermissionKey[] = [
  'dashboard.access',
  'support.duty',
  'incidents.view',
  'troubleshooting.manage',
];

const MODERATOR: PermissionKey[] = [
  'dashboard.access',
  'moderation.execute',
  'moderation.audit.view',
  'security.reports.view',
  'suggestions.manage',
];

const MARKETING: PermissionKey[] = [
  'dashboard.access',
  'announcements.create',
  'announcements.publish',
  'events.manage',
  'polls.manage',
  'giveaways.manage',
  'referrals.view',
  'referrals.manage',
  'partners.review',
  'analytics.view',
];

const ANALYST: PermissionKey[] = ['dashboard.access', 'analytics.view', 'analytics.export', 'referrals.view'];

const SENIOR: PermissionKey[] = [
  ...SUPPORT,
  ...MODERATOR,
  'support.duty.manage',
  'incidents.manage',
  'security.reports.manage',
  'moderation.ban',
  'analytics.view',
  'audit.view',
];

const ADMIN: PermissionKey[] = ALL_PERMISSIONS.filter((k) => k !== 'permissions.manage');

export const PRESET_PERMISSIONS: Record<RolePreset, readonly PermissionKey[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMINISTRATOR: [...ADMIN, 'permissions.manage'],
  SENIOR_STAFF: [...new Set(SENIOR)],
  SUPPORT_STAFF: SUPPORT,
  MODERATOR,
  MARKETING_STAFF: MARKETING,
  ANALYST,
};

export function isRolePreset(v: string): v is RolePreset {
  return (ROLE_PRESETS as readonly string[]).includes(v);
}
