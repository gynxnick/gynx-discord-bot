import { ALL_PERMISSIONS, PRIVILEGED_PERMISSIONS, isPermissionKey, type PermissionKey } from './keys';
import { PRESET_PERMISSIONS, isRolePreset } from './presets';

/** A grant row as stored in StaffPermission. `permission` is a key, a `prefix.*` wildcard, or a preset name. */
export interface PermissionGrant {
  subjectType: 'ROLE' | 'USER';
  subjectId: string;
  permission: string;
  effect: 'ALLOW' | 'DENY';
}

export interface Principal {
  userId: string;
  roleIds: readonly string[];
  /** Discord guild owner — always has every permission and cannot be denied. */
  isGuildOwner: boolean;
}

function expand(permission: string): PermissionKey[] {
  if (isRolePreset(permission)) return [...PRESET_PERMISSIONS[permission]];
  if (permission === '*') return [...ALL_PERMISSIONS];
  if (permission.endsWith('.*')) {
    const prefix = permission.slice(0, -1);
    return ALL_PERMISSIONS.filter((k) => k.startsWith(prefix));
  }
  return isPermissionKey(permission) ? [permission] : [];
}

/**
 * Resolve the effective permission set.
 * Rules:
 *  1. Guild owner → everything.
 *  2. Collect ALLOW grants from the user's roles and user-specific grants.
 *  3. Any matching DENY (role or user) removes the key — deny always wins.
 *  4. Unknown keys are ignored (fail closed).
 */
export function resolvePermissions(principal: Principal, grants: readonly PermissionGrant[]): Set<PermissionKey> {
  if (principal.isGuildOwner) return new Set(ALL_PERMISSIONS);
  const roleSet = new Set(principal.roleIds);
  const applies = (g: PermissionGrant) =>
    (g.subjectType === 'ROLE' && roleSet.has(g.subjectId)) ||
    (g.subjectType === 'USER' && g.subjectId === principal.userId);

  const allowed = new Set<PermissionKey>();
  const denied = new Set<PermissionKey>();
  for (const g of grants) {
    if (!applies(g)) continue;
    const target = g.effect === 'DENY' ? denied : allowed;
    for (const k of expand(g.permission)) target.add(k);
  }
  for (const k of denied) allowed.delete(k);
  return allowed;
}

export function hasPermission(perms: ReadonlySet<PermissionKey>, key: PermissionKey): boolean {
  return perms.has(key);
}

export function hasAny(perms: ReadonlySet<PermissionKey>, keys: readonly PermissionKey[]): boolean {
  return keys.some((k) => perms.has(k));
}

/** Is any staff permission held at all (used to decide what a "staff member" is). */
export function isStaff(perms: ReadonlySet<PermissionKey>): boolean {
  return perms.size > 0;
}

/**
 * Anti-escalation: the actor must hold `permissions.manage` and may only grant
 * (or deny) keys they themselves hold. Returns the keys that may NOT be granted.
 */
export function ungrantableKeys(actorPerms: ReadonlySet<PermissionKey>, permission: string): PermissionKey[] {
  const keys = expand(permission);
  if (!actorPerms.has('permissions.manage')) return keys;
  return keys.filter((k) => !actorPerms.has(k));
}

/** Privileged keys must never be granted to a partner/community role. */
export function privilegedKeysIn(permission: string): PermissionKey[] {
  return expand(permission).filter((k) => PRIVILEGED_PERMISSIONS.includes(k));
}

export function isValidGrantPermission(permission: string): boolean {
  return expand(permission).length > 0;
}
