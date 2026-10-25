import { describe, expect, it } from 'vitest';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import { AnalyticsText, outstandingField, renderMarkdown, reportEmbeds, type ReportData } from './index';
import { available, unavailable } from './metrics';

const outstanding = {
  asOf: '2026-01-08T00:00:00.000Z',
  staleAbuseReports: 1,
  activeIncidents: [{ ref: 'INC-1', title: 'API down', severity: 'MAJOR' }],
  deadJobs: 0,
  flaggedReferrals: 2,
  stalePartnerApplications: 0,
} as unknown as ReportData['outstanding'];

/** Minimal report: every metric accessed by the renderers resolves to "unavailable". */
function report(): ReportData {
  const na = unavailable('no data has been recorded yet');
  const sec = (extra: Record<string, unknown> = {}) =>
    new Proxy(extra, { get: (t, k: string) => (k in t ? t[k] : k === 'uptime' ? [] : na) });
  const section = sec();
  return {
    version: 1,
    guildId: 'g',
    timezone: 'UTC',
    period: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-08T00:00:00.000Z' },
    previousPeriod: { start: '2025-12-25T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' },
    generatedAt: '2026-01-08T00:00:00.000Z',
    community: sec({ totalMembers: available(120), activeMemberThreshold: 1 }),
    referrals: section,
    moderation: section,
    infrastructure: section,
    marketing: section,
    outstanding,
    summary: ['Hello'],
    flat: [],
  } as unknown as ReportData;
}

describe('analytics texts', () => {
  it('registers the analytics catalogue', () => {
    expect(AnalyticsText.settingsTitle()).toBe('Server settings');
    const keys = listTextDefinitions().filter((d) => d.namespace === 'analytics');
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.every((k) => k.key.startsWith('analytics.') && k.help.length > 0)).toBe(true);
  });

  it('resolves overrides at render time in the summary embed', () => {
    const [def] = reportEmbeds(report());
    expect(def!.title).toContain('Weekly CEO report · ');
    expect(def!.fields!.some((f) => f.name === 'Needs attention')).toBe(true);

    const [e] = runWithTextOverrides(
      {
        'analytics.reportDefaultTitle': 'Custom report',
        'analytics.needsAttentionField': 'Custom {x}',
        'analytics.summaryCommunityValue': 'Members are {members}',
      },
      () => reportEmbeds(report()),
    );
    expect(e!.title).toContain('Custom report · ');
    expect(e!.fields!.some((f) => f.name === 'Custom {x}')).toBe(true);
    expect(e!.fields!.some((f) => f.value === 'Members are 120')).toBe(true);
  });

  it('resolves overrides in the Markdown report and embed fields', () => {
    const md = runWithTextOverrides(
      {
        'analytics.mdHeadingSupport': 'Custom support heading',
        'analytics.notAvailable': 'N/A ({reason})',
      },
      () => renderMarkdown(report()),
    );
    expect(md).toContain('## Custom support heading');
    expect(md).toContain('N/A (no data has been recorded yet)');
    expect(md).not.toContain('## 3. Support');

    const field = runWithTextOverrides(
      { 'analytics.needsAttentionValue': 'Stale {staleReports}{incidentRefs}' },
      () => outstandingField(outstanding),
    );
    expect(field.value).toBe('Stale 1 (INC-1)');
    // Outside the scope the default wording is back.
    expect(outstandingField(outstanding).value).toContain('Open reports > 72h: **1**');
  });
});
