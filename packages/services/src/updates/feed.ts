import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import type { Logger } from '@gynx/config';
import {
  isUniqueViolation,
  type Db,
  type Prisma,
  type PrismaClient,
  type UpdateFeedRepo,
} from '@gynx/database';
import { conflict, notFound } from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission } from '../core/authz';
import { getGuildConfig } from '../core/config';
import type { Ctx } from '../core/context';
import type { DiscordPort } from '../core/discord-port';
import { enqueueJob } from '../core/jobs';
import { normaliseRepoName, readEventData, type UpdateEventData } from './github';
import { renderPublicUpdate, renderStaffUpdate } from './render';

/**
 * Update feed: GitHub pushes and releases posted to Discord.
 *
 * - Every push to a tracked branch → the private staff channel.
 * - Only published releases and `[public]`-tagged commits → the public channel.
 * Deliveries are stored once (by X-GitHub-Delivery) and posted by the worker
 * (`updates.post`), which records message ids so a retry never reposts.
 */

export const POST_JOB = 'updates.post';
export type UpdateEventStatus = 'PENDING' | 'POSTED' | 'SKIPPED' | 'NO_ACCESS';

// ── Repository configuration (updates.manage) ────────────────────────────────

/** GitHub owner (≤39, alnum/hyphen) / repository (≤100, alnum . _ -). */
const FULL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** Git branch names: no spaces, "..", control chars, leading "-" or trailing "/" / ".lock". */
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)(?!.*\/$)[A-Za-z0-9._/-]{1,200}$/;

export const repoInputSchema = z.object({
  fullName: z
    .string()
    .trim()
    .regex(FULL_NAME, 'Use the GitHub "owner/repo" form, e.g. gynx-gg/website')
    .transform(normaliseRepoName),
  displayName: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(60)
    .refine((s) => !/[@<>`]/.test(s), 'No mentions or formatting'),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #22D3EE')
    .transform((s) => s.toUpperCase()),
  branch: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((s) => (s ? s : null))
    .refine((s) => s === null || BRANCH.test(s), 'Not a valid branch name'),
  enabled: z.boolean().default(true),
  publicEnabled: z.boolean().default(true),
});
export type RepoInput = z.input<typeof repoInputSchema>;

export const upsertRepoSchema = repoInputSchema.extend({ id: z.string().min(1).max(64).optional() });

export interface RepoView {
  id: string;
  fullName: string;
  displayName: string;
  color: string;
  branch: string | null;
  enabled: boolean;
  publicEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const toRepoView = (r: UpdateFeedRepo): RepoView => ({
  id: r.id,
  fullName: r.fullName,
  displayName: r.displayName,
  color: r.color,
  branch: r.branch,
  enabled: r.enabled,
  publicEnabled: r.publicEnabled,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export async function listRepos(ctx: Ctx): Promise<RepoView[]> {
  await requirePermission(ctx, 'updates.manage');
  const rows = await ctx.db.updateFeedRepo.findMany({
    where: { guildId: ctx.guildId },
    orderBy: { displayName: 'asc' },
  });
  return rows.map(toRepoView);
}

export async function upsertRepo(ctx: Ctx, raw: z.input<typeof upsertRepoSchema>): Promise<RepoView> {
  const action = raw.id ? 'updates.repo.update' : 'updates.repo.create';
  await requirePermission(ctx, 'updates.manage', action);
  const { id, ...input } = upsertRepoSchema.parse(raw);
  try {
    return await ctx.db.$transaction(async (tx) => {
      let row: UpdateFeedRepo;
      if (id) {
        const existing = await tx.updateFeedRepo.findFirst({ where: { id, guildId: ctx.guildId } });
        if (!existing) throw notFound('Repository');
        row = await tx.updateFeedRepo.update({ where: { id }, data: input });
      } else {
        row = await tx.updateFeedRepo.create({ data: { guildId: ctx.guildId, ...input } });
      }
      await audit(
        ctx,
        {
          action,
          targetType: 'UpdateFeedRepo',
          targetId: row.id,
          metadata: {
            fullName: row.fullName,
            branch: row.branch,
            enabled: row.enabled,
            publicEnabled: row.publicEnabled,
          },
        },
        tx,
      );
      return toRepoView(row);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('That repository is already configured.');
    throw e;
  }
}

export async function deleteRepo(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'updates.manage', 'updates.repo.delete');
  await ctx.db.$transaction(async (tx) => {
    const existing = await tx.updateFeedRepo.findFirst({ where: { id, guildId: ctx.guildId } });
    if (!existing) throw notFound('Repository');
    await tx.updateFeedRepo.delete({ where: { id } });
    await audit(
      ctx,
      {
        action: 'updates.repo.delete',
        targetType: 'UpdateFeedRepo',
        targetId: id,
        metadata: { fullName: existing.fullName },
      },
      tx,
    );
  });
}

export interface EventView {
  id: string;
  repo: string;
  fullName: string;
  kind: string;
  ref: string;
  status: string;
  commits: number;
  postedStaff: boolean;
  postedPublic: boolean;
  createdAt: string;
}

export async function listRecentEvents(ctx: Ctx, limit = 20): Promise<EventView[]> {
  await requirePermission(ctx, 'updates.manage');
  const rows = await ctx.db.updateFeedEvent.findMany({
    where: { guildId: ctx.guildId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 100),
    include: { repo: { select: { displayName: true, fullName: true } } },
  });
  return rows.map((e) => ({
    id: e.id,
    repo: e.repo.displayName,
    fullName: e.repo.fullName,
    kind: e.kind,
    ref: e.ref,
    status: e.status,
    commits: readEventData(e.data).totalCommits,
    postedStaff: !!e.staffMessageId,
    postedPublic: !!e.publicMessageId,
    createdAt: e.createdAt.toISOString(),
  }));
}

// ── Webhook ingestion (dashboard endpoint, after signature verification) ─────

/** Enabled repo config for a GitHub `owner/repo`, or null (unknown or switched off). */
export async function findTrackedRepo(db: Db, guildId: string, fullName: string) {
  const repo = await db.updateFeedRepo.findUnique({
    where: { guildId_fullName: { guildId, fullName: normaliseRepoName(fullName) } },
  });
  return repo?.enabled ? repo : null;
}

export interface RecordDeliveryInput {
  guildId: string;
  repoId: string;
  deliveryId: string;
  kind: 'push' | 'release';
  ref: string;
  data: UpdateEventData;
}

/**
 * Store a delivery and queue its post. Idempotent by delivery id: GitHub
 * redeliveries (or concurrent duplicates) return `duplicate` and do nothing.
 */
export async function recordDelivery(
  deps: { db: PrismaClient; now: () => Date },
  input: RecordDeliveryInput,
): Promise<{ status: 'queued'; eventId: string } | { status: 'duplicate' }> {
  const existing = await deps.db.updateFeedEvent.findUnique({ where: { deliveryId: input.deliveryId } });
  if (existing) return { status: 'duplicate' };
  try {
    const event = await deps.db.$transaction(async (tx) => {
      const ev = await tx.updateFeedEvent.create({
        data: {
          guildId: input.guildId,
          repoId: input.repoId,
          deliveryId: input.deliveryId,
          kind: input.kind,
          ref: input.ref,
          data: input.data as unknown as Prisma.InputJsonValue,
        },
      });
      await enqueueJob(tx, {
        type: POST_JOB,
        dedupeKey: `${POST_JOB}:${ev.id}`,
        runAt: deps.now(),
        guildId: input.guildId,
        payload: { eventId: ev.id },
      });
      return ev;
    });
    return { status: 'queued', eventId: event.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { status: 'duplicate' };
    throw e;
  }
}

// ── Worker: post to Discord ──────────────────────────────────────────────────

const httpStatus = (e: unknown) => (e instanceof DiscordAPIError ? e.status : undefined);

export interface PostUpdateResult {
  status: UpdateEventStatus | 'missing';
  staff: 'posted' | 'already' | 'no_channel' | 'no_access';
  public: 'posted' | 'already' | 'no_channel' | 'no_access' | 'not_public';
}

/**
 * Post one stored event: staff first, then public. Message ids are saved right
 * after each send, so a retry (crash, transient Discord error) never reposts.
 * Missing access (403/404) marks the event NO_ACCESS instead of retrying forever.
 */
export async function postUpdateEvent(
  deps: { db: Db; discord: DiscordPort; log: Logger },
  eventId: string,
): Promise<PostUpdateResult> {
  const event = await deps.db.updateFeedEvent.findUnique({ where: { id: eventId }, include: { repo: true } });
  if (!event) return { status: 'missing', staff: 'no_channel', public: 'no_channel' };
  const cfg = await getGuildConfig(deps.db, event.guildId);
  const view = {
    kind: event.kind,
    ref: event.ref,
    data: readEventData(event.data),
    createdAt: event.createdAt,
  };
  const log = { guildId: event.guildId, eventId, repo: event.repo.fullName };

  const send = async (
    channelId: string,
    body: Parameters<DiscordPort['sendMessage']>[1],
    field: 'staffMessageId' | 'publicMessageId',
  ): Promise<'posted' | 'no_access'> => {
    try {
      const msg = await deps.discord.sendMessage(channelId, body);
      await deps.db.updateFeedEvent.update({ where: { id: eventId }, data: { [field]: msg.id } });
      return 'posted';
    } catch (e) {
      const code = httpStatus(e);
      if (code === 403 || code === 404) {
        deps.log.warn({ ...log, channelId }, 'update feed: cannot post (check channel and bot permissions)');
        return 'no_access';
      }
      throw e; // transient: the job is retried, already-posted channels are skipped
    }
  };

  let staff: PostUpdateResult['staff'];
  if (event.staffMessageId) staff = 'already';
  else if (!cfg.updatesStaffChannelId) staff = 'no_channel';
  else staff = await send(cfg.updatesStaffChannelId, renderStaffUpdate(event.repo, view), 'staffMessageId');

  let pub: PostUpdateResult['public'];
  const publicBody = event.repo.publicEnabled ? renderPublicUpdate(event.repo, view) : null;
  if (event.publicMessageId) pub = 'already';
  else if (!publicBody) pub = 'not_public';
  else if (!cfg.updatesChannelId) pub = 'no_channel';
  else pub = await send(cfg.updatesChannelId, publicBody, 'publicMessageId');

  const results = [staff, pub];
  const status: UpdateEventStatus = results.includes('no_access')
    ? 'NO_ACCESS'
    : results.some((r) => r === 'posted' || r === 'already')
      ? 'POSTED'
      : 'SKIPPED';
  await deps.db.updateFeedEvent.update({ where: { id: eventId }, data: { status } });
  return { status, staff, public: pub };
}
