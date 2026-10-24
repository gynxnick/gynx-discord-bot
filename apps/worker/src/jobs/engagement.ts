import { engagement, makeCtx, systemActor, type MessageBody } from '@gynx/services';
import type { ScheduledJob } from '@gynx/database';
import type { WorkerCtx, WorkerModule } from '../framework/types';

/**
 * Engagement jobs: events, polls, suggestions, giveaways.
 * Every handler re-reads persisted state and returns early when its work is already
 * done or no longer relevant, so retries and duplicate runs are safe. Messages are
 * tracked by channelId/messageId and edited in place.
 */
const { JOBS } = engagement;
const payloadOf = (job: ScheduledJob) => (job.payload ?? {}) as Record<string, unknown>;
const str = (job: ScheduledJob, key: string) => {
  const v = payloadOf(job)[key];
  return typeof v === 'string' ? v : '';
};

async function renderEvent(w: WorkerCtx, eventId: string) {
  const ev = await w.deps.db.communityEvent.findUnique({ where: { id: eventId } });
  if (!ev) return null;
  const counts = await engagement.eventCounts(w.deps.db, ev.id);
  return {
    ev,
    body: {
      embeds: [engagement.eventEmbed(ev, counts)],
      components: engagement.eventComponents(ev),
    } satisfies MessageBody,
  };
}

async function renderPoll(w: WorkerCtx, pollId: string) {
  const poll = await w.deps.db.poll.findUnique({ where: { id: pollId } });
  if (!poll) return null;
  const results = await engagement.tallyPoll(w.deps.db, pollId);
  const showTally = poll.liveResults || poll.status === 'CLOSED';
  return {
    poll,
    body: {
      embeds: [engagement.pollEmbed(results, showTally)],
      components: engagement.pollComponents(results),
    } satisfies MessageBody,
  };
}

async function renderSuggestion(w: WorkerCtx, suggestionId: string) {
  const s = await w.deps.db.suggestion.findUnique({ where: { id: suggestionId } });
  if (!s) return null;
  const dup = s.duplicateOfId
    ? await w.deps.db.suggestion.findUnique({ where: { id: s.duplicateOfId }, select: { ref: true } })
    : null;
  return {
    s,
    body: {
      embeds: [engagement.suggestionEmbed(s, dup?.ref)],
      components: engagement.suggestionComponents(s),
    } satisfies MessageBody,
  };
}

async function renderGiveaway(w: WorkerCtx, giveawayId: string) {
  const g = await w.deps.db.giveaway.findUnique({ where: { id: giveawayId } });
  if (!g) return null;
  const [entrants, draws] = await Promise.all([
    w.deps.db.giveawayEntry.count({ where: { giveawayId } }),
    w.deps.db.giveawayDraw.findMany({ where: { giveawayId }, orderBy: { seq: 'asc' } }),
  ]);
  const winners = draws.length ? draws.flatMap((d) => d.winnerIds) : null;
  return {
    g,
    body: {
      embeds: [engagement.giveawayEmbed(g, entrants, winners)],
      components: engagement.giveawayComponents(g),
    } satisfies MessageBody,
  };
}

async function editIfPosted(
  w: WorkerCtx,
  channelId: string | null,
  messageId: string | null,
  body: Partial<MessageBody>,
) {
  if (!channelId || !messageId) return; // not posted yet: the publish job renders current state anyway
  await w.deps.discord.editMessage(channelId, messageId, body);
}

export const engagementJobs: WorkerModule = {
  name: 'engagement',
  handlers: {
    // ─── Events ───
    async [JOBS.eventPublish](job, w) {
      const r = await renderEvent(w, str(job, 'eventId'));
      if (!r || r.ev.messageId || r.ev.status !== 'SCHEDULED' || !r.ev.channelId) return;
      const msg = await w.deps.discord.sendMessage(r.ev.channelId, r.body);
      await w.deps.db.communityEvent.updateMany({
        where: { id: r.ev.id, messageId: null },
        data: { messageId: msg.id },
      });
    },

    async [JOBS.eventRefresh](job, w) {
      const r = await renderEvent(w, str(job, 'eventId'));
      if (r) await editIfPosted(w, r.ev.channelId, r.ev.messageId, r.body);
    },

    /** Fan out reminder DMs to GOING attendees (one deduped DM job per user, rate-spread). */
    async [JOBS.eventReminder](job, w) {
      const ev = await w.deps.db.communityEvent.findUnique({ where: { id: str(job, 'eventId') } });
      // Stale guard: cancelled, or rescheduled after this job was enqueued.
      if (!ev || ev.status !== 'SCHEDULED' || ev.startsAt.toISOString() !== str(job, 'startsAt')) return;
      const minutes = Number(payloadOf(job).minutes) || 0;
      const n = await engagement.fanOutEventDms(w.deps.db, ev, 'event.reminder', w.deps.now(), minutes);
      w.log.info({ eventId: ev.id, minutes, recipients: n }, 'event reminder fanned out');
    },

    async [JOBS.eventCancelled](job, w) {
      const ev = await w.deps.db.communityEvent.findUnique({ where: { id: str(job, 'eventId') } });
      if (!ev || ev.status !== 'CANCELLED') return;
      await engagement.fanOutEventDms(w.deps.db, ev, 'event.cancelled', w.deps.now());
    },

    /** One member DM, rendered from current state; skipped when no longer relevant. */
    async [JOBS.dm](job, w) {
      const d = payloadOf(job) as unknown as engagement.DmPayload;
      const { db, discord } = w.deps;
      if (d.kind === 'suggestion.status') {
        const s = await db.suggestion.findUnique({ where: { id: d.refId } });
        if (!s || s.hidden || s.status !== d.guard) return;
        await discord.sendDm(d.userId, {
          embeds: [
            engagement.suggestionStatusDmEmbed(
              s,
              engagement.messageLink(s.guildId, s.channelId, s.messageId),
            ),
          ],
        });
        return;
      }
      const ev = await db.communityEvent.findUnique({ where: { id: d.refId } });
      if (!ev) return;
      if (d.kind === 'event.cancelled') {
        if (ev.status !== 'CANCELLED') return;
      } else if (d.kind === 'event.reminder' || d.kind === 'event.promoted') {
        if (ev.status !== 'SCHEDULED') return;
        if (d.kind === 'event.reminder' && ev.startsAt.toISOString() !== d.guard) return;
        const rsvp = await db.eventRsvp.findUnique({
          where: { eventId_userId: { eventId: ev.id, userId: d.userId } },
          select: { status: true },
        });
        if (rsvp?.status !== 'GOING') return;
      } else {
        return;
      }
      const link = engagement.messageLink(ev.guildId, ev.channelId, ev.messageId);
      await discord.sendDm(d.userId, { embeds: [engagement.eventDmEmbed(ev, d.kind, link, d.minutes)] });
    },

    // ─── Polls ───
    async [JOBS.pollPublish](job, w) {
      const r = await renderPoll(w, str(job, 'pollId'));
      if (!r || r.poll.messageId || !r.poll.channelId) return;
      const msg = await w.deps.discord.sendMessage(r.poll.channelId, r.body);
      await w.deps.db.poll.updateMany({
        where: { id: r.poll.id, messageId: null },
        data: { messageId: msg.id },
      });
    },

    /** Debounced live tally (deduped per poll + minute bucket). */
    async [JOBS.pollRefresh](job, w) {
      const r = await renderPoll(w, str(job, 'pollId'));
      if (!r || r.poll.resultsPublishedAt || r.poll.status !== 'OPEN') return;
      await editIfPosted(w, r.poll.channelId, r.poll.messageId, r.body);
    },

    /** Close (if still open) and publish the final results exactly once (resultsPublishedAt). */
    async [JOBS.pollEnd](job, w) {
      const pollId = str(job, 'pollId');
      const now = w.deps.now();
      const poll = await w.deps.db.poll.findUnique({ where: { id: pollId } });
      if (!poll || poll.resultsPublishedAt) return;
      if (poll.status === 'OPEN') {
        if (poll.endsAt.getTime() > now.getTime()) return; // not due (clock skew); the poll stays open
        await engagement.closeExpiredPoll(w.deps.db, pollId, now);
      }
      const r = await renderPoll(w, pollId);
      if (!r) return;
      await editIfPosted(w, r.poll.channelId, r.poll.messageId, r.body);
      await engagement.markPollResultsPublished(w.deps.db, pollId, now);
    },

    // ─── Suggestions ───
    async [JOBS.suggestionPublish](job, w) {
      const r = await renderSuggestion(w, str(job, 'suggestionId'));
      if (!r || r.s.messageId || r.s.hidden || !r.s.channelId) return;
      const msg = await w.deps.discord.sendMessage(r.s.channelId, r.body);
      await w.deps.db.suggestion.updateMany({
        where: { id: r.s.id, messageId: null },
        data: { messageId: msg.id },
      });
    },

    async [JOBS.suggestionRefresh](job, w) {
      const r = await renderSuggestion(w, str(job, 'suggestionId'));
      if (r) await editIfPosted(w, r.s.channelId, r.s.messageId, r.body);
    },

    // ─── Giveaways ───
    async [JOBS.giveawayPublish](job, w) {
      const r = await renderGiveaway(w, str(job, 'giveawayId'));
      if (!r || r.g.messageId || r.g.status !== 'ACTIVE' || !r.g.channelId) return;
      const msg = await w.deps.discord.sendMessage(r.g.channelId, r.body);
      await w.deps.db.giveaway.updateMany({
        where: { id: r.g.id, messageId: null },
        data: { messageId: msg.id },
      });
    },

    async [JOBS.giveawayRefresh](job, w) {
      const r = await renderGiveaway(w, str(job, 'giveawayId'));
      if (r) await editIfPosted(w, r.g.channelId, r.g.messageId, r.body);
    },

    /** Scheduled end. The service's conditional ACTIVE→ENDED update makes re-runs no-ops. */
    async [JOBS.giveawayEnd](job, w) {
      const g = await w.deps.db.giveaway.findUnique({
        where: { id: str(job, 'giveawayId') },
        select: { id: true, guildId: true, status: true },
      });
      if (!g || g.status !== 'ACTIVE') return;
      const ctx = makeCtx(w.deps, g.guildId, systemActor('worker'), `job:${job.id}`);
      await engagement.finishGiveaway(ctx, g.id);
    },

    /** Announce a draw. Mentions ONLY the winners (explicit allowed_mentions user list). */
    async [JOBS.giveawayAnnounce](job, w) {
      const draw = await w.deps.db.giveawayDraw.findUnique({
        where: { id: str(job, 'drawId') },
        include: { giveaway: true },
      });
      const channelId = draw?.giveaway.channelId;
      if (!draw || !channelId || draw.announcedAt) return;
      // Claim before sending: a retry after a crash never pings winners twice.
      const claimed = await w.deps.db.giveawayDraw.updateMany({
        where: { id: draw.id, announcedAt: null },
        data: { announcedAt: w.deps.now() },
      });
      if (claimed.count === 0) return;
      const g = draw.giveaway;
      await w.deps.discord.sendMessage(channelId, {
        content: engagement.winnerAnnouncementContent(g, draw),
        allowed_mentions: { parse: [], users: draw.winnerIds.slice(0, 100) },
        ...(g.messageId ? { message_reference: { message_id: g.messageId, fail_if_not_exists: false } } : {}),
      });
      const r = await renderGiveaway(w, g.id);
      if (r) await editIfPosted(w, r.g.channelId, r.g.messageId, r.body);
    },
  },
  periodic: [],
};
