import { describe, expect, it } from 'vitest';
import {
  addReminder,
  customReminderMinutes,
  emptyEventDraft,
  eventDraftToPayload,
  formatMinutes,
  groupAttendees,
  parseEventView,
  validateEventDraft,
  type EventDraft,
} from './event-form';

const draft = (patch: Partial<EventDraft> = {}): EventDraft => ({
  ...emptyEventDraft(),
  title: 'Game night',
  description: 'Bring snacks',
  start: '2026-11-05T19:30',
  ...patch,
});

describe('event form', () => {
  it('formats reminder minutes', () => {
    expect(formatMinutes(15)).toBe('15 min');
    expect(formatMinutes(60)).toBe('1 hour');
    expect(formatMinutes(120)).toBe('2 hours');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(1440)).toBe('1 day');
    expect(formatMinutes(2880)).toBe('2 days');
  });

  it('adds reminders: distinct, at most 3, within 7 days, sorted descending', () => {
    expect(addReminder([60], 1440)).toEqual({ list: [1440, 60] });
    expect(addReminder([60], 60).error).toMatch(/already/);
    expect(addReminder([15, 60, 1440], 30).error).toMatch(/At most 3/);
    expect(addReminder([], 0).error).toBeDefined();
    expect(addReminder([], 10_081).error).toMatch(/7 days/);
    expect(addReminder([], 1.5).error).toBeDefined();
  });

  it('converts custom reminder units', () => {
    expect(customReminderMinutes('2', 'hours')).toBe(120);
    expect(customReminderMinutes('1', 'days')).toBe(1440);
    expect(Number.isNaN(customReminderMinutes('', 'minutes'))).toBe(true);
  });

  it('validates required fields, end after start and capacity', () => {
    expect(validateEventDraft(draft())).toEqual({});
    const e = validateEventDraft(draft({ title: 'ab', description: ' ', start: '' }));
    expect(Object.keys(e).sort()).toEqual(['description', 'start', 'title']);
    expect(validateEventDraft(draft({ end: '2026-11-05T19:30' })).end).toMatch(/after the start/);
    expect(validateEventDraft(draft({ end: '2026-11-05T18:00' })).end).toMatch(/after the start/);
    expect(validateEventDraft(draft({ end: '2026-11-05T21:00' }))).toEqual({});
    expect(validateEventDraft(draft({ capacity: '0' })).capacity).toBeDefined();
    expect(validateEventDraft(draft({ capacity: '2.5' })).capacity).toBeDefined();
    expect(validateEventDraft(draft({ capacity: '50' }))).toEqual({});
    expect(validateEventDraft(draft({ reminders: [60, 60] })).reminderMinutesBefore).toBeDefined();
  });

  it('maps the draft to an API payload', () => {
    expect(
      eventDraftToPayload(
        draft({ location: '  ', capacity: '', end: '', channelId: '123456789012345678' }),
        'create',
      ),
    ).toEqual({
      title: 'Game night',
      description: 'Bring snacks',
      location: null,
      start: '2026-11-05T19:30',
      end: null,
      capacity: null,
      waitlistEnabled: true,
      reminderMinutesBefore: [60],
      channelId: '123456789012345678',
    });
    const edit = eventDraftToPayload(draft({ capacity: '10', channelId: '123456789012345678' }), 'edit');
    expect(edit.capacity).toBe(10);
    expect('channelId' in edit).toBe(false);
    expect('channelId' in eventDraftToPayload(draft(), 'create')).toBe(false);
  });

  it('groups attendees GOING then WAITLIST preserving order', () => {
    const rows = [
      { userId: 'a', status: 'GOING' },
      { userId: 'w1', status: 'WAITLIST' },
      { userId: 'b', status: 'GOING' },
      { userId: 'w2', status: 'WAITLIST' },
    ];
    const g = groupAttendees(rows);
    expect(g.going.map((r) => r.userId)).toEqual(['a', 'b']);
    expect(g.waitlist.map((r) => r.userId)).toEqual(['w1', 'w2']);
  });

  it('parses the list view', () => {
    expect(parseEventView(undefined)).toBe('upcoming');
    expect(parseEventView('past')).toBe('past');
    expect(parseEventView('all')).toBe('all');
    expect(parseEventView('nope')).toBe('upcoming');
  });
});
