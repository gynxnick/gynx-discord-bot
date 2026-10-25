import { describe, expect, it } from 'vitest';
import { runWithTextOverrides } from '../core/text';
import { cleanPublicName } from './duty';
import { PANEL_MAX_NAMES, formatLastUpdated, renderSupportPanel, type PanelInput } from './panel';

const at = new Date('2026-10-25T10:42:00Z');
const entry = (name: string) => ({
  userId: '1'.repeat(18),
  publicName: name,
  startedAt: at,
  expiresAt: new Date(at.getTime() + 3_600_000),
});
const base = (over: Partial<PanelInput> = {}): PanelInput => ({
  onDuty: [],
  lastUpdated: at,
  timeZone: 'UTC',
  websiteUrl: null,
  now: at,
  ...over,
});
const json = (b: unknown) => JSON.stringify(b);

describe('support status panel', () => {
  it('online: headline, team list, counts and closing line, matching the spec', () => {
    const body = renderSupportPanel(base({ onDuty: [entry('Staff Member A'), entry('Staff Member B')] }));
    const e = body.embeds![0]!;
    expect(e.title).toBe('GYNX.GG | LIVE SUPPORT');
    expect(e.description).toContain('🟢 **Support is online**');
    expect(e.description).toContain('**2 staff members on duty**');
    const fields = Object.fromEntries((e.fields ?? []).map((f) => [f.name, f.value]));
    expect(fields['ON-DUTY TEAM']).toBe('🟢 Staff Member A\n🟢 Staff Member B');
    expect(fields.Availability).toBe('Available');
    expect(fields['Staff on duty']).toBe('2');
    expect(fields['Last updated']).toBe('10:42 AM UTC');
    expect(json(e)).toContain('Submit and manage your support requests through the GYNX website.');
  });

  it('uses the singular sentence for one staff member', () => {
    const e = renderSupportPanel(base({ onDuty: [entry('Alex')] })).embeds![0]!;
    expect(e.description).toContain('**1 staff member on duty**');
  });

  it('offline: offline headline and text, no team list', () => {
    const e = renderSupportPanel(base()).embeds![0]!;
    expect(e.description).toContain('⚫ **Support is currently offline**');
    expect(e.description).toContain('You can still submit a support request through the GYNX website');
    const names = (e.fields ?? []).map((f) => f.name);
    expect(names).not.toContain('ON-DUTY TEAM');
    expect(Object.fromEntries((e.fields ?? []).map((f) => [f.name, f.value])).Availability).toBe('Offline');
  });

  it('never contains ticket controls: only an optional website link button', () => {
    const none = renderSupportPanel(base({ onDuty: [entry('A')] }));
    expect(none.components).toEqual([]);
    const withSite = renderSupportPanel(base({ websiteUrl: 'https://gynx.gg' }));
    const buttons = (
      withSite.components as unknown as Array<{ components: Array<Record<string, unknown>> }>
    ).flatMap((r) => r.components);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ style: 5, label: 'Visit GYNX Website', url: 'https://gynx.gg' });
    expect(buttons[0]!.custom_id).toBeUndefined(); // a link, not an interactive control
    expect(json(withSite)).not.toMatch(/ticket/i);
  });

  it('ignores a website URL that is not https', () => {
    expect(renderSupportPanel(base({ websiteUrl: 'http://gynx.gg' })).components).toEqual([]);
    expect(renderSupportPanel(base({ websiteUrl: 'javascript:alert(1)' })).components).toEqual([]);
  });

  it('caps the name list and says how many more are on duty', () => {
    const many = Array.from({ length: PANEL_MAX_NAMES + 3 }, (_, i) => entry(`Staff ${i}`));
    const team = renderSupportPanel(base({ onDuty: many })).embeds![0]!.fields!.find(
      (f) => f.name === 'ON-DUTY TEAM',
    )!.value;
    expect(team.split('\n')).toHaveLength(PANEL_MAX_NAMES + 1);
    expect(team).toContain('…and 3 more');
  });

  it('shows the last change in the server time zone, with the date when not today', () => {
    expect(formatLastUpdated(at, 'America/New_York', at)).toBe('6:42 AM EDT');
    expect(formatLastUpdated(at, 'UTC', new Date('2026-10-27T09:00:00Z'))).toBe('Oct 25, 10:42 AM UTC');
  });

  it('every line of the panel is editable bot text', () => {
    const body = runWithTextOverrides(
      { 'support.panelTitle': 'GYNX | Help desk', 'support.onDutyMember': '✅ {name}' },
      () => renderSupportPanel(base({ onDuty: [entry('Alex')] })),
    );
    expect(body.embeds![0]!.title).toBe('GYNX | Help desk');
    expect(json(body)).toContain('✅ Alex');
  });
});

describe('cleanPublicName', () => {
  it('accepts plain names and normalises spaces', () => {
    expect(cleanPublicName('  Alex   M  ')).toBe('Alex M');
  });

  it.each([
    '',
    '@everyone',
    '<@123456789012345678>',
    'Alex https://evil.example',
    '**Alex**',
    'x'.repeat(33),
    '123456789',
  ])('rejects %j (mentions, links, formatting, IDs, too long)', (bad) => {
    expect(() => cleanPublicName(bad)).toThrow();
  });
});
