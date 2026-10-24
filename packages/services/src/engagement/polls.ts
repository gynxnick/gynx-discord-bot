import { z } from 'zod';
import { isUniqueViolation, type Db, type Poll, type PollOption, type Prisma } from '@gynx/database';
import { cursorArgs, forbidden, invalidState, notFound, paginationSchema, toPage, validation, type Page } from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob, rescheduleJob } from '../core/jobs';
import { JOBS, cleanText, lockRow, refreshBucket, snowflakeSchema } from './common';

export const POLL_MIN_DURATION_MS = 60_000;
export const POLL_MAX_DURATION_MS = 14 * 86_400_000;

// ─── Pure rules ─────────────────────────────────────────────────────────────

export interface PollRules {
  multipleChoice: boolean;
  maxChoices: number;
}

/**
 * Validate a selection against the poll's rules. Returns the de-duplicated option ids.
 * Single choice: exactly one option. Multiple choice: 1..maxChoices distinct options.
 */
export function validatePollSelection(rules: PollRules, validOptionIds: readonly string[], selected: readonly string[]): string[] {
  const unique = [...new Set(selected)];
  if (unique.length === 0) throw validation('Pick at least one option.');
  const valid = new Set(validOptionIds);
  if (unique.some((id) => !valid.has(id))) throw validation('That option is not part of this poll.');
  if (!rules.multipleChoice && unique.length !== 1) throw validation('This poll allows only one choice.');
  if (rules.multipleChoice && unique.length > rules.maxChoices) throw validation(`You can pick at most ${rules.maxChoices} options.`);
  return unique;
}

/** Parse "a; b; c" option strings (bot input). */
export const splitPollOptions = (s: string): string[] =>
  s
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);

// ─── Schemas ────────────────────────────────────────────────────────────────

export const createPollSchema = z
  .object({
    question: z.string().trim().min(5).max(300),
    options: z.array(z.string().trim().min(1).max(80)).min(2, 'A poll needs at least 2 options.').max(10, 'A poll can have at most 10 options.'),
    multipleChoice: z.boolean().default(false),
    maxChoices: z.number().int().min(1).max(10).optional(),
    durationMs: z.number().int().min(POLL_MIN_DURATION_MS, 'Minimum duration is 1 minute.').max(POLL_MAX_DURATION_MS, 'Maximum duration is 14 days.'),
    anonymous: z.boolean().default(false),
    liveResults: z.boolean().default(true),
    channelId: snowflakeSchema,
  })
  .superRefine((v, c) => {
    const lower = v.options.map((o) => o.toLowerCase());
    if (new Set(lower).size !== lower.length) c.addIssue({ code: 'custom', message: 'Options must be different.', path: ['options'] });
    if (v.maxChoices !== undefined && v.maxChoices > v.options.length) c.addIssue({ code: 'custom', message: 'max choices cannot exceed the number of options.', path: ['maxChoices'] });
    if (!v.multipleChoice && v.maxChoices !== undefined && v.maxChoices !== 1) c.addIssue({ code: 'custom', message: 'Single-choice polls allow exactly one choice.', path: ['maxChoices'] });
  });
export type CreatePollInput = z.input<typeof createPollSchema>;

const endKey = (id: string) => `${JOBS.pollEnd}:${id}`;

export async function createPoll(ctx: Ctx, raw: CreatePollInput): Promise<Poll & { options: PollOption[] }> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'polls.manage', 'engagement.poll.create');
  const input = createPollSchema.parse(raw);
  const maxChoices = input.multipleChoice ? (input.maxChoices ?? input.options.length) : 1;
  const endsAt = new Date(ctx.now().getTime() + input.durationMs);

  return ctx.db.$transaction(async (tx) => {
    const poll = await tx.poll.create({
      data: {
        guildId: ctx.guildId,
        question: cleanText(input.question),
        multipleChoice: input.multipleChoice,
        maxChoices,
        anonymous: input.anonymous,
        liveResults: input.liveResults,
        endsAt,
        channelId: input.channelId,
        createdById: ctx.actor.userId,
        options: { create: input.options.map((label, position) => ({ label: cleanText(label), position })) },
      },
      include: { options: { orderBy: { position: 'asc' } } },
    });
    await audit(ctx, { action: 'engagement.poll.create', targetType: 'Poll', targetId: poll.id, metadata: { options: poll.options.length, multipleChoice: poll.multipleChoice, anonymous: poll.anonymous, endsAt: endsAt.toISOString() } }, tx);
    await enqueueJob(tx, { type: JOBS.pollPublish, dedupeKey: `${JOBS.pollPublish}:${poll.id}`, runAt: ctx.now(), guildId: ctx.guildId, payload: { pollId: poll.id } });
    await enqueueJob(tx, { type: JOBS.pollEnd, dedupeKey: endKey(poll.id), runAt: endsAt, guildId: ctx.guildId, payload: { pollId: poll.id } });
    return poll;
  });
}

/**
 * Cast or replace your vote. One ballot per user per poll (unique constraint); the
 * ballot's votes are replaced atomically. The poll row is share-locked so a vote can
 * never commit after the poll was closed.
 */
export async function votePoll(ctx: Ctx, pollId: string, optionIds: string[]): Promise<{ optionIds: string[]; changed: boolean }> {
  await requireModule(ctx, 'engagement');
  z.array(z.string().min(1).max(64)).max(10).parse(optionIds);
  await requireRate(ctx, 'engagement.poll.vote', 10, 60);
  const userId = ctx.actor.userId;

  const run = () =>
    ctx.db.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'Poll', pollId, 'share'))) throw notFound('Poll');
      const poll = await tx.poll.findFirst({ where: { id: pollId, guildId: ctx.guildId }, include: { options: { select: { id: true } } } });
      if (!poll) throw notFound('Poll');
      if (poll.status !== 'OPEN' || poll.endsAt.getTime() <= ctx.now().getTime()) throw invalidState('This poll is closed.');
      const selection = validatePollSelection(poll, poll.options.map((o) => o.id), optionIds);

      const ballot = await tx.pollBallot.upsert({
        where: { pollId_userId: { pollId, userId } },
        create: { pollId, userId },
        update: { updatedAt: ctx.now() },
        include: { votes: { select: { optionId: true } } },
      });
      const before = ballot.votes.map((v) => v.optionId).sort();
      const changed = before.join(',') !== [...selection].sort().join(',');
      if (changed) {
        await tx.pollVote.deleteMany({ where: { ballotId: ballot.id } });
        await tx.pollVote.createMany({ data: selection.map((optionId) => ({ pollId, ballotId: ballot.id, optionId })) });
        if (poll.liveResults) await enqueuePollRefresh(ctx, tx, pollId);
      }
      return { optionIds: selection, changed };
    });

  try {
    return await run();
  } catch (e) {
    // Two simultaneous first votes by the same user: the loser retries as a vote change.
    if (isUniqueViolation(e)) return run();
    throw e;
  }
}

/** Debounced live-results edit: one job per poll per minute bucket. */
export async function enqueuePollRefresh(ctx: Ctx, tx: Db, pollId: string): Promise<void> {
  const { bucket, runAt } = refreshBucket(ctx.now(), 60_000);
  await enqueueJob(tx, { type: JOBS.pollRefresh, dedupeKey: `${JOBS.pollRefresh}:${pollId}:${bucket}`, runAt, guildId: ctx.guildId, payload: { pollId } });
}

/** Close early. The end job (moved to now) publishes the final results exactly once. */
export async function closePoll(ctx: Ctx, pollId: string): Promise<Poll> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'polls.manage', 'engagement.poll.close');
  return ctx.db.$transaction(async (tx) => {
    const res = await tx.poll.updateMany({ where: { id: pollId, guildId: ctx.guildId, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: ctx.now() } });
    if (res.count === 0) {
      const exists = await tx.poll.findFirst({ where: { id: pollId, guildId: ctx.guildId }, select: { id: true } });
      throw exists ? invalidState('This poll is already closed.') : notFound('Poll');
    }
    await audit(ctx, { action: 'engagement.poll.close', targetType: 'Poll', targetId: pollId }, tx);
    if (!(await rescheduleJob(tx, endKey(pollId), ctx.now()))) {
      await enqueueJob(tx, { type: JOBS.pollEnd, dedupeKey: `${endKey(pollId)}:close`, runAt: ctx.now(), guildId: ctx.guildId, payload: { pollId } });
    }
    return tx.poll.findUniqueOrThrow({ where: { id: pollId } });
  });
}

/** System close used by the end job. Returns true when this call closed the poll. */
export async function closeExpiredPoll(db: Db, pollId: string, now: Date): Promise<boolean> {
  const res = await db.poll.updateMany({ where: { id: pollId, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: now } });
  return res.count > 0;
}

/** Atomically claim results publication; true for exactly one caller. */
export async function markPollResultsPublished(db: Db, pollId: string, now: Date): Promise<boolean> {
  const res = await db.poll.updateMany({ where: { id: pollId, status: 'CLOSED', resultsPublishedAt: null }, data: { resultsPublishedAt: now } });
  return res.count > 0;
}

// ─── Results (privacy-preserving projections) ───────────────────────────────

export interface PollOptionResult {
  optionId: string;
  label: string;
  position: number;
  votes: number;
  /** Only for non-anonymous polls when the viewer holds polls.manage and asked for voters. */
  voterIds?: string[];
}

export interface PollResults {
  pollId: string;
  question: string;
  status: Poll['status'];
  anonymous: boolean;
  multipleChoice: boolean;
  maxChoices: number;
  endsAt: Date;
  totalBallots: number;
  options: PollOptionResult[];
}

/** Tally without any user identifiers (safe for public rendering of any poll). */
export async function tallyPoll(db: Db, pollId: string): Promise<PollResults> {
  const poll = await db.poll.findUnique({ where: { id: pollId }, include: { options: { orderBy: { position: 'asc' } } } });
  if (!poll) throw notFound('Poll');
  const [groups, totalBallots] = await Promise.all([
    db.pollVote.groupBy({ by: ['optionId'], where: { pollId }, _count: { _all: true } }),
    db.pollBallot.count({ where: { pollId, votes: { some: {} } } }),
  ]);
  return {
    pollId: poll.id,
    question: poll.question,
    status: poll.status,
    anonymous: poll.anonymous,
    multipleChoice: poll.multipleChoice,
    maxChoices: poll.maxChoices,
    endsAt: poll.endsAt,
    totalBallots,
    options: poll.options.map((o) => ({
      optionId: o.id,
      label: o.label,
      position: o.position,
      votes: groups.find((g) => g.optionId === o.id)?._count._all ?? 0,
    })),
  };
}

/**
 * Results for bot / dashboard. Members see counts only when the poll shows live results
 * or has closed. Voter ids are returned only for NON-anonymous polls to `polls.manage`
 * holders who ask for them — anonymous polls never expose voter ids to anyone.
 */
export async function getPollResults(ctx: Ctx, pollId: string, opts: { includeVoters?: boolean } = {}): Promise<PollResults> {
  await requireModule(ctx, 'engagement');
  const poll = await ctx.db.poll.findFirst({ where: { id: pollId, guildId: ctx.guildId } });
  if (!poll) throw notFound('Poll');
  const manager = can(ctx, 'polls.manage');
  if (!manager && poll.status === 'OPEN' && !poll.liveResults) throw forbidden('Results will be shown when the poll closes.');
  const results = await tallyPoll(ctx.db, pollId);
  if (!opts.includeVoters || poll.anonymous) return results;
  if (!manager) {
    await requirePermission(ctx, 'polls.manage', 'engagement.poll.voters');
  }
  const votes = await ctx.db.pollVote.findMany({ where: { pollId }, select: { optionId: true, ballot: { select: { userId: true } } } });
  return {
    ...results,
    options: results.options.map((o) => ({ ...o, voterIds: votes.filter((v) => v.optionId === o.optionId).map((v) => v.ballot.userId) })),
  };
}

/** The caller's own current selection (never reveals anyone else's). */
export async function getMyPollVote(ctx: Ctx, pollId: string): Promise<string[]> {
  const ballot = await ctx.db.pollBallot.findUnique({ where: { pollId_userId: { pollId, userId: ctx.actor.userId } }, include: { votes: true } });
  return ballot?.votes.map((v) => v.optionId) ?? [];
}

export const listPollsSchema = paginationSchema.extend({ status: z.enum(['OPEN', 'CLOSED']).optional(), q: z.string().trim().max(100).optional() });

export type PollSummary = Poll & { optionCount: number; ballotCount: number };

/** Staff listing for dashboard / autocomplete. Contains no voter identities. */
export async function listPolls(ctx: Ctx, raw: z.input<typeof listPollsSchema> = {}): Promise<Page<PollSummary>> {
  await requirePermission(ctx, 'polls.manage', 'engagement.poll.list');
  const f = listPollsSchema.parse(raw);
  const where: Prisma.PollWhereInput = { guildId: ctx.guildId, status: f.status, ...(f.q ? { question: { contains: f.q, mode: 'insensitive' } } : {}) };
  const rows = await ctx.db.poll.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { _count: { select: { options: true, ballots: true } } },
    ...cursorArgs(f),
  });
  const page = toPage(rows, f.limit);
  return { ...page, items: page.items.map(({ _count, ...p }) => ({ ...p, optionCount: _count.options, ballotCount: _count.ballots })) };
}
