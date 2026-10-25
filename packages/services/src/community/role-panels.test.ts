import { describe, expect, it } from 'vitest';
import type { SelfAssignableRole } from '@gynx/database';
import {
  MAX_PANEL_ROLES,
  PANEL_BUTTON_PREFIX,
  buttonEmoji,
  panelRoles,
  renderRolePanel,
} from './role-panels';

let n = 0;
const role = (over: Partial<SelfAssignableRole> = {}): SelfAssignableRole => {
  n += 1;
  return {
    id: `r${n}`,
    guildId: 'g',
    roleId: `1${String(n).padStart(17, '0')}`,
    label: `Role ${n}`,
    description: null,
    emoji: null,
    group: 'games',
    enabled: true,
    sortOrder: 0,
    ...over,
  };
};

describe('buttonEmoji', () => {
  it('accepts unicode and custom emoji', () => {
    expect(buttonEmoji('🎮')).toEqual({ name: '🎮' });
    expect(buttonEmoji('<:mc:123456789012345678>')).toEqual({
      name: 'mc',
      id: '123456789012345678',
      animated: false,
    });
    expect(buttonEmoji('<a:spin:123456789012345678>')).toMatchObject({ animated: true });
  });

  it('drops anything Discord would reject', () => {
    expect(buttonEmoji(null)).toBeUndefined();
    expect(buttonEmoji('mc')).toBeUndefined();
    expect(buttonEmoji(':mc:')).toBeUndefined();
    expect(buttonEmoji('🎮 games')).toBeUndefined();
  });
});

describe('panelRoles', () => {
  it('filters by group and skips disabled roles', () => {
    const roles = [
      role({ group: 'games' }),
      role({ group: 'notifications' }),
      role({ group: 'games', enabled: false }),
    ];
    expect(panelRoles({ groups: ['games'] }, roles)).toHaveLength(1);
    expect(panelRoles({ groups: [] }, roles)).toHaveLength(2);
  });
});

describe('renderRolePanel', () => {
  it('lays out one button per role, five per row, with trusted-nothing custom ids', () => {
    const roles = Array.from({ length: 7 }, () => role());
    const body = renderRolePanel({ title: 'Pick', description: null, groups: [] }, roles);
    const rows = body.components as Array<{ components: Array<{ custom_id: string }> }>;
    expect(rows.map((r) => r.components.length)).toEqual([5, 2]);
    const first = panelRoles({ groups: [] }, roles)[0]!; // group, then configured order, then label
    expect(rows[0]!.components[0]!.custom_id).toBe(`${PANEL_BUTTON_PREFIX}${first.roleId}`);
  });

  it('caps at 25 buttons and tells members where the rest are', () => {
    const roles = Array.from({ length: 30 }, () => role());
    const body = renderRolePanel({ title: 'Pick', description: null, groups: [] }, roles);
    const buttons = (body.components as Array<{ components: unknown[] }>).flatMap((r) => r.components);
    expect(buttons).toHaveLength(MAX_PANEL_ROLES);
    expect(body.embeds![0]!.description).toContain('5 more roles');
  });

  it('neutralises mass mentions in staff-written text', () => {
    const body = renderRolePanel({ title: 'Pick', description: 'Hey @everyone', groups: [] }, [
      role({ label: '@here fans' }),
    ]);
    const json = JSON.stringify(body.embeds);
    expect(json).not.toMatch(/@everyone|@here/);
  });

  it('says so when no roles are available', () => {
    const body = renderRolePanel({ title: 'Pick', description: null, groups: ['notifications'] }, [role()]);
    expect(body.embeds![0]!.description).toContain('No roles');
    expect(body.components).toEqual([]);
  });
});
