import { describe, expect, it } from 'vitest';
import { runWithTextOverrides } from '../core/text';
import { DUTY_PANEL_PREFIX, renderDutyControlPanel } from './duty-panel';
import { PANEL_MAX_NAMES } from './panel';

const now = new Date('2026-10-25T10:42:00Z');
const entry = (name: string, userId = '1'.repeat(18)) => ({
  userId,
  publicName: name,
  startedAt: new Date(now.getTime() - 3_600_000),
  expiresAt: new Date(now.getTime() + 3_600_000),
});
type Button = { type: number; style: number; label: string; custom_id?: string; url?: string };
const buttons = (body: ReturnType<typeof renderDutyControlPanel>) =>
  (body.components as unknown as Array<{ components: Button[] }>).flatMap((r) => r.components);
const json = (b: unknown) => JSON.stringify(b);

describe('staff duty-control panel', () => {
  it('has exactly one row of the four duty buttons with the right ids and styles', () => {
    const body = renderDutyControlPanel([], now, 'UTC');
    expect(body.components).toHaveLength(1);
    expect(buttons(body)).toEqual([
      { type: 2, style: 3, label: 'Go On Duty', custom_id: `${DUTY_PANEL_PREFIX}:on` },
      { type: 2, style: 4, label: 'Go Off Duty', custom_id: `${DUTY_PANEL_PREFIX}:off` },
      { type: 2, style: 2, label: 'My Status', custom_id: `${DUTY_PANEL_PREFIX}:me` },
      { type: 2, style: 2, label: 'View On-Duty Team', custom_id: `${DUTY_PANEL_PREFIX}:team` },
    ]);
  });

  it('never contains ticket controls or links', () => {
    const body = renderDutyControlPanel([entry('Alex')], now, 'UTC');
    expect(json(body)).not.toMatch(/ticket/i);
    expect(buttons(body).every((b) => b.custom_id?.startsWith('dutypanel:') && !b.url)).toBe(true);
  });

  it('shows the on-duty count and approved public names only (never Discord IDs)', () => {
    const staffId = '123456789012345678';
    const e = renderDutyControlPanel([entry('Alex', staffId), entry('Sam')], now, 'UTC').embeds![0]!;
    expect(e.title).toBe('Staff duty');
    expect(e.description).toContain('go on or off support duty');
    const fields = Object.fromEntries((e.fields ?? []).map((f) => [f.name, f.value]));
    expect(fields['Staff on duty']).toBe('2');
    expect(fields['On-duty team']).toBe('🟢 Alex · since 9:42 AM UTC\n🟢 Sam · since 9:42 AM UTC');
    expect(json(e)).not.toContain(staffId);
  });

  it('says nobody is on duty when empty, and caps long lists', () => {
    const empty = renderDutyControlPanel([], now, 'UTC').embeds![0]!;
    expect(json(empty)).toContain('Nobody is on duty right now.');
    const many = Array.from({ length: PANEL_MAX_NAMES + 2 }, (_, i) => entry(`Staff ${i}`));
    const team = renderDutyControlPanel(many, now, 'UTC').embeds![0]!.fields!.find(
      (f) => f.name === 'On-duty team',
    )!.value;
    expect(team.split('\n')).toHaveLength(PANEL_MAX_NAMES + 1);
    expect(team).toContain('…and 2 more');
  });

  it('every label is editable bot text', () => {
    const body = runWithTextOverrides(
      {
        'support.dutyPanelTitle': 'Duty desk',
        'support.dutyPanelOnButton': 'Clock in',
        'support.dutyPanelMember': '✅ {name}',
      },
      () => renderDutyControlPanel([entry('Alex')], now, 'UTC'),
    );
    expect(body.embeds![0]!.title).toBe('Duty desk');
    expect(buttons(body)[0]!.label).toBe('Clock in');
    expect(json(body)).toContain('✅ Alex');
  });
});
