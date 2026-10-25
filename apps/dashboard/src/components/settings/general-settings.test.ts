import { describe, expect, it } from 'vitest';
import { buildPatch, toForm, type SettingsView } from './general-settings';

const base: SettingsView = {
  timezone: 'UTC',
  enabledModules: ['status', 'moderation'],
  channels: { log: null, status: '123456789012345678' },
  roles: { staffPing: null },
  supportUrl: null,
  status: { checkIntervalSeconds: 60, failureThreshold: 3, recoveryThreshold: 2, alertCooldownMinutes: 15 },
  retention: { diagnosticHours: 24, reportDays: 365, auditDays: 365, healthCheckDays: 30, activityDays: 90 },
  activeMemberMinMessages: 1,
  reportNotifyReporter: false,
  suggestionThreads: true,
  embedFooter: 'GYNX.GG',
};

describe('general settings patch', () => {
  it('is empty when nothing changed (module order does not matter)', () => {
    const form = toForm(base);
    form.enabledModules = ['moderation', 'status'];
    expect(buildPatch(base, form)).toEqual({ patch: {}, errors: {} });
  });

  it('sends only changed fields, nested groups only with changed keys', () => {
    const form = toForm(base);
    form.timezone = 'Europe/London';
    form.channels.log = '223456789012345678';
    form.channels.status = null;
    form.numbers['status.failureThreshold'] = '5';
    form.numbers['retention.auditDays'] = '400';
    form.supportUrl = ' https://support.gynx.gg ';
    form.reportNotifyReporter = true;
    const { patch, errors } = buildPatch(base, form, new Set(['UTC', 'Europe/London']));
    expect(errors).toEqual({});
    expect(patch).toEqual({
      timezone: 'Europe/London',
      channels: { log: '223456789012345678', status: null },
      supportUrl: 'https://support.gynx.gg',
      status: { failureThreshold: 5 },
      retention: { auditDays: 400 },
      reportNotifyReporter: true,
    });
  });

  it('reports field errors with API-style paths', () => {
    const form = toForm(base);
    form.timezone = 'Mars/Olympus';
    form.numbers['retention.auditDays'] = '10';
    form.numbers['status.checkIntervalSeconds'] = '1.5';
    form.roles.staffPing = 'abc';
    form.supportUrl = 'http://insecure.example';
    form.embedFooter = '  ';
    const { errors } = buildPatch(base, form, new Set(['UTC']));
    expect(Object.keys(errors).sort()).toEqual([
      'embedFooter',
      'retention.auditDays',
      'roles.staffPing',
      'status.checkIntervalSeconds',
      'supportUrl',
      'timezone',
    ]);
    expect(errors['retention.auditDays']).toBe('Must be between 90 and 3650.');
  });

  it('clears the support URL with null', () => {
    const withUrl = { ...base, supportUrl: 'https://support.gynx.gg' };
    const form = toForm(withUrl);
    form.supportUrl = '';
    expect(buildPatch(withUrl, form).patch).toEqual({ supportUrl: null });
  });
});
