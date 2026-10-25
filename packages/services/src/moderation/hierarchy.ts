import type { PermissionKey } from '@gynx/permissions';
import { ModerationText as T } from './texts';

/**
 * Pure role-hierarchy rules for moderation actions. Role positions are Discord
 * role positions (higher = more powerful). `targetHighest` is null when the
 * target is not a member of the guild (e.g. banning a user who already left).
 */
export interface HierarchyInput {
  actorId: string;
  actorHighest: number;
  targetId: string;
  targetHighest: number | null;
  botHighest: number;
  guildOwnerId: string;
  targetIsBot?: boolean;
  /** Target holds at least one staff permission (see STAFF_PERMISSIONS). */
  targetIsStaff?: boolean;
  /** Actor holds `moderation.ban` — required to act on staff. */
  actorCanBan?: boolean;
  /** The action changes Discord state, so the bot's own role must outrank the target. Default true. */
  requiresBot?: boolean;
}

export type HierarchyResult = { ok: true } | { ok: false; reason: string };

/**
 * Any of these keys marks a member as staff. Moderating staff is deliberately
 * harder: the actor must ALSO hold `moderation.ban` (senior moderator) in
 * addition to outranking the target by top role. Keeps junior moderators from
 * turning tools against colleagues while still letting leads act.
 */
export const STAFF_PERMISSIONS: readonly PermissionKey[] = [
  'moderation.execute',
  'moderation.ban',
  'moderation.audit.view',
  'automod.manage',
  'security.reports.view',
  'security.reports.manage',
  'audit.view',
  'settings.manage',
  'permissions.manage',
];

export const isStaffPermissionSet = (perms: ReadonlySet<PermissionKey>): boolean =>
  STAFF_PERMISSIONS.some((k) => perms.has(k));

export function checkHierarchy(i: HierarchyInput): HierarchyResult {
  if (i.actorId === i.targetId) return { ok: false, reason: T.hierarchySelf() };
  if (i.targetId === i.guildOwnerId) return { ok: false, reason: T.hierarchyOwner() };

  const actorIsOwner = i.actorId === i.guildOwnerId;
  if (i.targetHighest !== null) {
    if (!actorIsOwner && i.targetHighest >= i.actorHighest) {
      return { ok: false, reason: T.hierarchyHigherRole() };
    }
    if ((i.requiresBot ?? true) && i.targetHighest >= i.botHighest) {
      return { ok: false, reason: T.hierarchyBotRole() };
    }
  }
  if (i.targetIsStaff && !actorIsOwner && !i.actorCanBan) {
    return { ok: false, reason: T.hierarchyStaff() };
  }
  return { ok: true };
}
