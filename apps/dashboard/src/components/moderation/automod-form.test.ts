import { describe, expect, it } from 'vitest';
import {
  automodPatch,
  automodToForm,
  normalizeDomain,
  normalizeInvite,
  type AutomodConfigView,
} from './automod-form';

const cfg: AutomodConfigView = {
  enabled: true,
  duplicateThreshold: 4,
  duplicateWindowSeconds: 30,
  maxMentions: 6,
  burstThreshold: 8,
  burstWindowSeconds: 10,
  blockInvites: true,
  allowedInviteCodes: [],
  blockedDomains: ['bad.example'],
  allowedDomains: [],
  blockedPhrases: [],
  phishingDetection: true,
  newAccountDays: 7,
  exemptRoleIds: [],
  exemptChannelIds: [],
  strikeWindowHours: 24,
  warnAtStrikes: 2,
  timeoutAtStrikes: 4,
  timeoutMinutes: 30,
  warningExpiryDays: 90,
};

describe('automod form', () => {
  it('normalises domains and invite codes like the service', () => {
    expect(normalizeDomain('https://Example.COM/path?q=1')).toBe('example.com');
    expect(normalizeDomain('*.sub.example.org.')).toBe('sub.example.org');
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeInvite('https://discord.gg/gynx')).toBe('gynx');
    expect(normalizeInvite('discord.com/invite/abc-12')).toBe('abc-12');
    expect(normalizeInvite('x')).toBeNull();
  });

  it('only sends changed fields', () => {
    const form = automodToForm(cfg);
    expect(automodPatch(cfg, form)).toEqual({ patch: {}, errors: {} });
    form.numbers.maxMentions = '10';
    form.flags.phishingDetection = false;
    form.lists.blockedPhrases = ['free nitro'];
    expect(automodPatch(cfg, form)).toEqual({
      patch: { maxMentions: 10, phishingDetection: false, blockedPhrases: ['free nitro'] },
      errors: {},
    });
  });

  it('validates ranges, strike order and domain overlap', () => {
    const form = automodToForm(cfg);
    form.numbers.burstWindowSeconds = '500';
    form.numbers.timeoutAtStrikes = '2';
    form.lists.allowedDomains = ['bad.example'];
    const { errors } = automodPatch(cfg, form);
    expect(errors).toMatchObject({
      burstWindowSeconds: 'Must be between 3 and 120.',
      timeoutAtStrikes: 'Must be higher than the warning strike count.',
      allowedDomains: expect.stringContaining('bad.example'),
    });
  });
});
