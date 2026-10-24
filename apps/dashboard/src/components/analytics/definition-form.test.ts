import { describe, expect, it } from 'vitest';
import { definitionToForm, emptyDefinitionForm, formToPayload } from './definition-form';

describe('report definition form mapping', () => {
  it('maps a valid form to the API payload', () => {
    const f = {
      ...emptyDefinitionForm('Europe/London'),
      name: '  Weekly CEO report ',
      periodDays: '14',
      channelId: '123456789012345678',
    };
    expect(formToPayload(f)).toEqual({
      ok: true,
      payload: {
        name: 'Weekly CEO report',
        enabled: true,
        day: 'MONDAY',
        time: '09:00',
        timezone: 'Europe/London',
        periodDays: 14,
        channelId: '123456789012345678',
      },
    });
    expect(formToPayload({ ...f, channelId: '' })).toMatchObject({ ok: true, payload: { channelId: null } });
  });

  it('reports field errors', () => {
    const r = formToPayload({
      name: '',
      enabled: true,
      day: 'FUNDAY',
      time: '25:00',
      timezone: ' ',
      periodDays: '32',
      channelId: 'abc',
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual([
        'channelId',
        'day',
        'name',
        'periodDays',
        'time',
        'timezone',
      ]);
    expect(formToPayload({ ...emptyDefinitionForm('UTC'), name: 'x', periodDays: '1.5' }).ok).toBe(false);
    expect(formToPayload({ ...emptyDefinitionForm('UTC'), name: 'x', periodDays: '0' }).ok).toBe(false);
  });

  it('round-trips a stored definition', () => {
    const d = {
      name: 'A',
      enabled: false,
      day: 'FRIDAY',
      time: '17:30',
      timezone: 'UTC',
      periodDays: 7,
      channelId: null,
    };
    expect(formToPayload(definitionToForm(d))).toEqual({ ok: true, payload: { ...d, day: 'FRIDAY' } });
  });
});
