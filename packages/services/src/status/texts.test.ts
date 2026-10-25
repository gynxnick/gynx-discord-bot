import { describe, expect, it } from 'vitest';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import * as status from './index';

const svc: status.PublicService = {
  slug: 'panel',
  name: 'Game Panel',
  region: 'EU-West',
  description: null,
  state: 'OUTAGE',
  lastCheckedAt: null,
  lastStateChangeAt: null,
};

const page = (over: Partial<status.PublicStatus> = {}): status.PublicStatus => ({
  overall: 'OUTAGE',
  services: [svc],
  activeIncidents: [],
  upcomingMaintenance: [],
  generatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('status texts', () => {
  it('registers the status catalogue', () => {
    const keys = listTextDefinitions().filter((d) => d.namespace === 'status');
    expect(keys.length).toBeGreaterThanOrEqual(80);
    expect(status.StatusText.pageTitle).toBeTypeOf('function');
  });

  it('keeps the default wording', () => {
    const e = status.statusPageEmbed(page());
    expect(e.title).toBe('GYNX.GG Service Status');
    expect(e.description).toBe('🔴 Some systems are experiencing an outage');
    expect(e.fields?.[0]?.value).toBe('🔴 **Game Panel** · EU-West — Outage');
    expect(e.fields?.[1]?.value).toBe('None');
    expect(status.alertEmbed(svc, 'OPERATIONAL').title).toBe('🔴 Game Panel · Outage');
    expect(status.statusButtons()[0]!.components.map((c) => ('label' in c ? c.label : ''))).toEqual([
      'Notify me about incidents',
      'Stop notifications',
      'Incident history',
    ]);
  });

  it('applies server overrides at render time', () => {
    runWithTextOverrides(
      {
        'status.pageTitle': 'Custom {x}',
        'status.stateOutage': 'Down',
        'status.alertOutage': 'Uh oh, {service} broke.',
        'status.buttonSubscribe': 'Ping me',
      },
      () => {
        const e = status.statusPageEmbed(page());
        expect(e.title).toBe('Custom {x}');
        expect(e.fields?.[0]?.value).toBe('🔴 **Game Panel** · EU-West — Down');
        const alert = status.alertEmbed(svc, 'OPERATIONAL');
        expect(alert.title).toBe('🔴 Game Panel · Down');
        expect(alert.description).toBe('Uh oh, Game Panel broke.');
        expect(JSON.stringify(status.statusButtons())).toContain('Ping me');
      },
    );
    // Outside the scope the defaults are back.
    expect(status.statusPageEmbed(page()).title).toBe('GYNX.GG Service Status');
  });

  it('board fingerprint ignores the clock but changes with overridden wording', () => {
    const a = status.boardFingerprint(page());
    expect(status.boardFingerprint(page({ generatedAt: new Date('2026-06-01T00:00:00Z') }))).toBe(a);
    const overridden = runWithTextOverrides({ 'status.boardFooter': 'Live!' }, () =>
      status.boardFingerprint(page()),
    );
    expect(overridden).not.toBe(a);
    const body = runWithTextOverrides({ 'status.boardUpdatedLine': 'Refreshed {time}' }, () =>
      status.statusBoardMessage(page(), new Date('2026-01-01T00:00:00Z')),
    );
    expect(body.embeds?.[0]?.description).toContain('Refreshed <t:');
  });
});
