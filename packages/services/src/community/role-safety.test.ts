import { PermissionFlagsBits } from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';
import { assessRoleSafety, DANGEROUS_PERMISSIONS, dangerousPermissionsIn, type RoleMeta } from './role-safety';

const guildId = '100000000000000001';
const safeRole: RoleMeta = {
  id: '200000000000000002',
  position: 5,
  managed: false,
  permissions: (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages).toString(),
};
const check = (role: Partial<RoleMeta>, extra: { botHighestPosition?: number; protectedRoleIds?: string[] } = {}) =>
  assessRoleSafety({ guildId, role: { ...safeRole, ...role }, botHighestPosition: extra.botHighestPosition ?? 10, protectedRoleIds: extra.protectedRoleIds });

describe('assessRoleSafety', () => {
  it('accepts a plain cosmetic role below the bot', () => {
    expect(check({})).toEqual({ ok: true });
  });

  it('rejects @everyone', () => {
    expect(check({ id: guildId, position: 0 })).toMatchObject({ ok: false, reason: 'EVERYONE' });
  });

  it('rejects managed/integration roles', () => {
    expect(check({ managed: true })).toMatchObject({ ok: false, reason: 'MANAGED' });
  });

  it('rejects roles at or above the bot highest role', () => {
    expect(check({ position: 10 })).toMatchObject({ ok: false, reason: 'HIERARCHY' });
    expect(check({ position: 11 })).toMatchObject({ ok: false, reason: 'HIERARCHY' });
    expect(check({ position: 9 })).toEqual({ ok: true });
  });

  it.each(Object.entries(DANGEROUS_PERMISSIONS))('rejects roles with %s', (name, flag) => {
    const perms = (PermissionFlagsBits.SendMessages | flag).toString();
    const r = check({ permissions: perms });
    expect(r).toMatchObject({ ok: false, reason: 'DANGEROUS_PERMISSIONS' });
    expect(r.ok ? [] : r.permissions).toContain(name);
  });

  it('rejects unparseable permission bitfields (fail closed)', () => {
    expect(check({ permissions: 'not-a-number' })).toMatchObject({ ok: false, reason: 'DANGEROUS_PERMISSIONS' });
    expect(check({ permissions: '-8' })).toMatchObject({ ok: false });
  });

  it('rejects protected staff/partner/escalation roles', () => {
    expect(check({}, { protectedRoleIds: [safeRole.id] })).toMatchObject({ ok: false, reason: 'PROTECTED' });
    expect(assessRoleSafety({ guildId, role: safeRole, botHighestPosition: 10, protectedRoleIds: new Set([safeRole.id]) })).toMatchObject({ ok: false });
  });

  it('rejects malformed role ids', () => {
    expect(check({ id: 'abc' })).toMatchObject({ ok: false, reason: 'INVALID' });
  });

  it('lists every dangerous permission in a bitfield', () => {
    const bits = (PermissionFlagsBits.Administrator | PermissionFlagsBits.BanMembers).toString();
    expect(dangerousPermissionsIn(bits).sort()).toEqual(['Administrator', 'BanMembers']);
    expect(dangerousPermissionsIn('0')).toEqual([]);
  });
});
