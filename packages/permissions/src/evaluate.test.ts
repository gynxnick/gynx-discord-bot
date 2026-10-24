import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from './keys';
import { privilegedKeysIn, resolvePermissions, ungrantableKeys, type PermissionGrant } from './evaluate';
import { PRESET_PERMISSIONS } from './presets';
import { COMMAND_POLICIES } from './commands';

const ROLE_SUPPORT = '111111111111111111';
const ROLE_MOD = '222222222222222222';
const USER = '333333333333333333';

const grant = (subjectId: string, permission: string, effect: 'ALLOW' | 'DENY' = 'ALLOW', subjectType: 'ROLE' | 'USER' = 'ROLE'): PermissionGrant => ({
  subjectType,
  subjectId,
  permission,
  effect,
});

describe('resolvePermissions', () => {
  it('grants nothing by default (least privilege)', () => {
    expect(resolvePermissions({ userId: USER, roleIds: [], isGuildOwner: false }, []).size).toBe(0);
  });

  it('gives the guild owner every permission, even with deny rules', () => {
    const perms = resolvePermissions({ userId: USER, roleIds: [], isGuildOwner: true }, [grant(USER, '*', 'DENY', 'USER')]);
    expect(perms.size).toBe(ALL_PERMISSIONS.length);
  });

  it('expands presets and wildcards from role grants', () => {
    const perms = resolvePermissions({ userId: USER, roleIds: [ROLE_SUPPORT, ROLE_MOD], isGuildOwner: false }, [
      grant(ROLE_SUPPORT, 'SUPPORT_STAFF'),
      grant(ROLE_MOD, 'moderation.*'),
    ]);
    for (const k of PRESET_PERMISSIONS.SUPPORT_STAFF) expect(perms.has(k)).toBe(true);
    expect(perms.has('moderation.ban')).toBe(true);
    expect(perms.has('settings.manage')).toBe(false);
  });

  it('lets an explicit deny override any allow', () => {
    const perms = resolvePermissions({ userId: USER, roleIds: [ROLE_MOD], isGuildOwner: false }, [
      grant(ROLE_MOD, 'ADMINISTRATOR'),
      grant(USER, 'moderation.ban', 'DENY', 'USER'),
    ]);
    expect(perms.has('moderation.ban')).toBe(false);
    expect(perms.has('settings.manage')).toBe(true);
  });

  it('ignores grants for roles the member does not have and unknown keys', () => {
    const perms = resolvePermissions({ userId: USER, roleIds: [ROLE_SUPPORT], isGuildOwner: false }, [
      grant(ROLE_MOD, 'ADMINISTRATOR'),
      grant(ROLE_SUPPORT, 'tickets.view'),
      grant(ROLE_SUPPORT, 'definitely.not.real'),
    ]);
    expect(perms.size).toBe(0);
  });
});

describe('anti-escalation', () => {
  it('blocks granting without permissions.manage', () => {
    expect(ungrantableKeys(new Set(['settings.manage']), 'settings.manage')).toEqual(['settings.manage']);
  });

  it('blocks granting keys the actor does not hold', () => {
    const actor = new Set(PRESET_PERMISSIONS.ADMINISTRATOR);
    expect(ungrantableKeys(actor, 'analytics.view')).toEqual([]);
    const limited = new Set(['permissions.manage', 'analytics.view'] as const);
    expect(ungrantableKeys(limited, 'ADMINISTRATOR').length).toBeGreaterThan(0);
  });

  it('identifies privileged keys inside presets', () => {
    expect(privilegedKeysIn('ADMINISTRATOR')).toContain('settings.manage');
    expect(privilegedKeysIn('ANALYST')).toEqual([]);
  });
});

describe('command policies', () => {
  it('reference only real permission keys', () => {
    for (const [name, policy] of Object.entries(COMMAND_POLICIES)) {
      if (policy.permission) expect(ALL_PERMISSIONS, name).toContain(policy.permission);
    }
  });

  it('gate every moderation and admin command', () => {
    for (const name of ['warn', 'timeout', 'kick', 'ban', 'config', 'audit-log', 'announce', 'giveaway', 'analytics']) {
      expect(COMMAND_POLICIES[name]?.permission, name).toBeTruthy();
    }
  });
});
