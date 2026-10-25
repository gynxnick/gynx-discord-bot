import { describe, expect, it } from 'vitest';
import { setup } from '@gynx/services';
import { configToForm, extraRestrictedRoles, formToPatch, isHexColor, normalizeHex } from './config-form';
import { toJsonSafe } from './json-safe';
import { countFindings, groupChanges, isRollbackCandidate, progressOf, sortFindings } from './preview-utils';
import { buildBlueprintView } from './server/blueprint-view';
import type { PlannedChangeView } from './types';

const bp = buildBlueprintView();
const base = setup.DEFAULT_SETUP_CONFIG;

describe('colour validation', () => {
  it('accepts only #RRGGBB', () => {
    expect(isHexColor('#22D3EE')).toBe(true);
    expect(isHexColor('#22d3ee')).toBe(true);
    expect(isHexColor('22D3EE')).toBe(false);
    expect(isHexColor('#22D3E')).toBe(false);
    expect(isHexColor('#GGGGGG')).toBe(false);
  });
  it('normalises typed values', () => {
    expect(normalizeHex(' 22d3ee ')).toBe('#22D3EE');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
});

describe('config form ↔ patch', () => {
  it('blueprint view is JSON-safe (no bigint)', () => {
    expect(() => JSON.stringify(bp)).not.toThrow();
    expect(bp.roles.find((r) => r.key === 'moderator')!.permissions).toContain('KickMembers');
    expect(bp.routing.some((r) => r.resourceKey === 'mod-logs' && r.feature === 'Moderation log')).toBe(true);
  });

  it('an untouched form produces an empty patch', () => {
    const form = configToForm(base, bp);
    expect(form.roles.founder).toEqual({ name: 'Founder', color: '#22D3EE' });
    expect(form.names.welcome).toBe('👋・welcome');
    expect(form.slowmode.general).toBe('3');
    expect(form.slowmode['community-lounge']).toBeUndefined(); // voice
    expect(Object.values(form.components).every(Boolean)).toBe(true);
    expect(formToPatch(base, form, bp)).toEqual({ patch: {}, errors: {} });
  });

  it('stores only overrides that differ from the blueprint, and only changed keys', () => {
    const form = configToForm(base, bp);
    form.roles.founder = { name: 'Owner', color: '#22d3ee' }; // same colour, different case
    form.names.general = '💬・chat';
    form.names.welcome = '  👋・welcome  '; // trims back to default
    form.included.gaming = false;
    form.slowmode.general = '5';
    form.slowmode.showcase = '30'; // default
    form.restricted['mod-logs'] = ['founder', 'moderator'];
    form.showStaffNames = false;
    const { patch, errors } = formToPatch(base, form, bp);
    expect(errors).toEqual({});
    expect(patch).toEqual({
      roles: { founder: { name: 'Owner' } },
      names: { general: '💬・chat' },
      excludedChannels: ['gaming'],
      slowmode: { general: 5 },
      restrictedAccess: { 'mod-logs': ['founder', 'moderator'] },
      showStaffNames: false,
    });
  });

  it('round-trips a saved config', () => {
    const saved = setup.setupConfigSchema.parse({
      roles: { support: { color: '#112233' } },
      names: { 'start-here': 'START' },
      components: ['roles', 'permissions'],
      excludedChannels: ['gaming'],
      slowmode: { general: 10 },
      restrictedAccess: { 'staff-reports': ['founder'] },
      showStaffNames: false,
    });
    const form = configToForm(saved, bp);
    expect(form.components.roles).toBe(true);
    expect(form.components.embeds).toBe(false);
    expect(form.included.gaming).toBe(false);
    expect(formToPatch(saved, form, bp).patch).toEqual({});
    // Selecting every component stores [] (= everything).
    for (const k of Object.keys(form.components)) form.components[k] = true;
    expect(formToPatch(saved, form, bp).patch).toEqual({ components: [] });
  });

  it('reports errors with API-compatible paths', () => {
    const form = configToForm(base, bp);
    form.roles.support = { name: ' ', color: 'blue' };
    form.names.rules = 'x'.repeat(101);
    form.slowmode.general = '1.5';
    form.slowmode.gaming = '99999';
    form.restricted['abuse-reports'] = [];
    for (const k of Object.keys(form.components)) form.components[k] = false;
    const { errors } = formToPatch(base, form, bp);
    expect(Object.keys(errors).sort()).toEqual(
      [
        'components',
        'names.rules',
        'restrictedAccess.abuse-reports',
        'roles.support.color',
        'roles.support.name',
        'slowmode.gaming',
        'slowmode.general',
      ].sort(),
    );
  });

  it('a generated patch passes the server schema', () => {
    const form = configToForm(base, bp);
    form.roles.partner = { name: 'Partners', color: '#abc' };
    form.restricted['staff-duty'] = ['founder', 'support'];
    const { patch } = formToPatch(base, form, bp);
    expect(setup.setupConfigSchema.partial().safeParse(patch).success).toBe(true);
    expect(patch.roles).toEqual({ partner: { name: 'Partners', color: '#AABBCC' } });
  });

  it('flags non-default roles on restricted channels', () => {
    const abuse = bp.categories.flatMap((c) => c.channels).find((c) => c.key === 'abuse-reports')!;
    expect(extraRestrictedRoles(abuse, ['founder', 'moderator'])).toEqual(['moderator']);
  });
});

const change = (kind: PlannedChangeView['kind'], key: string, risk: 'safe' | 'disruptive' = 'safe') =>
  ({ kind, key, risk, description: key, name: key, discordId: '1' }) as unknown as PlannedChangeView;

describe('preview helpers', () => {
  it('groups changes in apply order with disruptive first', () => {
    const groups = groupChanges([
      change('message.deploy', 'm1'),
      change('channel.create', 'c1'),
      change('role.update', 'r2', 'disruptive'),
      change('role.create', 'r1'),
      change('channel.update', 'c2', 'disruptive'),
      change('role.adopt', 'r3'),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['roles', 'channels', 'messages']);
    expect(groups[0]!.changes.map((c) => c.key)).toEqual(['r2', 'r1', 'r3']);
    expect(groups[0]!.disruptive).toBe(1);
    expect(groups[1]!.changes.map((c) => c.key)).toEqual(['c2', 'c1']);
    expect(groupChanges([])).toEqual([]);
  });

  it('sorts findings blocking → warning → info (stable)', () => {
    const f = [
      { level: 'info' as const, code: 'a', message: 'a' },
      { level: 'blocking' as const, code: 'b', message: 'b' },
      { level: 'warning' as const, code: 'c', message: 'c' },
      { level: 'blocking' as const, code: 'd', message: 'd' },
    ];
    expect(sortFindings(f).map((x) => x.code)).toEqual(['b', 'd', 'c', 'a']);
    expect(countFindings(f)).toEqual({ blocking: 2, warning: 1, info: 1 });
  });

  it('computes progress from checkpoints', () => {
    const p = progressOf(
      [{ status: 'APPLIED' }, { status: 'SKIPPED' }, { status: 'FAILED' }, { status: 'PENDING' }],
      8,
    );
    expect(p).toMatchObject({ total: 8, done: 3, applied: 1, skipped: 1, failed: 1, percent: 38 });
    expect(progressOf([], 0).percent).toBe(100);
  });

  it('offers rollback only for applied, non-rollback operations', () => {
    expect(isRollbackCandidate({ type: 'START', status: 'SUCCEEDED' })).toBe(true);
    expect(isRollbackCandidate({ type: 'REPAIR', status: 'PARTIAL' })).toBe(true);
    expect(isRollbackCandidate({ type: 'START', status: 'PREVIEWED' })).toBe(false);
    expect(isRollbackCandidate({ type: 'ROLLBACK', status: 'SUCCEEDED' })).toBe(false);
  });

  it('toJsonSafe converts bigint and Date', () => {
    const out = toJsonSafe({ a: 5n, d: new Date('2026-01-01T00:00:00Z'), n: [1n], u: undefined });
    expect(out).toEqual({ a: '5', d: '2026-01-01T00:00:00.000Z', n: ['1'] });
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
