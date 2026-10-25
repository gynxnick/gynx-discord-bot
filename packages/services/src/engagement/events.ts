import { z } from 'zod';
import type { CommunityEvent, Db, EventRsvp, Prisma, RsvpStatus } from '@gynx/database';
import {
  conflict,
  cursorArgs,
  invalidState,
  isValidTimeZone,
  notFound,
  paginationSchema,
  toPage,
  validation,
  zonedParts,
  zonedToUtc,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { cancelJobsByPrefix, enqueueJob } from '../core/jobs';
import { DM_JOB, JOBS, cleanText, lockRow, refreshBucket, snowflakeSchema, type DmPayload } from './common';
import { EngagementText as T } from './texts';

// ─── Pure rules ─────────────────────────────────────────────────────────────

/** Parse "YYYY-MM-DD HH:MM" wall-clock time in `tz` into a UTC instant (rejects impossible dates). */
export function parseEventTime(input: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(input.trim());
  if (!m) throw validation(T.eventTimeFormat());
  if (!isValidTimeZone(tz)) throw validation(T.eventUnknownTimeZone({ timezone: tz }));
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) throw validation(T.eventInvalidDateTime());
  const utc = zonedToUtc(y, mo, d, h, mi, tz);
  const back = zonedParts(utc, tz);
  if (back.year !== y || back.month !== mo || back.day !== d) throw validation(T.eventDateDoesNotExist());
  return utc;
}

export type RsvpDecision = 'GOING' | 'WAITLIST' | 'FULL';

/** Capacity rule: GOING while there is room, otherwise WAITLIST if enabled, otherwise FULL. */
export function decideRsvp(
  capacity: number | null,
  goingCount: number,
  waitlistEnabled: boolean,
): RsvpDecision {
  if (capacity === null || goingCount < capacity) return 'GOING';
  return waitlistEnabled ? 'WAITLIST' : 'FULL';
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const reminders = z
  .array(z.number().int().min(1).max(10_080))
  .max(3, 'At most 3 reminders.')
  .refine((a) => new Set(a).size === a.length, 'Reminder times must be different.');

const eventFields = {
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(1).max(2000),
  location: z.string().trim().max(100).optional().nullable(),
  /** Wall-clock "YYYY-MM-DD HH:MM" in `timezone` (defaults to the guild time zone). */
  startsAt: z.string().trim().min(1).max(20),
  timezone: z.string().trim().min(1).max(64).optional(),
  durationMinutes: z
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .optional()
    .nullable(),
  capacity: z.number().int().min(1).max(10_000).optional().nullable(),
  waitlistEnabled: z.boolean().optional(),
  reminderMinutesBefore: reminders.optional(),
};

export const createEventSchema = z.object({
  ...eventFields,
  /** Explicit target channel (overrides the configured event channel). */
  channelId: snowflakeSchema.optional(),
  /** Used only when neither channelId nor GuildConfig.eventChannelId is set (e.g. the invoking channel). */
  fallbackChannelId: snowflakeSchema.optional(),
});
export type CreateEventInput = z.input<typeof createEventSchema>;
export const updateEventSchema = z.object(eventFields).partial();
export type UpdateEventInput = z.input<typeof updateEventSchema>;

const MAX_AHEAD_MS = 366 * 86_400_000;
const REMINDER_PREFIX = (id: string) => `${JOBS.eventReminder}:${id}:`;

function assertFuture(ctx: Ctx, startsAt: Date): void {
  const now = ctx.now().getTime();
  if (startsAt.getTime() <= now) throw validation(T.eventMustBeFuture());
  if (startsAt.getTime() > now + MAX_AHEAD_MS) throw validation(T.eventMaxYearAhead());
}

async function enqueueReminders(
  ctx: Ctx,
  tx: Db,
  ev: Pick<CommunityEvent, 'id' | 'startsAt' | 'reminderMinutesBefore'>,
) {
  for (const minutes of ev.reminderMinutesBefore) {
    const runAt = new Date(ev.startsAt.getTime() - minutes * 60_000);
    if (runAt.getTime() <= ctx.now().getTime()) continue; // too late for this reminder
    const job = await enqueueJob(tx, {
      type: JOBS.eventReminder,
      // startsAt in the key: a reschedule produces new logical jobs, never reuses stale ones.
      dedupeKey: `${REMINDER_PREFIX(ev.id)}${ev.startsAt.getTime()}:${minutes}`,
      runAt,
      guildId: ctx.guildId,
      payload: { eventId: ev.id, minutes, startsAt: ev.startsAt.toISOString() },
    });
    // Same start time and minutes as a reminder cancelled earlier in this edit → revive it.
    if (job.status === 'CANCELLED')
      await tx.scheduledJob.update({ where: { id: job.id }, data: { status: 'PENDING', runAt } });
  }
}

/** Debounced re-render of the event message (counts / status). */
export async function enqueueEventRefresh(
  ctx: Ctx,
  tx: Db,
  eventId: string,
  immediate = false,
): Promise<void> {
  const { bucket, runAt } = refreshBucket(ctx.now(), 15_000);
  await enqueueJob(tx, {
    type: JOBS.eventRefresh,
    dedupeKey: immediate
      ? `${JOBS.eventRefresh}:${eventId}:now:${ctx.now().getTime()}`
      : `${JOBS.eventRefresh}:${eventId}:${bucket}`,
    runAt: immediate ? ctx.now() : runAt,
    guildId: ctx.guildId,
    payload: { eventId },
  });
}

async function loadEvent(ctx: Ctx, id: string, db: Db = ctx.db): Promise<CommunityEvent> {
  const ev = await db.communityEvent.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!ev) throw notFound('Event');
  return ev;
}

// ─── Staff operations (events.manage) ───────────────────────────────────────

/** Create and publish an event (the message is posted by the worker). */
export async function createEvent(ctx: Ctx, raw: CreateEventInput): Promise<CommunityEvent> {
  const cfg = await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'events.manage', 'engagement.event.create');
  const input = createEventSchema.parse(raw);
  const tz = input.timezone ?? cfg.timezone;
  const startsAt = parseEventTime(input.startsAt, tz);
  assertFuture(ctx, startsAt);
  const channelId = input.channelId ?? cfg.eventChannelId ?? input.fallbackChannelId;
  if (!channelId) throw validation(T.eventNoChannel());

  return ctx.db.$transaction(async (tx) => {
    const ev = await tx.communityEvent.create({
      data: {
        guildId: ctx.guildId,
        title: cleanText(input.title),
        description: cleanText(input.description),
        location: input.location ? cleanText(input.location) : null,
        startsAt,
        endsAt: input.durationMinutes ? new Date(startsAt.getTime() + input.durationMinutes * 60_000) : null,
        timezone: tz,
        capacity: input.capacity ?? null,
        waitlistEnabled: input.waitlistEnabled ?? true,
        reminderMinutesBefore: input.reminderMinutesBefore ?? [60],
        channelId,
        createdById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'engagement.event.create',
        targetType: 'CommunityEvent',
        targetId: ev.id,
        metadata: { title: ev.title, startsAt: ev.startsAt.toISOString(), capacity: ev.capacity },
      },
      tx,
    );
    await enqueueJob(tx, {
      type: JOBS.eventPublish,
      dedupeKey: `${JOBS.eventPublish}:${ev.id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { eventId: ev.id },
    });
    await enqueueReminders(ctx, tx, ev);
    return ev;
  });
}

/** Edit an event. Changing the start time reschedules reminders (old jobs cancelled, new keys). */
export async function updateEvent(ctx: Ctx, id: string, raw: UpdateEventInput): Promise<CommunityEvent> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'events.manage', 'engagement.event.update');
  const input = updateEventSchema.parse(raw);

  return ctx.db.$transaction(async (tx) => {
    await lockRow(tx, 'CommunityEvent', id);
    const ev = await loadEvent(ctx, id, tx);
    if (ev.status !== 'SCHEDULED') throw invalidState(T.eventOnlyScheduledEditable());

    const tz = input.timezone ?? ev.timezone;
    const startsAt = input.startsAt !== undefined ? parseEventTime(input.startsAt, tz) : ev.startsAt;
    const rescheduled = startsAt.getTime() !== ev.startsAt.getTime();
    if (rescheduled) assertFuture(ctx, startsAt);

    if (input.capacity !== undefined && input.capacity !== null) {
      const going = await tx.eventRsvp.count({ where: { eventId: id, status: 'GOING' } });
      if (input.capacity < going) throw validation(T.eventCapacityBelowGoing({ count: going }));
    }
    const duration =
      input.durationMinutes !== undefined
        ? input.durationMinutes
        : ev.endsAt
          ? (ev.endsAt.getTime() - ev.startsAt.getTime()) / 60_000
          : null;
    const remindersChanged = input.reminderMinutesBefore !== undefined;

    const updated = await tx.communityEvent.update({
      where: { id },
      data: {
        title: input.title !== undefined ? cleanText(input.title) : undefined,
        description: input.description !== undefined ? cleanText(input.description) : undefined,
        location:
          input.location !== undefined ? (input.location ? cleanText(input.location) : null) : undefined,
        timezone: tz,
        startsAt,
        endsAt: duration ? new Date(startsAt.getTime() + duration * 60_000) : null,
        capacity: input.capacity !== undefined ? input.capacity : undefined,
        waitlistEnabled: input.waitlistEnabled,
        reminderMinutesBefore: input.reminderMinutesBefore,
      },
    });
    if (rescheduled || remindersChanged) {
      await cancelJobsByPrefix(tx, REMINDER_PREFIX(id));
      await enqueueReminders(ctx, tx, updated);
    }
    await audit(
      ctx,
      {
        action: 'engagement.event.update',
        targetType: 'CommunityEvent',
        targetId: id,
        metadata: {
          fields: Object.keys(input),
          rescheduled,
          from: rescheduled ? ev.startsAt.toISOString() : undefined,
          to: rescheduled ? startsAt.toISOString() : undefined,
        },
      },
      tx,
    );
    await enqueueEventRefresh(ctx, tx, id, true);
    return updated;
  });
}

/** Cancel an event: stops reminders, updates the message, DMs attendees (worker fan-out). */
export async function cancelEvent(ctx: Ctx, id: string, reason?: string): Promise<CommunityEvent> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'events.manage', 'engagement.event.cancel');
  const why = z.string().trim().max(500).optional().parse(reason);
  await loadEvent(ctx, id);
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.communityEvent.updateMany({
      where: { id, guildId: ctx.guildId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });
    if (res.count === 0) throw invalidState(T.eventNotScheduled());
    await cancelJobsByPrefix(tx, REMINDER_PREFIX(id));
    await audit(
      ctx,
      {
        action: 'engagement.event.cancel',
        targetType: 'CommunityEvent',
        targetId: id,
        metadata: { reason: why ? cleanText(why) : undefined },
      },
      tx,
    );
    await enqueueEventRefresh(ctx, tx, id, true);
    await enqueueJob(tx, {
      type: JOBS.eventCancelled,
      dedupeKey: `${JOBS.eventCancelled}:${id}`,
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { eventId: id },
    });
    return tx.communityEvent.findUniqueOrThrow({ where: { id } });
  });
}

/** After the event, staff post a summary; the event becomes COMPLETED and its message is updated. */
export async function postEventSummary(ctx: Ctx, id: string, summary: string): Promise<CommunityEvent> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'events.manage', 'engagement.event.summary');
  const text = z.string().trim().min(10).max(2000).parse(summary);
  const ev = await loadEvent(ctx, id);
  if (ev.status === 'CANCELLED') throw invalidState(T.eventWasCancelled());
  if (ctx.now().getTime() < ev.startsAt.getTime()) throw invalidState(T.eventSummaryTooEarly());
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.communityEvent.update({
      where: { id },
      data: { summary: cleanText(text), status: 'COMPLETED' },
    });
    await cancelJobsByPrefix(tx, REMINDER_PREFIX(id));
    await audit(ctx, { action: 'engagement.event.summary', targetType: 'CommunityEvent', targetId: id }, tx);
    await enqueueEventRefresh(ctx, tx, id, true);
    return updated;
  });
}

// ─── Member operations ──────────────────────────────────────────────────────

export interface RsvpResult {
  status: RsvpStatus;
  /** True when nothing changed (already in that state). */
  unchanged: boolean;
  waitlistPosition: number | null;
  promotedUserId: string | null;
}

async function waitlistPosition(tx: Db, rsvp: EventRsvp): Promise<number> {
  const ahead = await tx.eventRsvp.count({
    where: {
      eventId: rsvp.eventId,
      status: 'WAITLIST',
      OR: [{ updatedAt: { lt: rsvp.updatedAt } }, { updatedAt: rsvp.updatedAt, id: { lt: rsvp.id } }],
    },
  });
  return ahead + 1;
}

/**
 * RSVP "going" or "not going". Concurrency-safe: the event row is locked for the
 * duration of the transaction, so the capacity check and the insert are atomic
 * with respect to every other RSVP for the same event.
 */
export async function rsvpEvent(
  ctx: Ctx,
  eventId: string,
  choice: 'GOING' | 'NOT_GOING',
): Promise<RsvpResult> {
  await requireModule(ctx, 'engagement');
  z.enum(['GOING', 'NOT_GOING']).parse(choice);
  await requireRate(ctx, 'engagement.rsvp', 10, 60);
  const userId = ctx.actor.userId;

  return ctx.db.$transaction(async (tx) => {
    if (!(await lockRow(tx, 'CommunityEvent', eventId))) throw notFound('Event');
    const ev = await loadEvent(ctx, eventId, tx);
    if (ev.status !== 'SCHEDULED') throw invalidState(T.eventIsStatus({ status: ev.status.toLowerCase() }));
    if (ev.startsAt.getTime() <= ctx.now().getTime()) throw invalidState(T.eventRsvpClosed());

    const existing = await tx.eventRsvp.findUnique({ where: { eventId_userId: { eventId, userId } } });

    if (choice === 'GOING') {
      if (existing && (existing.status === 'GOING' || existing.status === 'WAITLIST')) {
        return {
          status: existing.status,
          unchanged: true,
          waitlistPosition: existing.status === 'WAITLIST' ? await waitlistPosition(tx, existing) : null,
          promotedUserId: null,
        };
      }
      const going = await tx.eventRsvp.count({ where: { eventId, status: 'GOING' } });
      const decision = decideRsvp(ev.capacity, going, ev.waitlistEnabled);
      if (decision === 'FULL') throw conflict(T.eventFull());
      const rsvp = await tx.eventRsvp.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: { eventId, userId, status: decision },
        update: { status: decision },
      });
      await enqueueEventRefresh(ctx, tx, eventId);
      return {
        status: decision,
        unchanged: false,
        waitlistPosition: decision === 'WAITLIST' ? await waitlistPosition(tx, rsvp) : null,
        promotedUserId: null,
      };
    }

    // NOT_GOING
    if (!existing || existing.status === 'CANCELLED') {
      if (!existing) await tx.eventRsvp.create({ data: { eventId, userId, status: 'CANCELLED' } });
      return { status: 'CANCELLED', unchanged: true, waitlistPosition: null, promotedUserId: null };
    }
    await tx.eventRsvp.update({ where: { id: existing.id }, data: { status: 'CANCELLED' } });
    let promotedUserId: string | null = null;
    if (existing.status === 'GOING') promotedUserId = await promoteFromWaitlist(ctx, tx, ev);
    await enqueueEventRefresh(ctx, tx, eventId);
    return { status: 'CANCELLED', unchanged: false, waitlistPosition: null, promotedUserId };
  });
}

/** Move the earliest waitlisted member to GOING if there is room. Caller holds the event lock. */
async function promoteFromWaitlist(ctx: Ctx, tx: Db, ev: CommunityEvent): Promise<string | null> {
  const going = await tx.eventRsvp.count({ where: { eventId: ev.id, status: 'GOING' } });
  if (decideRsvp(ev.capacity, going, false) !== 'GOING') return null;
  const next = await tx.eventRsvp.findFirst({
    where: { eventId: ev.id, status: 'WAITLIST' },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
  });
  if (!next) return null;
  await tx.eventRsvp.update({ where: { id: next.id }, data: { status: 'GOING' } });
  const payload: DmPayload = { kind: 'event.promoted', userId: next.userId, refId: ev.id };
  await enqueueJob(tx, {
    type: DM_JOB,
    dedupeKey: `${DM_JOB}:event.promoted:${next.id}:${ctx.now().getTime()}`,
    runAt: ctx.now(),
    guildId: ctx.guildId,
    payload: { ...payload },
  });
  return next.userId;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export interface EventCounts {
  going: number;
  waitlist: number;
}

export async function eventCounts(db: Db, eventId: string): Promise<EventCounts> {
  const groups = await db.eventRsvp.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } });
  const n = (s: RsvpStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
  return { going: n('GOING'), waitlist: n('WAITLIST') };
}

export const listEventsSchema = paginationSchema.extend({
  status: z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED']).optional(),
  upcoming: z.boolean().optional(),
  q: z.string().trim().max(100).optional(),
});

/** Public listing (event details are public once posted). */
export async function listEvents(
  ctx: Ctx,
  raw: z.input<typeof listEventsSchema> = {},
): Promise<Page<CommunityEvent>> {
  await requireModule(ctx, 'engagement');
  const f = listEventsSchema.parse(raw);
  const where: Prisma.CommunityEventWhereInput = {
    guildId: ctx.guildId,
    status: f.status,
    ...(f.upcoming ? { startsAt: { gt: ctx.now() } } : {}),
    ...(f.q ? { title: { contains: f.q, mode: 'insensitive' } } : {}),
  };
  const rows = await ctx.db.communityEvent.findMany({
    where,
    orderBy: f.upcoming ? [{ startsAt: 'asc' }, { id: 'asc' }] : [{ startsAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(f),
  });
  return toPage(rows, f.limit);
}

export async function getEvent(
  ctx: Ctx,
  id: string,
): Promise<{ event: CommunityEvent; counts: EventCounts; myStatus: RsvpStatus | null }> {
  await requireModule(ctx, 'engagement');
  const event = await loadEvent(ctx, id);
  const [counts, mine] = await Promise.all([
    eventCounts(ctx.db, id),
    ctx.db.eventRsvp.findUnique({
      where: { eventId_userId: { eventId: id, userId: ctx.actor.userId } },
      select: { status: true },
    }),
  ]);
  return { event, counts, myStatus: mine?.status ?? null };
}

/** Attendee list (user ids) — staff only. */
export async function listEventAttendees(
  ctx: Ctx,
  id: string,
): Promise<Array<{ userId: string; status: RsvpStatus; updatedAt: Date }>> {
  await requirePermission(ctx, 'events.manage', 'engagement.event.attendees');
  await loadEvent(ctx, id);
  return ctx.db.eventRsvp.findMany({
    where: { eventId: id, status: { in: ['GOING', 'WAITLIST'] } },
    orderBy: [{ status: 'asc' }, { updatedAt: 'asc' }, { id: 'asc' }],
    select: { userId: true, status: true, updatedAt: true },
  });
}

export const canManageEvents = (ctx: Ctx) => can(ctx, 'events.manage');

// ─── Worker helpers ─────────────────────────────────────────────────────────

/** Upper bound on DMs fanned out per event notification (protects against abuse / API limits). */
export const MAX_EVENT_DMS = 2000;

/** Fan out one DM job per recipient; DM jobs are deduped per user so retries never double-send. */
export async function fanOutEventDms(
  db: Db,
  ev: CommunityEvent,
  kind: 'event.reminder' | 'event.cancelled',
  now: Date,
  minutes?: number,
): Promise<number> {
  const statuses: RsvpStatus[] = kind === 'event.reminder' ? ['GOING'] : ['GOING', 'WAITLIST'];
  const recipients = await db.eventRsvp.findMany({
    where: { eventId: ev.id, status: { in: statuses } },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: MAX_EVENT_DMS,
    select: { userId: true },
  });
  const guard = ev.startsAt.toISOString();
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i]!;
    const payload: DmPayload = { kind, userId: r.userId, refId: ev.id, guard, minutes };
    await enqueueJob(db, {
      type: DM_JOB,
      dedupeKey: `${DM_JOB}:${kind}:${ev.id}:${ev.startsAt.getTime()}:${minutes ?? 0}:${r.userId}`,
      // Spread sends (≈ 5 per second) to stay well inside Discord's DM limits.
      runAt: new Date(now.getTime() + Math.floor(i / 5) * 1000),
      guildId: ev.guildId,
      payload: { ...payload },
    });
  }
  return recipients.length;
}
