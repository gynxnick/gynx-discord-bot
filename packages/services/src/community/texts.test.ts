import { describe, expect, it } from 'vitest';
import type { SelfAssignableRole, WelcomeConfig } from '@gynx/database';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import * as community from './index';

const role = (over: Partial<SelfAssignableRole> = {}): SelfAssignableRole => ({
  id: 'r1',
  guildId: 'g',
  roleId: '100000000000000001',
  label: 'Minecraft',
  description: null,
  emoji: null,
  group: 'games',
  enabled: true,
  sortOrder: 0,
  ...over,
});

const welcome = { requireRulesAck: true, rulesText: 'Be nice.', docsUrl: null } as unknown as WelcomeConfig;

describe('community texts', () => {
  it('registers the community catalogue', () => {
    const keys = listTextDefinitions().filter((d) => d.namespace === 'community');
    expect(keys.length).toBeGreaterThanOrEqual(100);
    expect(keys.map((k) => k.key)).toContain('community.aboutTitle');
  });

  it('keeps the default wording outside an override scope', () => {
    expect(community.rulesEmbed(welcome).title).toBe('Server rules');
    expect(community.supportLine(null)).toBe('Still stuck? Contact the support team.');
    expect(community.groupLabel('games')).toBe('Games');
  });

  it('resolves overrides at call time', () => {
    const out = runWithTextOverrides(
      {
        'community.rulesTitle': 'Custom rules',
        'community.panelFooter': 'Custom {x}',
        'community.groupGames': 'Spiele',
        'community.raidAlertDescription': '{joins} joins in {seconds}s',
      },
      () => ({
        rules: community.rulesEmbed(welcome),
        panel: community.renderRolePanel({ title: 'Panel', description: null, groups: [] }, [role()]),
        raid: community.raidAlertEmbed(
          {
            detectedAt: new Date(0).toISOString(),
            windowStart: new Date(0).toISOString(),
            windowSeconds: 60,
            threshold: 10,
            joinsInWindow: 12,
            action: 'ALERT',
          },
          3,
        ),
      }),
    );
    expect(out.rules.title).toBe('Custom rules');
    expect(out.panel.embeds![0]!.footer?.text).toBe('Custom {x}');
    expect(out.panel.embeds![0]!.fields?.[0]?.name).toBe('Spiele');
    expect(out.raid.description).toBe('12 joins in 60s');
    // Outside the scope the defaults are back.
    expect(community.rulesEmbed(welcome).title).toBe('Server rules');
  });

  it('uses overrides in role-safety messages', () => {
    const r = runWithTextOverrides({ 'community.safetyEveryone': 'Nope' }, () =>
      community.assessRoleSafety({
        guildId: '100000000000000000',
        role: { id: '100000000000000000', position: 0, managed: false, permissions: '0' },
        botHighestPosition: 5,
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: 'EVERYONE', message: 'Nope' });
  });
});
