import { z } from 'zod';
import { engagement, getGuildConfig } from '@gynx/services';
import { inputToWallClock, toZonedInput } from '../../../../components/community/datetime';
import { defineRoute } from '../../community/_lib/route-def';

/**
 * Event API route definitions (events.manage), bound in the sibling route.ts
 * files. Date-times arrive as guild wall-clock values from
 * `<input type="datetime-local">` and are converted here; the end time
 * becomes the service's `durationMinutes`.
 */

export const boolParam = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

/** "YYYY-MM-DDTHH:MM" (datetime-local) or "YYYY-MM-DD HH:MM". */
export const wallClockSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, 'Pick a date and time.');

/** Throw a validation error attached to one form field (rendered under that field). */
export function fieldIssue(field: string, message: string): never {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: [field], message }]);
}

/** Minutes between two wall-clock times in `tz`; enforces end > start and the service's 5 min..7 day range. */
export function eventDurationMinutes(start: string, end: string, tz: string): number {
  const s = engagement.parseEventTime(inputToWallClock(start), tz);
  const e = engagement.parseEventTime(inputToWallClock(end), tz);
  const minutes = Math.round((e.getTime() - s.getTime()) / 60_000);
  if (minutes <= 0) fieldIssue('end', 'The end must be after the start.');
  if (minutes < 5) fieldIssue('end', 'Events must last at least 5 minutes.');
  if (minutes > 7 * 24 * 60) fieldIssue('end', 'Events can last at most 7 days.');
  return minutes;
}

const shape = engagement.createEventSchema.shape;

const eventFormFields = {
  title: shape.title,
  description: shape.description,
  location: shape.location,
  start: wallClockSchema,
  end: wallClockSchema.nullable().optional(),
  capacity: shape.capacity,
  waitlistEnabled: shape.waitlistEnabled,
  reminderMinutesBefore: shape.reminderMinutesBefore,
};

export const eventCreateBodySchema = z.object({ ...eventFormFields, channelId: shape.channelId }).strict();
export const eventUpdateBodySchema = z.object(eventFormFields).partial().strict();

export const listEventsQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED']).optional(),
  upcoming: boolParam,
  q: z.string().trim().max(100).optional(),
});

/** GET /api/engagement/events */
export const listEvents = defineRoute(
  { permission: 'events.manage', schema: listEventsQuery },
  async ({ ctx, input }) => engagement.listEvents(ctx, input),
);

/** POST /api/engagement/events — create and publish (channel defaults to the configured event channel). */
export const createEvent = defineRoute(
  { permission: 'events.manage', mutation: true, schema: eventCreateBodySchema },
  async ({ ctx, input }) => {
    const { timezone } = await getGuildConfig(ctx.db, ctx.guildId);
    const durationMinutes = input.end ? eventDurationMinutes(input.start, input.end, timezone) : null;
    return engagement.createEvent(ctx, {
      title: input.title,
      description: input.description,
      location: input.location ?? null,
      startsAt: inputToWallClock(input.start),
      timezone,
      durationMinutes,
      capacity: input.capacity ?? null,
      waitlistEnabled: input.waitlistEnabled,
      reminderMinutesBefore: input.reminderMinutesBefore,
      channelId: input.channelId,
    });
  },
);

/** PATCH /api/engagement/events/:id — scheduled events only (the service enforces it). Times are in the event's own time zone. */
export const updateEvent = defineRoute(
  { permission: 'events.manage', mutation: true, schema: eventUpdateBodySchema },
  async ({ ctx, input, params }) => {
    const id = params.id ?? '';
    const { event } = await engagement.getEvent(ctx, id);
    const tz = event.timezone;
    let durationMinutes: number | null | undefined;
    if (input.end === null) durationMinutes = null;
    else if (input.end !== undefined)
      durationMinutes = eventDurationMinutes(input.start ?? toZonedInput(event.startsAt, tz), input.end, tz);
    return engagement.updateEvent(ctx, id, {
      title: input.title,
      description: input.description,
      location: input.location,
      startsAt: input.start !== undefined ? inputToWallClock(input.start) : undefined,
      durationMinutes,
      capacity: input.capacity,
      waitlistEnabled: input.waitlistEnabled,
      reminderMinutesBefore: input.reminderMinutesBefore,
    });
  },
);

export const reasonBodySchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

/** POST /api/engagement/events/:id/cancel — stops reminders and notifies attendees. */
export const cancelEvent = defineRoute(
  { permission: 'events.manage', mutation: true, schema: reasonBodySchema },
  async ({ ctx, input, params }) => engagement.cancelEvent(ctx, params.id ?? '', input.reason || undefined),
);

export const summaryBodySchema = z
  .object({ summary: z.string().trim().min(10, 'At least 10 characters.').max(2000) })
  .strict();

/** POST /api/engagement/events/:id/summary — after the start; marks the event COMPLETED. */
export const postEventSummary = defineRoute(
  { permission: 'events.manage', mutation: true, schema: summaryBodySchema },
  async ({ ctx, input, params }) => engagement.postEventSummary(ctx, params.id ?? '', input.summary),
);

/** GET /api/engagement/events/:id/attendees — GOING then WAITLIST (user ids only). */
export const listEventAttendees = defineRoute({ permission: 'events.manage' }, async ({ ctx, params }) => ({
  items: await engagement.listEventAttendees(ctx, params.id ?? ''),
}));
