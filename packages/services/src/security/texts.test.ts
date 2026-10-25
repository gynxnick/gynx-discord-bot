import { describe, expect, it } from 'vitest';
import type { AbuseReport } from '@gynx/database';
import { listTextDefinitions, runWithTextOverrides } from '../core/text';
import * as security from './index';

const report = (over: Partial<AbuseReport> = {}): AbuseReport =>
  ({
    id: 'rep_1',
    guildId: '100000000000000001',
    number: 7,
    ref: 'R-0007',
    category: 'SPAM_PHISHING',
    reporterId: '100000000000000002',
    reportedUserId: null,
    description: 'Someone posted a phishing link in general chat.',
    evidenceUrls: [],
    messageLink: null,
    status: 'NEW',
    assigneeId: null,
    resolution: null,
    resolvedAt: null,
    notifyReporter: true,
    reporterNotifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as AbuseReport;

describe('security texts', () => {
  it('registers the security catalogue', () => {
    const keys = listTextDefinitions().filter((d) => d.namespace === 'security');
    expect(keys.length).toBeGreaterThanOrEqual(35);
    expect(security.SecurityText.notifyTitle).toBeTypeOf('function');
  });

  it('keeps the default wording', () => {
    const e = security.reportNotificationEmbed(report());
    expect(e.title).toBe('New report R-0007 · Spam / phishing');
    expect(e.fields?.[0]).toMatchObject({ name: 'Reported user', value: 'Not specified' });
    expect(security.reporterUpdateEmbed(report({ status: 'RESOLVED' })).title).toBe(
      'Your report R-0007 has been reviewed',
    );
  });

  it('applies overrides at call time', () => {
    const overrides = {
      'security.notifyTitle': 'Custom {ref} / {category}',
      'security.categorySpamPhishing': 'Scam',
      'security.reporterUpdateDismissed': 'Custom closed',
      'security.claimButton': 'Take it',
    };
    runWithTextOverrides(overrides, () => {
      const e = security.reportNotificationEmbed(report());
      expect(e.title).toBe('Custom R-0007 / Scam');
      const [row] = security.reportStaffButtons(report());
      expect(row!.components[0]).toMatchObject({ label: 'Take it' });
      expect(security.reporterUpdateEmbed(report({ status: 'DISMISSED' })).description).toBe('Custom closed');
      expect(security.reportCategoryLabel('SPAM_PHISHING')).toBe('Scam');
    });
    // Outside the scope the defaults are back.
    expect(security.reportNotificationEmbed(report()).title).toBe('New report R-0007 · Spam / phishing');
  });
});
