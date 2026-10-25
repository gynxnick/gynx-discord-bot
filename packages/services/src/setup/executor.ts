import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import type { Prisma, SetupChange, SetupOperation, SetupResourceType } from '@gynx/database';
import { AppError, invalidState, sha256 } from '@gynx/shared';
import { audit } from '../core/audit';
import { getGuildConfig } from '../core/config';
import type { Actor, Ctx, ServiceDeps } from '../core/context';
import type { DiscordPort } from '../core/discord-port';
import { NO_MENTIONS } from '../core/discord-port';
import { brandEmbed } from '../core/render';
import { loadWelcomeConfig } from '../community/welcome';
import { syncDutyControlPanel } from '../support/duty-panel';
import { syncSupportPanel } from '../support/panel';
import { categoryKey, roleKey, type PanelKey } from './blueprint';
import {
  allChannels,
  hexToInt,
  loadGuildSetup,
  resolveBlueprint,
  resourceConfigData,
  type EffectiveBlueprint,
  type OverwriteMap,
} from './config';
import { renderSetupMessage } from './messages';
import { STAGES, TEMPLATE_NAME, stageOf, type BindingKey, type Stage } from './planner';
import type { DiscordAdminPort } from './port';
import { runRollback } from './rollback';
import { parseStoredPreview, toJson } from './store';
import { SetupText as T } from './texts';
import type { ExecutionSummary, Finding, GuildSnapshot, PlannedChange } from './types';
import { isVerified, verifySetup } from './verify';

// ── Retry / error classification ─────────────────────────────────────────────

export interface ExecOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Retries after the first attempt for retryable errors (default 3). */
  maxRetries?: number;
  /** Backoff base (default 500 ms; doubled per retry, plus jitter). */
  baseDelayMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Classified {
  retryable: boolean;
  retryAfterMs?: number;
  message: string;
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

/** 429 / 5xx / network → retryable; 400/403 (50013 Missing Permissions, 50001 Missing Access) etc. → permanent. */
export function classifyError(e: unknown): Classified {
  const err = (e ?? {}) as {
    status?: number;
    code?: number | string;
    message?: string;
    name?: string;
    retryAfter?: number;
    retry_after?: number;
    rawError?: { retry_after?: number };
  };
  const status = typeof err.status === 'number' ? err.status : undefined;
  const message = `${status ? `HTTP ${status}` : 'error'}${
    err.code !== undefined ? ` (code ${String(err.code)})` : ''
  }: ${String(err.message ?? e).slice(0, 200)}`;
  if (status === 429) {
    const seconds = err.rawError?.retry_after ?? err.retry_after;
    const retryAfterMs =
      typeof err.retryAfter === 'number'
        ? err.retryAfter
        : seconds !== undefined
          ? seconds * 1000
          : undefined;
    return { retryable: true, retryAfterMs, message };
  }
  if (status !== undefined) return { retryable: status >= 500, message };
  if (e instanceof AppError) return { retryable: false, message: e.message };
  if (err.name === 'AbortError' || (typeof err.code === 'string' && NETWORK_CODES.has(err.code))) {
    return { retryable: true, message };
  }
  return { retryable: false, message };
}

/** A change that cannot run because something it depends on is missing (not an error). */
class SkipChange extends Error {}

// ── Execution ────────────────────────────────────────────────────────────────

export interface ExecDeps extends ServiceDeps {
  discordAdmin: DiscordAdminPort;
  discord: DiscordPort;
}

export function requireExecDeps(deps: ServiceDeps): ExecDeps {
  if (!deps.discordAdmin || !deps.discord)
    throw new AppError(
      'CONFIG',
      'Server setup needs Discord access in this process (discordAdmin and discord).',
    );
  return deps as ExecDeps;
}

export function opActor(op: Pick<SetupOperation, 'initiatedByUserId'>): Actor {
  return {
    userId: op.initiatedByUserId,
    roleIds: [],
    permissions: new Set(),
    isSystem: false,
    source: 'worker',
  };
}

export const CREATE_KINDS = new Set([
  'role.create',
  'channel.create',
  'message.deploy',
  'template.create',
  'grant.set',
]);
export const ADOPT_KINDS = new Set(['role.adopt', 'channel.adopt']);

export function countChanges(
  changes: Pick<SetupChange, 'kind' | 'status' | 'blueprintKey' | 'error'>[],
  op: 'apply' | 'rollback',
) {
  let created = 0;
  let adopted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ key: string; error: string }> = [];
  for (const c of changes) {
    if (c.status === 'FAILED') {
      failed++;
      failures.push({ key: c.blueprintKey, error: c.error ?? 'failed' });
    } else if (c.status === 'SKIPPED' || c.status === 'PENDING') skipped++;
    else if (c.status === 'APPLIED' || c.status === 'ROLLED_BACK') {
      if (op === 'rollback') updated++;
      else if (CREATE_KINDS.has(c.kind)) created++;
      else if (ADOPT_KINDS.has(c.kind)) adopted++;
      else updated++;
    }
  }
  return { created, adopted, updated, skipped, failed, failures };
}

/**
 * Execute a QUEUED (or crashed RUNNING) operation. Idempotent and resumable:
 * changes already APPLIED are skipped, PENDING ones run in stage order, and the
 * operation's `result` is checkpointed after every stage.
 */
export async function executeSetupOperation(
  rawDeps: ServiceDeps,
  operationId: string,
  opts: ExecOptions = {},
): Promise<ExecutionSummary> {
  const deps = requireExecDeps(rawDeps);
  const op = await deps.db.setupOperation.findUnique({ where: { id: operationId } });
  if (!op) throw new AppError('NOT_FOUND', 'Setup operation was not found.');
  if (['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(op.status) && op.result)
    return op.result as unknown as ExecutionSummary;
  if (op.status === 'CANCELLED') throw invalidState('This setup operation was cancelled.');
  if (op.status === 'PREVIEWED') throw invalidState('This setup operation has not been confirmed.');

  const now = deps.now();
  await deps.db.setupOperation.update({ where: { id: op.id }, data: { status: 'RUNNING' } });
  const setup = await loadGuildSetup(deps.db, op.guildId);
  await deps.db.guildSetup.update({
    where: { guildId: op.guildId },
    data: {
      status: 'IN_PROGRESS',
      startedAt: setup.startedAt ?? now,
      startedByUserId: setup.startedByUserId ?? op.initiatedByUserId,
    },
  });

  const ctx: Ctx = { ...deps, guildId: op.guildId, actor: opActor(op) };
  const exec = {
    sleep: opts.sleep ?? defaultSleep,
    maxRetries: opts.maxRetries ?? 3,
    baseDelayMs: opts.baseDelayMs ?? 500,
  };

  let summary: ExecutionSummary;
  try {
    summary =
      op.operationType === 'ROLLBACK'
        ? await runRollback(deps, ctx, op, exec)
        : await runApply(deps, ctx, op, exec);
  } catch (e) {
    // Unexpected failure (e.g. snapshot unavailable): leave the operation resumable.
    await deps.db.setupOperation.update({ where: { id: op.id }, data: { status: 'QUEUED' } });
    throw e;
  }

  await finish(deps, ctx, op, summary);
  return summary;
}

export interface ExecRuntime {
  sleep: (ms: number) => Promise<void>;
  maxRetries: number;
  baseDelayMs: number;
}

/** Run one Discord call with bounded retries; increments SetupChange.attempts per try. */
export async function withRetries<R>(
  deps: ExecDeps,
  change: Pick<SetupChange, 'id'>,
  rt: ExecRuntime,
  fn: () => Promise<R>,
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    await deps.db.setupChange.update({ where: { id: change.id }, data: { attempts: { increment: 1 } } });
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SkipChange) throw e;
      const c = classifyError(e);
      if (!c.retryable || attempt >= rt.maxRetries) throw e;
      const backoff = rt.baseDelayMs * 2 ** attempt;
      const delay = Math.min(30_000, c.retryAfterMs ?? backoff + Math.floor(Math.random() * rt.baseDelayMs));
      deps.log.warn(
        { changeId: change.id, attempt, delay, error: c.message },
        'setup: retrying Discord call',
      );
      await rt.sleep(delay);
    }
  }
}

interface Applied {
  discordId?: string | null;
  before?: unknown;
  extra?: Record<string, unknown>;
  resource?: {
    key: string;
    type: SetupResourceType;
    id: string;
    ownership?: 'CREATED' | 'ADOPTED';
    channelId?: string | null;
  };
  removeResource?: string;
}

const channelResourceType = (type: number): SetupResourceType =>
  type === 4 ? 'CATEGORY' : type === 2 ? 'VOICE_CHANNEL' : 'TEXT_CHANNEL';

async function runApply(
  deps: ExecDeps,
  ctx: Ctx,
  op: SetupOperation,
  rt: ExecRuntime,
): Promise<ExecutionSummary> {
  const stored = parseStoredPreview(op.preview);
  const bp = resolveBlueprint(stored.context.config, op.selection as never);
  const port = deps.discordAdmin;
  const guildId = op.guildId;

  // Materialise the stored plan as SetupChange rows once (idempotent on resume).
  const existingCount = await deps.db.setupChange.count({ where: { operationId: op.id } });
  if (existingCount === 0) {
    await deps.db.setupChange.createMany({
      data: stored.plan.changes.map((c, seq) => ({
        operationId: op.id,
        seq,
        kind: c.kind,
        blueprintKey: c.key,
        discordResourceId: 'discordId' in c && c.discordId ? c.discordId : null,
        after: toJson(c),
      })),
      skipDuplicates: true,
    });
  }
  const rows = await deps.db.setupChange.findMany({ where: { operationId: op.id }, orderBy: { seq: 'asc' } });

  let snapshot = await port.snapshot(guildId);
  const manifest = await deps.db.setupResource.findMany({ where: { guildId } });
  const ids = new Map(manifest.map((m) => [m.blueprintKey, m.discordResourceId]));
  const claimed = new Set(manifest.map((m) => m.discordResourceId));
  const failedKeys = new Set<string>();
  for (const r of rows) if (r.status === 'FAILED' || r.status === 'SKIPPED') failedKeys.add(r.blueprintKey);

  const need = (key: string, what: string): string => {
    const id = ids.get(key);
    if (id) return id;
    throw new SkipChange(
      failedKeys.has(key)
        ? `Skipped: ${what} (${key}) failed or was skipped.`
        : `Skipped: ${what} (${key}) is not available.`,
    );
  };
  const resolveTarget = (t: string): { id: string; type: 0 | 1 } => {
    if (t === '@everyone') return { id: guildId, type: 0 };
    if (t === 'self') return { id: snapshot.botUserId, type: 1 };
    return { id: need(t, 'the role'), type: 0 };
  };
  const reason = `GYNX server setup (${op.operationType.toLowerCase()} ${op.id})`;

  const persist = async (row: SetupChange, a: Applied) => {
    const tx: Prisma.PrismaPromise<unknown>[] = [
      deps.db.setupChange.update({
        where: { id: row.id },
        data: {
          status: 'APPLIED',
          error: null,
          discordResourceId: a.discordId ?? a.resource?.id ?? row.discordResourceId,
          before: a.before === undefined ? undefined : toJson(a.before),
          after: a.extra ? toJson({ ...(row.after as object), applied: a.extra }) : undefined,
        },
      }),
    ];
    if (a.resource) {
      const r = a.resource;
      const hash = sha256(JSON.stringify(resourceConfigData(bp, r.key) ?? null));
      const common = {
        discordResourceId: r.id,
        resourceType: r.type,
        channelId: r.channelId ?? null,
        setupOperationId: op.id,
        configurationHash: hash,
        blueprintVersion: bp.version,
      };
      tx.push(
        deps.db.setupResource.upsert({
          where: { guildId_blueprintKey: { guildId, blueprintKey: r.key } },
          create: { guildId, blueprintKey: r.key, ownership: r.ownership ?? 'CREATED', ...common },
          update: r.ownership ? { ...common, ownership: r.ownership } : common,
        }),
      );
      ids.set(r.key, r.id);
      claimed.add(r.id);
    }
    await deps.db.$transaction(tx);
  };
  const fail = async (row: SetupChange, status: 'FAILED' | 'SKIPPED', error: string) => {
    failedKeys.add(row.blueprintKey);
    await deps.db.setupChange.update({ where: { id: row.id }, data: { status, error: error.slice(0, 500) } });
  };

  const checkpoint = async () => {
    const all = await deps.db.setupChange.findMany({ where: { operationId: op.id } });
    const counts = countChanges(all, 'apply');
    const partial: ExecutionSummary = {
      operationId: op.id,
      status: 'PARTIAL',
      ...counts,
      verified: false,
      verificationFindings: [],
    };
    await deps.db.setupOperation.update({ where: { id: op.id }, data: { result: toJson(partial) } });
  };

  const byStage = new Map<Stage, SetupChange[]>();
  for (const r of rows) {
    const s = stageOf({ kind: r.kind as PlannedChange['kind'], key: r.blueprintKey });
    byStage.set(s, [...(byStage.get(s) ?? []), r]);
  }

  for (const s of STAGES) {
    const stageRows = byStage.get(s) ?? [];
    const pending = stageRows.filter((r) => r.status === 'PENDING');
    if (!pending.length) continue;

    if (s === 'positions') {
      await applyPositions(pending);
    } else {
      for (const row of pending) {
        const change = row.after as unknown as PlannedChange;
        try {
          const a = await withRetries(deps, row, rt, () => applyOne(change, row));
          await persist(row, a);
        } catch (e) {
          if (e instanceof SkipChange) await fail(row, 'SKIPPED', e.message);
          else {
            const c = classifyError(e);
            deps.log.warn({ key: row.blueprintKey, error: c.message }, 'setup change failed');
            await fail(row, 'FAILED', c.message);
          }
        }
      }
    }
    if (s === 'roles' || s === 'categories') snapshot = await port.snapshot(guildId);
    await checkpoint();
  }

  async function applyPositions(pending: SetupChange[]) {
    const fresh = await port.snapshot(guildId);
    snapshot = fresh;
    const byId = new Map(fresh.roles.map((r) => [r.id, r]));
    const order = bp.roles
      .map((r) => ({ key: roleKey(r.key), id: ids.get(roleKey(r.key)) }))
      .filter((x) => x.id && byId.has(x.id) && byId.get(x.id)!.position < fresh.botHighestPosition);
    const positions = order.map((x, i) => ({ id: x.id!, position: fresh.botHighestPosition - 1 - i }));
    const before = order.map((x) => ({ id: x.id!, position: byId.get(x.id!)!.position }));
    const lead = pending[0]!;
    try {
      if (positions.length > 1) {
        await withRetries(deps, lead, rt, () => port.setRolePositions(guildId, positions, reason));
      }
      for (const row of pending) {
        const id = ids.get(row.blueprintKey);
        if (!id || !order.some((x) => x.id === id)) {
          await fail(row, 'SKIPPED', `Skipped: role ${row.blueprintKey} is not available to order.`);
          continue;
        }
        await persist(row, { discordId: id, before: { positions: before } });
      }
    } catch (e) {
      const c = classifyError(e);
      for (const row of pending) await fail(row, 'FAILED', c.message);
    }
  }

  async function applyOne(change: PlannedChange, row: SetupChange): Promise<Applied> {
    // attempts > 0 on a fresh run means a previous run crashed mid-change.
    const retried = row.attempts > 0;
    switch (change.kind) {
      case 'role.create': {
        const role = bp.roles.find((r) => roleKey(r.key) === change.key)!;
        if (retried) {
          // A previous attempt may have succeeded before the crash: recover instead of duplicating.
          const match = snapshot.roles.filter(
            (r) => r.name === change.name && !r.managed && !claimed.has(r.id),
          );
          if (match.length === 1)
            return { resource: { key: change.key, type: 'ROLE', id: match[0]!.id, ownership: 'CREATED' } };
        }
        const created = await port.createRole(
          guildId,
          {
            name: change.name,
            color: hexToInt(change.color),
            permissions: BigInt(change.permissions),
            hoist: role.hoist,
            mentionable: role.mentionable,
          },
          reason,
        );
        return { resource: { key: change.key, type: 'ROLE', id: created.id, ownership: 'CREATED' } };
      }
      case 'role.adopt': {
        if (!snapshot.roles.some((r) => r.id === change.discordId))
          throw new SkipChange('Skipped: the role to adopt no longer exists.');
        return { resource: { key: change.key, type: 'ROLE', id: change.discordId, ownership: 'ADOPTED' } };
      }
      case 'role.update': {
        const cur = snapshot.roles.find((r) => r.id === change.discordId);
        if (!cur) throw new SkipChange('Skipped: the role no longer exists.');
        const patch: { name?: string; color?: number; permissions?: bigint } = {};
        if (change.patch.name !== undefined) patch.name = change.patch.name;
        if (change.patch.color !== undefined) patch.color = hexToInt(change.patch.color);
        if (change.patch.permissions !== undefined) patch.permissions = BigInt(change.patch.permissions);
        await port.editRole(guildId, cur.id, patch, reason);
        return {
          discordId: cur.id,
          before: { name: cur.name, color: cur.color, permissions: cur.permissions.toString() },
          resource: { key: change.key, type: 'ROLE', id: cur.id },
        };
      }
      case 'role.position':
        throw new SkipChange('Skipped: positions are applied together.');

      case 'channel.create': {
        const isCat = change.channelType === 'category';
        const parentId = change.parentKey ? need(change.parentKey, 'the category') : null;
        const type = isCat ? 4 : change.channelType === 'voice' ? 2 : 0;
        if (retried) {
          const match = snapshot.channels.filter(
            (c) =>
              c.name === change.name &&
              c.type === type &&
              !claimed.has(c.id) &&
              (isCat || c.parentId === parentId),
          );
          if (match.length === 1)
            return {
              resource: {
                key: change.key,
                type: channelResourceType(type),
                id: match[0]!.id,
                ownership: 'CREATED',
              },
            };
        }
        const spec = isCat
          ? bp.categories.find((c) => categoryKey(c.key) === change.key)!
          : allChannels(bp).find((c) => `channel:${c.key}` === change.key)!;
        const overwrites = buildOverwrites(spec.overwrites, spec.private);
        const ch = 'type' in spec ? spec : null;
        const created = await port.createChannel(
          guildId,
          {
            name: change.name,
            type: type as 0 | 2 | 4,
            parentId,
            topic: ch?.type === 'text' ? ch.topic : undefined,
            rateLimitPerUser: ch?.type === 'text' ? ch.slowmode : undefined,
            overwrites,
          },
          reason,
        );
        return {
          resource: {
            key: change.key,
            type: channelResourceType(type),
            id: created.id,
            ownership: 'CREATED',
          },
        };
      }
      case 'channel.adopt': {
        const cur = snapshot.channels.find((c) => c.id === change.discordId);
        if (!cur) throw new SkipChange('Skipped: the channel to adopt no longer exists.');
        return {
          resource: {
            key: change.key,
            type: channelResourceType(cur.type),
            id: cur.id,
            ownership: 'ADOPTED',
          },
        };
      }
      case 'channel.update': {
        const cur = snapshot.channels.find((c) => c.id === change.discordId);
        if (!cur) throw new SkipChange('Skipped: the channel no longer exists.');
        const patch: Partial<{
          name: string;
          parentId: string | null;
          topic: string;
          rateLimitPerUser: number;
        }> = {};
        if (change.patch.name !== undefined) patch.name = change.patch.name;
        if (change.patch.parentKey !== undefined)
          patch.parentId = need(change.patch.parentKey, 'the category');
        if (change.patch.topic !== undefined) patch.topic = change.patch.topic;
        if (change.patch.slowmode !== undefined) patch.rateLimitPerUser = change.patch.slowmode;
        await port.editChannel(cur.id, patch, reason);
        return {
          discordId: cur.id,
          before: {
            name: cur.name,
            parentId: cur.parentId,
            topic: cur.topic,
            rateLimitPerUser: cur.rateLimitPerUser,
          },
          resource: { key: change.key, type: channelResourceType(cur.type), id: cur.id },
        };
      }
      case 'overwrite.set': {
        const channelId = need(change.channelKey, 'the channel');
        const target = resolveTarget(change.target);
        const cur = snapshot.channels.find((c) => c.id === channelId);
        const existing = cur?.overwrites.find((o) => o.id === target.id);
        let allow = BigInt(change.allow) & snapshot.botPermissions;
        const deny = BigInt(change.deny) & snapshot.botPermissions;
        if (target.id === guildId && isPrivateKey(bp, change.channelKey)) allow &= ~P.ViewChannel;
        await port.setOverwrite(channelId, target, allow, deny, reason);
        return {
          discordId: channelId,
          before: existing
            ? {
                exists: true,
                allow: existing.allow.toString(),
                deny: existing.deny.toString(),
                type: existing.type,
              }
            : { exists: false },
          extra: { channelId, targetId: target.id, targetType: target.type },
        };
      }
      case 'binding.set': {
        const id = need(change.resourceKey, 'the bound resource');
        const before = await setBinding(change.binding as BindingKey, id);
        return { discordId: id, before };
      }
      case 'grant.set': {
        const roleId = need(change.roleKey, 'the role');
        const where = {
          guildId_subjectType_subjectId_permission: {
            guildId,
            subjectType: 'ROLE' as const,
            subjectId: roleId,
            permission: change.preset,
          },
        };
        const existing = await deps.db.staffPermission.findUnique({ where });
        if (!existing) {
          await deps.db.staffPermission.create({
            data: {
              guildId,
              subjectType: 'ROLE',
              subjectId: roleId,
              permission: change.preset,
              effect: 'ALLOW',
              createdById: op.initiatedByUserId,
            },
          });
        }
        return {
          discordId: roleId,
          before: { existed: Boolean(existing), effect: existing?.effect ?? null },
        };
      }
      case 'message.deploy':
        return deployMessage(change.panel as PanelKey, change.key, need(change.channelKey, 'the channel'));
      case 'template.create': {
        const existing = await deps.db.announcementTemplate.findUnique({
          where: { guildId_name: { guildId, name: TEMPLATE_NAME } },
        });
        if (existing) return { before: { created: false } };
        const t = await deps.db.announcementTemplate.create({
          data: {
            guildId,
            name: TEMPLATE_NAME,
            type: 'GENERAL',
            title: T.templateTitle(),
            body: T.templateBody(),
          },
        });
        return { before: { created: true }, extra: { templateId: t.id } };
      }
    }
  }

  function buildOverwrites(map: OverwriteMap, isPrivate: boolean) {
    const out: Array<{ id: string; type: 0 | 1; allow: bigint; deny: bigint }> = [];
    for (const [target, v] of map) {
      const ref = target === '@everyone' || target === 'self' ? target : roleKey(target);
      const id = ref === '@everyone' ? guildId : ref === 'self' ? snapshot.botUserId : ids.get(ref);
      if (!id) continue;
      let allow = v.allow & snapshot.botPermissions;
      const deny = v.deny & snapshot.botPermissions;
      if (ref === '@everyone' && isPrivate) allow &= ~P.ViewChannel;
      out.push({ id, type: ref === 'self' ? 1 : 0, allow, deny });
    }
    return out;
  }

  async function setBinding(b: BindingKey, id: string) {
    if (b === 'welcome.channelId' || b === 'welcome.verifiedRoleId') {
      const w = await loadWelcomeConfig(deps.db, guildId);
      if (b === 'welcome.channelId') {
        await deps.db.welcomeConfig.update({ where: { guildId }, data: { channelId: id } });
        return { value: w.channelId };
      }
      await deps.db.welcomeConfig.update({
        where: { guildId },
        data: { verifiedRoleId: id, verificationEnabled: true },
      });
      return { value: w.verifiedRoleId, verificationEnabled: w.verificationEnabled };
    }
    const cfg = await getGuildConfig(deps.db, guildId);
    await deps.db.guildConfig.update({ where: { guildId }, data: { [b]: id } });
    return { value: (cfg as unknown as Record<string, string | null>)[b] ?? null };
  }

  async function deployMessage(panel: PanelKey, key: string, channelId: string): Promise<Applied> {
    const prev = await deps.db.setupResource.findUnique({
      where: { guildId_blueprintKey: { guildId, blueprintKey: key } },
    });
    if (prev?.channelId === channelId && (await port.messageExists(channelId, prev.discordResourceId))) {
      return { resource: { key, type: 'MESSAGE', id: prev.discordResourceId, channelId } };
    }
    if (panel === 'support-status' || panel === 'duty-control') {
      const field = panel === 'support-status' ? 'supportStatusChannelId' : 'dutyPanelChannelId';
      const refField = panel === 'support-status' ? 'supportStatusMessage' : 'dutyPanelMessage';
      const cfg = await getGuildConfig(deps.db, guildId);
      const beforeChannel = cfg[field];
      const ref = (cfg[refField] ?? '').split(':');
      const data: Record<string, unknown> = { [field]: channelId };
      if (ref[0] && ref[1] && !(await port.messageExists(ref[0], ref[1]).catch(() => false))) {
        // The stored message is gone: clear it so the sync posts a fresh one.
        data[refField] = null;
        if (panel === 'support-status') data.supportStatusHash = null;
      }
      await deps.db.guildConfig.update({ where: { guildId }, data });
      const syncDeps = { db: deps.db, discord: deps.discord, log: deps.log };
      const result =
        panel === 'support-status'
          ? await syncSupportPanel(syncDeps, guildId, deps.now())
          : await syncDutyControlPanel(syncDeps, guildId, deps.now());
      if (result === 'no_access' || result === 'disabled' || result === 'module_disabled') {
        throw new AppError('INVALID_STATE', `The ${panel} panel could not be posted (${result}).`);
      }
      const after = await getGuildConfig(deps.db, guildId);
      const [refChannel, messageId] = (after[refField] ?? '').split(':');
      if (!refChannel || !messageId)
        throw new AppError('INVALID_STATE', `The ${panel} panel was not recorded.`);
      return {
        discordId: messageId,
        before: { channelBinding: beforeChannel ?? null, field },
        resource: { key, type: 'MESSAGE', id: messageId, channelId: refChannel },
      };
    }
    const [welcome, guild] = await Promise.all([
      loadWelcomeConfig(deps.db, guildId),
      deps.db.guild.findUnique({ where: { id: guildId }, select: { name: true } }),
    ]);
    const body = renderSetupMessage(panel, { serverName: guild?.name ?? 'GYNX.GG', welcome });
    const msg = await deps.discord.sendMessage(channelId, body);
    return { discordId: msg.id, before: null, resource: { key, type: 'MESSAGE', id: msg.id, channelId } };
  }

  // ── Verification ─────────────────────────────────────────────────────────
  const finalSnapshot = await port.snapshot(guildId);
  const finalManifest = await deps.db.setupResource.findMany({ where: { guildId } });
  let verificationFindings: Finding[] = [];
  try {
    verificationFindings = await verifySetup(port, finalSnapshot, bp, finalManifest);
  } catch (e) {
    verificationFindings = [{ level: 'warning', code: 'verify-failed', message: classifyError(e).message }];
  }
  const verified = isVerified(verificationFindings);
  if (verified) {
    await deps.db.setupResource.updateMany({ where: { guildId }, data: { lastVerifiedAt: deps.now() } });
  }
  const all = await deps.db.setupChange.findMany({ where: { operationId: op.id } });
  const counts = countChanges(all, 'apply');
  const anyApplied = all.some((c) => c.status === 'APPLIED');
  const status: ExecutionSummary['status'] =
    counts.failed === 0 && verified ? 'SUCCEEDED' : counts.failed > 0 && !anyApplied ? 'FAILED' : 'PARTIAL';
  return { operationId: op.id, status, ...counts, verified, verificationFindings };
}

function isPrivateKey(bp: EffectiveBlueprint, key: string): boolean {
  if (key.startsWith('category:'))
    return bp.categories.find((c) => categoryKey(c.key) === key)?.private ?? false;
  return allChannels(bp).find((c) => `channel:${c.key}` === key)?.private ?? false;
}

async function finish(deps: ExecDeps, ctx: Ctx, op: SetupOperation, summary: ExecutionSummary) {
  const now = deps.now();
  await deps.db.setupOperation.update({
    where: { id: op.id },
    data: { status: summary.status, result: toJson(summary), completedAt: now },
  });

  if (op.operationType === 'ROLLBACK') {
    const remaining = await deps.db.setupResource.count({ where: { guildId: op.guildId } });
    await deps.db.guildSetup.update({
      where: { guildId: op.guildId },
      data: {
        status: remaining === 0 ? 'NOT_STARTED' : 'PARTIAL',
        completedAt: remaining === 0 ? null : undefined,
      },
    });
  } else {
    const ok = summary.status === 'SUCCEEDED';
    await deps.db.guildSetup.update({
      where: { guildId: op.guildId },
      data: {
        status: ok ? 'COMPLETE' : summary.status === 'FAILED' ? 'FAILED' : 'PARTIAL',
        completedAt: ok ? now : undefined,
        lastVerifiedAt: summary.verified ? now : undefined,
        blueprintVersion: ok ? op.blueprintVersion : undefined,
      },
    });
  }

  await audit(ctx, {
    action: op.operationType === 'ROLLBACK' ? 'setup.rollback' : 'setup.apply',
    targetType: 'SetupOperation',
    targetId: op.id,
    result: summary.status === 'FAILED' ? 'FAILURE' : 'SUCCESS',
    metadata: {
      type: op.operationType,
      status: summary.status,
      created: summary.created,
      adopted: summary.adopted,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
      verified: summary.verified,
    },
  });

  // Short private summary (counts only; no names, ids of resources or errors).
  try {
    const cfg = await getGuildConfig(deps.db, op.guildId);
    if (cfg.setupLogChannelId) {
      await deps.discord.sendMessage(cfg.setupLogChannelId, {
        embeds: [
          brandEmbed({
            title: T.summaryTitle({
              type: op.operationType.toLowerCase(),
              status: summary.status.toLowerCase(),
            }),
            description: T.summaryBody({
              created: summary.created,
              adopted: summary.adopted,
              updated: summary.updated,
              skipped: summary.skipped,
              failed: summary.failed,
              verified: summary.verified ? T.summaryVerified() : T.summaryNotVerified(),
              operationId: op.id,
              userId: op.initiatedByUserId,
            }),
          }),
        ],
        allowed_mentions: NO_MENTIONS,
      });
    }
  } catch (e) {
    deps.log.warn({ error: classifyError(e).message }, 'setup: could not post the summary');
  }
}

export type { GuildSnapshot };
