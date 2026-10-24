import { toZonedInput } from '../../community/datetime';
import type { EventDraft } from './event-form';

export interface EventLike {
  title: string;
  description: string;
  location: string | null;
  startsAt: Date | string;
  endsAt: Date | string | null;
  timezone: string;
  capacity: number | null;
  waitlistEnabled: boolean;
  reminderMinutesBefore: number[];
}

/** Prefill the edit form from a stored event, in the event's own time zone (server use). */
export function eventToDraft(ev: EventLike): EventDraft {
  return {
    title: ev.title,
    description: ev.description,
    location: ev.location ?? '',
    start: toZonedInput(ev.startsAt, ev.timezone),
    end: toZonedInput(ev.endsAt, ev.timezone),
    capacity: ev.capacity === null ? '' : String(ev.capacity),
    waitlistEnabled: ev.waitlistEnabled,
    reminders: [...ev.reminderMinutesBefore].sort((a, b) => b - a),
    channelId: '',
  };
}
