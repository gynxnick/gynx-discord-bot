import { z } from 'zod';
import { nextSequence, type Db, type Prisma, type Suggestion, type SuggestionStatus } from '@gynx/database';
import {
  AppError,
  conflict,
  cursorArgs,
  formatRef,
  invalidState,
  notFound,
  paginationSchema,
  similarity,
  toPage,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { enqueueJob } from '../core/jobs';
import { DM_JOB, JOBS, cleanText, displayText, lockRow, messageLink, refreshBucket, type DmPayload } from './common';

export const SUGGESTION_SIMILARITY_THRESHOLD = 0.6;
export const OPEN_SUGGESTION_STATUSES: SuggestionStatus[] = ['UNDER_REVIEW', 'PLANNED'];
export const SUGGESTION_STATUS_LABELS: Record<SuggestionStatus, string> = {
  UNDER_REVIEW: 'Under review',
  PLANNED: 'Planned',
  IMPLEMENTED: 'Implemented',
  DECLINED: 'Declined',
  DUPLICATE: 'Duplicate',
};

// ─── Pure rules ─────────────────────────────────────────────────────────────

export interface SimilarityCandidate {
  id: string;
  ref: string;
  title: string;
  body: string;
}

/** Score = max(title-vs-title, full-text) Jaccard similarity. */
export function suggestionSimilarity(a: { title: string; body: string }, b: { title: string; body: string }): number {
  return Math.max(similarity(a.title, b.title), similarity(`${a.title} ${a.body}`, `${b.title} ${b.body}`));
}

/** Most similar open suggestion at or above the threshold, or null. */
export function findSimilarSuggestion<T extends SimilarityCandidate>(
  candidates: readonly T[],
  input: { title: string; body: string },
  threshold = SUGGESTION_SIMILARITY_THRESHOLD,
): { match: T; score: number } | null {
  let best: { match: T; score: number } | null = null;
  for (const c of candidates) {
    const score = suggestionSimilarity(input, c);
    if (score >= threshold && (!best || score > best.score)) best = { match: c, score };
  }
  return best;
}

// ─── Member operations ──────────────────────────────────────────────────────

export const submitSuggestionSchema = z.object({
  title: z.string().trim().min(5, 'Title must be at least 5 characters.').max(100),
  body: z.string().trim().min(20, 'Please describe your idea (at least 20 characters).').max(2000),
});
export type SubmitSuggestionInput = z.input<typeof submitSuggestionSchema>;

export async function submitSuggestion(ctx: Ctx, raw: SubmitSuggestionInput): Promise<Suggestion> {
  const cfg = await requireModule(ctx, 'engagement');
  const input = submitSuggestionSchema.parse(raw);
  if (!cfg.suggestionChannelId) throw invalidState('Suggestions are not set up on this server yet.');
  await requireRate(ctx, 'engagement.suggest', 3, 3600);

  const title = cleanText(input.title);
  const body = cleanText(input.body);

  const open = await ctx.db.suggestion.findMany({
    where: { guildId: ctx.guildId, hidden: false, status: { in: OPEN_SUGGESTION_STATUSES } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { id: true, ref: true, title: true, body: true, channelId: true, messageId: true },
  });
  const similar = findSimilarSuggestion(open, { title, body });
  if (similar) {
    const link = messageLink(ctx.guildId, similar.match.channelId, similar.match.messageId);
    throw new AppError(
      'CONFLICT',
      `A very similar suggestion already exists: **${similar.match.ref}** — ${displayText(similar.match.title)}${link ? `\n${link}` : ''}\nPlease vote on that one instead.`,
      { duplicateOf: similar.match.id },
    );
  }

  return ctx.db.$transaction(async (tx) => {
    const number = await nextSequence(tx, ctx.guildId, 'suggestion');
    const s = await tx.suggestion.create({
      data: { guildId: ctx.guildId, number, ref: formatRef('S', number), authorId: ctx.actor.userId, title, body, channelId: cfg.suggestionChannelId },
    });
    await audit(ctx, { action: 'engagement.suggestion.submit', targetType: 'Suggestion', targetId: s.id, metadata: { ref: s.ref } }, tx);
    await enqueueJob(tx, { type: JOBS.suggestionPublish, dedupeKey: `${JOBS.suggestionPublish}:${s.id}`, runAt: ctx.now(), guildId: ctx.guildId, payload: { suggestionId: s.id } });
    return s;
  });
}

/**
 * Up/down vote. One vote per user (unique). Pressing the same button again removes the
 * vote; pressing the other switches it. Denormalised counters change in the same
 * transaction under a row lock, so they always equal the vote rows.
 */
export async function voteSuggestion(ctx: Ctx, suggestionId: string, value: 1 | -1): Promise<{ vote: 1 | -1 | 0; upvotes: number; downvotes: number }> {
  await requireModule(ctx, 'engagement');
  z.union([z.literal(1), z.literal(-1)]).parse(value);
  await requireRate(ctx, 'engagement.suggestion.vote', 20, 60);
  const userId = ctx.actor.userId;

  return ctx.db.$transaction(async (tx) => {
    if (!(await lockRow(tx, 'Suggestion', suggestionId))) throw notFound('Suggestion');
    const s = await tx.suggestion.findFirst({ where: { id: suggestionId, guildId: ctx.guildId } });
    if (!s || s.hidden) throw notFound('Suggestion');
    if (!OPEN_SUGGESTION_STATUSES.includes(s.status)) throw invalidState('Voting is closed for this suggestion.');

    const existing = await tx.suggestionVote.findUnique({ where: { suggestionId_userId: { suggestionId, userId } } });
    const field = (v: number) => (v === 1 ? 'upvotes' : 'downvotes') as 'upvotes' | 'downvotes';
    let vote: 1 | -1 | 0;
    let data: Prisma.SuggestionUpdateInput;
    if (!existing) {
      await tx.suggestionVote.create({ data: { suggestionId, userId, value } });
      data = { [field(value)]: { increment: 1 } };
      vote = value;
    } else if (existing.value === value) {
      await tx.suggestionVote.delete({ where: { id: existing.id } });
      data = { [field(value)]: { decrement: 1 } };
      vote = 0;
    } else {
      await tx.suggestionVote.update({ where: { id: existing.id }, data: { value } });
      data = { [field(value)]: { increment: 1 }, [field(existing.value)]: { decrement: 1 } };
      vote = value;
    }
    const updated = await tx.suggestion.update({ where: { id: suggestionId }, data, select: { upvotes: true, downvotes: true } });
    await enqueueSuggestionRefresh(ctx, tx, suggestionId);
    return { vote, ...updated };
  });
}

export async function enqueueSuggestionRefresh(ctx: Ctx, tx: Db, suggestionId: string, immediate = false): Promise<void> {
  const { bucket, runAt } = refreshBucket(ctx.now(), 15_000);
  await enqueueJob(tx, {
    type: JOBS.suggestionRefresh,
    dedupeKey: immediate ? `${JOBS.suggestionRefresh}:${suggestionId}:now:${ctx.now().getTime()}` : `${JOBS.suggestionRefresh}:${suggestionId}:${bucket}`,
    runAt: immediate ? ctx.now() : runAt,
    guildId: ctx.guildId,
    payload: { suggestionId },
  });
}

// ─── Staff operations (suggestions.manage) ──────────────────────────────────

export const setSuggestionStatusSchema = z
  .object({
    status: z.enum(['UNDER_REVIEW', 'PLANNED', 'IMPLEMENTED', 'DECLINED', 'DUPLICATE']),
    response: z.string().trim().max(1000).optional(),
    /** Suggestion id or ref (S-0001) of the original when marking DUPLICATE. */
    duplicateOf: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => v.status !== 'DUPLICATE' || !!v.duplicateOf, { message: 'Say which suggestion this duplicates.', path: ['duplicateOf'] });
export type SetSuggestionStatusInput = z.input<typeof setSuggestionStatusSchema>;

async function findSuggestion(ctx: Ctx, idOrRef: string, db: Db = ctx.db): Promise<Suggestion | null> {
  const ref = idOrRef.toUpperCase();
  return db.suggestion.findFirst({ where: { guildId: ctx.guildId, OR: [{ id: idOrRef }, { ref }] } });
}

export async function setSuggestionStatus(ctx: Ctx, id: string, raw: SetSuggestionStatusInput): Promise<Suggestion> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'suggestions.manage', 'engagement.suggestion.status');
  const input = setSuggestionStatusSchema.parse(raw);
  const s = await findSuggestion(ctx, id);
  if (!s) throw notFound('Suggestion');

  let duplicateOfId: string | null = null;
  if (input.status === 'DUPLICATE') {
    const original = await findSuggestion(ctx, input.duplicateOf!);
    if (!original) throw validation(`Suggestion ${input.duplicateOf} was not found.`);
    if (original.id === s.id) throw validation('A suggestion cannot duplicate itself.');
    duplicateOfId = original.id;
  }
  if (s.status === input.status && duplicateOfId === s.duplicateOfId && !input.response) throw conflict(`It is already ${SUGGESTION_STATUS_LABELS[s.status].toLowerCase()}.`);

  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.suggestion.update({
      where: { id: s.id },
      data: {
        status: input.status,
        staffResponse: input.response ? cleanText(input.response) : s.staffResponse,
        respondedById: ctx.actor.userId,
        duplicateOfId,
      },
    });
    await audit(ctx, { action: 'engagement.suggestion.status', targetType: 'Suggestion', targetId: s.id, metadata: { ref: s.ref, from: s.status, to: input.status, duplicateOfId } }, tx);
    await enqueueSuggestionRefresh(ctx, tx, s.id, true);
    if (s.status !== input.status) {
      const payload: DmPayload = { kind: 'suggestion.status', userId: s.authorId, refId: s.id, guard: input.status };
      await enqueueJob(tx, { type: DM_JOB, dedupeKey: `${DM_JOB}:suggestion.status:${s.id}:${input.status}:${updated.updatedAt.getTime()}`, runAt: ctx.now(), guildId: ctx.guildId, payload: { ...payload } });
    }
    return updated;
  });
}

/** Moderation: hide (or restore) a suggestion. Hidden suggestions disappear from the board and listings. */
export async function setSuggestionHidden(ctx: Ctx, id: string, hidden: boolean, reason?: string): Promise<Suggestion> {
  await requireModule(ctx, 'engagement');
  await requirePermission(ctx, 'suggestions.manage', 'engagement.suggestion.hide');
  const why = z.string().trim().max(500).optional().parse(reason);
  const s = await findSuggestion(ctx, id);
  if (!s) throw notFound('Suggestion');
  if (s.hidden === hidden) return s;
  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.suggestion.update({ where: { id: s.id }, data: { hidden } });
    await audit(ctx, { action: hidden ? 'engagement.suggestion.hide' : 'engagement.suggestion.unhide', targetType: 'Suggestion', targetId: s.id, metadata: { ref: s.ref, reason: why ? cleanText(why) : undefined } }, tx);
    await enqueueSuggestionRefresh(ctx, tx, s.id, true);
    return updated;
  });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export const listSuggestionsSchema = paginationSchema.extend({
  status: z.enum(['UNDER_REVIEW', 'PLANNED', 'IMPLEMENTED', 'DECLINED', 'DUPLICATE']).optional(),
  includeHidden: z.boolean().optional(),
  q: z.string().trim().max(100).optional(),
});

/** Listing; hidden suggestions only for `suggestions.manage`. */
export async function listSuggestions(ctx: Ctx, raw: z.input<typeof listSuggestionsSchema> = {}): Promise<Page<Suggestion>> {
  await requireModule(ctx, 'engagement');
  const f = listSuggestionsSchema.parse(raw);
  const manager = can(ctx, 'suggestions.manage');
  const where: Prisma.SuggestionWhereInput = {
    guildId: ctx.guildId,
    status: f.status,
    ...(f.includeHidden && manager ? {} : { hidden: false }),
    ...(f.q ? { OR: [{ ref: f.q.toUpperCase() }, { title: { contains: f.q, mode: 'insensitive' } }] } : {}),
  };
  const rows = await ctx.db.suggestion.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(f) });
  return toPage(rows, f.limit);
}

export async function getSuggestion(ctx: Ctx, idOrRef: string): Promise<Suggestion> {
  await requireModule(ctx, 'engagement');
  const s = await findSuggestion(ctx, idOrRef);
  if (!s || (s.hidden && !can(ctx, 'suggestions.manage'))) throw notFound('Suggestion');
  return s;
}
