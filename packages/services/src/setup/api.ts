import { Prisma, type SetupOperation } from '@gynx/database';
import { AppError, conflict, invalidState, validation } from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission } from '../core/authz';
import type { Ctx, ServiceDeps } from '../core/context';
import { cancelJob, enqueueJob } from '../core/jobs';
import type { ComponentKey } from './blueprint';
import { categoryKey, channelKey, messageKey, roleKey } from './blueprint';
import { PANEL_COMPONENT, loadGuildSetup, parseStoredConfig, resolveBlueprint } from './config';
import { executeSetupOperation } from './executor';
import { plan as buildPlan } from './planner';
import type { DiscordAdminPort } from './port';
import { planRollback } from './rollback';
import { loadPlanState } from './state';
import {
  parseStoredPreview,
  parseSummary,
  planHash,
  publicPreview,
  summarize,
  toJson,
  type StoredPreview,
} from './store';
import {
  setupConfigSchema,
  type ExecutionSummary,
  type OperationPreview,
  type Plan,
  type SetupConfig,
  type SetupConfigInput,
  type SetupOverview,
} from './types';
import { verifySetup } from './verify';

/**
 * Setup wizard service API. Every function that reads or changes setup
 * requires `setup.manage` (checked inside, audited on denial), so the bot
 * command and the dashboard share one authorization and audit path.
 *
 * Flow: preview → confirm → (worker) run. A preview stores a SetupOperation
 * (PREVIEWED) with the plan and its hash; confirm re-plans against the live
 * server and refuses (returns a fresh preview) if anything changed.
 */

/** Job type the worker handles (payload: { operationId }). */
export const SETUP_APPLY_JOB = 'setup.apply';
const jobKey = (operationId: string) => `${SETUP_APPLY_JOB}:${operationId}`;

function adminPort(ctx: Ctx): DiscordAdminPort {
  if (!ctx.discordAdmin) throw new AppError('CONFIG', 'Server setup is not available in this process.');
  return ctx.discordAdmin;
}

async function guard(ctx: Ctx, action: string): Promise<void> {
  await requirePermission(ctx, 'setup.manage', action);
}

async function loadConfig(ctx: Ctx): Promise<SetupConfig> {
  const row = await loadGuildSetup(ctx.db, ctx.guildId);
  return parseStoredConfig(row.configuration);
}

async function findOp(ctx: Ctx, operationId: string): Promise<SetupOperation> {
  const op = await ctx.db.setupOperation.findFirst({ where: { id: operationId, guildId: ctx.guildId } });
  if (!op) throw new AppError('NOT_FOUND', 'Setup operation was not found.');
  return op;
}

// ── Config ───────────────────────────────────────────────────────────────────

export async function getSetupConfig(ctx: Ctx): Promise<SetupConfig> {
  await guard(ctx, 'setup.config.view');
  return loadConfig(ctx);
}

/** Validates with setupConfigSchema; audited (`setup.config`). Top-level keys of the patch replace stored ones. */
export async function updateSetupConfig(ctx: Ctx, patch: SetupConfigInput): Promise<SetupConfig> {
  await guard(ctx, 'setup.config');
  const current = await loadConfig(ctx);
  const defined = Object.fromEntries(Object.entries(patch ?? {}).filter(([, v]) => v !== undefined));
  const parsed = setupConfigSchema.safeParse({ ...current, ...defined });
  if (!parsed.success) throw validation('Invalid setup configuration.', { issues: parsed.error.flatten() });
  await ctx.db.$transaction(async (tx) => {
    await tx.guildSetup.update({
      where: { guildId: ctx.guildId },
      data: { configuration: toJson(parsed.data) },
    });
    await audit(ctx, { action: 'setup.config', metadata: { changed: Object.keys(defined) } }, tx);
  });
  return parsed.data;
}

// ── Planning ─────────────────────────────────────────────────────────────────

async function computePlan(
  ctx: Ctx,
  type: 'START' | 'REPAIR' | 'UPDATE',
  config: SetupConfig,
  selection?: readonly ComponentKey[],
): Promise<Plan> {
  const port = adminPort(ctx);
  const bp = resolveBlueprint(config, selection);
  const [snapshot, manifest] = await Promise.all([
    port.snapshot(ctx.guildId),
    ctx.db.setupResource.findMany({ where: { guildId: ctx.guildId } }),
  ]);
  const state = await loadPlanState(ctx.db, port, ctx.guildId, manifest);
  return buildPlan(snapshot, bp, manifest, { type, operatorPermissions: ctx.actor.permissions, state });
}

function toPreview(
  operationId: string,
  type: OperationPreview['type'],
  blueprintVersion: number,
  plan: Plan,
): OperationPreview {
  const summary = summarize(plan);
  return {
    operationId,
    type,
    blueprintVersion,
    plan,
    summary,
    requiresDisruptiveConsent: summary.disruptive > 0,
  };
}

async function storePreview(
  ctx: Ctx,
  input: {
    type: OperationPreview['type'];
    selection: readonly string[];
    plan: Plan;
    hash: string;
    context: StoredPreview['context'];
    targetOperationId?: string | null;
  },
): Promise<OperationPreview> {
  const op = await ctx.db.setupOperation.create({
    data: {
      guildId: ctx.guildId,
      initiatedByUserId: ctx.actor.userId,
      operationType: input.type,
      status: 'PREVIEWED',
      blueprintVersion: input.plan.blueprintVersion,
      selection: [...input.selection],
      targetOperationId: input.targetOperationId ?? null,
      preview: {},
      planHash: input.hash,
    },
  });
  const preview = toPreview(op.id, input.type, input.plan.blueprintVersion, input.plan);
  const stored: StoredPreview = { ...preview, context: input.context };
  await ctx.db.setupOperation.update({ where: { id: op.id }, data: { preview: toJson(stored) } });
  await audit(ctx, {
    action: 'setup.preview',
    targetType: 'SetupOperation',
    targetId: op.id,
    metadata: { type: input.type, ...preview.summary, blocked: input.plan.blocked },
  });
  return preview;
}

function rollbackPlanOf(rp: Awaited<ReturnType<typeof planRollback>>): Plan {
  return {
    blueprintVersion: rp.target.blueprintVersion,
    changes: rp.changes,
    findings: rp.findings,
    inPlace: [],
    missingBotPermissions: [],
    blocked: false,
  };
}

/** START (first provisioning / resume), REPAIR (restore missing/renamed), UPDATE (apply a newer blueprint). */
export async function previewOperation(
  ctx: Ctx,
  input: { type: 'START' | 'REPAIR' | 'UPDATE'; selection?: ComponentKey[] },
): Promise<OperationPreview> {
  await guard(ctx, 'setup.preview');
  if (!['START', 'REPAIR', 'UPDATE'].includes(input.type)) throw validation('Unknown setup operation type.');
  const config = await loadConfig(ctx);
  const selection = input.selection ?? [];
  const plan = await computePlan(ctx, input.type, config, selection);
  return storePreview(ctx, {
    type: input.type,
    selection,
    plan,
    hash: planHash(plan.changes),
    context: { config },
  });
}

/** Preview reverting an operation (default: the most recent applied one). */
export async function previewRollback(ctx: Ctx, operationId?: string): Promise<OperationPreview> {
  await guard(ctx, 'setup.preview');
  const config = await loadConfig(ctx);
  const rp = await planRollback(ctx.db, adminPort(ctx), ctx.guildId, operationId);
  return storePreview(ctx, {
    type: 'ROLLBACK',
    selection: [],
    plan: rollbackPlanOf(rp),
    hash: rp.hash,
    targetOperationId: rp.target.id,
    context: { config, targetOperationId: rp.target.id, targetChangeIds: rp.targetChangeIds },
  });
}

/**
 * Confirm a previewed operation. `acceptDisruptive` must be true when the
 * preview had disruptive changes. Returns `stale` + a fresh preview when the
 * server changed since the preview; otherwise queues the worker job.
 */
export async function confirmOperation(
  ctx: Ctx,
  operationId: string,
  opts: { acceptDisruptive: boolean },
): Promise<{ status: 'QUEUED'; operationId: string } | { status: 'STALE'; preview: OperationPreview }> {
  await guard(ctx, 'setup.confirm');
  const op = await findOp(ctx, operationId);
  if (op.status !== 'PREVIEWED') throw conflict('This setup operation was already confirmed or cancelled.');

  // Re-plan against the live server; any difference makes the preview stale.
  let plan: Plan;
  let hash: string;
  let context: StoredPreview['context'];
  const selection = op.selection as ComponentKey[];
  if (op.operationType === 'ROLLBACK') {
    const stored = parseStoredPreview(op.preview);
    const rp = await planRollback(ctx.db, adminPort(ctx), ctx.guildId, op.targetOperationId ?? undefined);
    plan = rollbackPlanOf(rp);
    hash = rp.hash;
    context = { ...stored.context, targetOperationId: rp.target.id, targetChangeIds: rp.targetChangeIds };
  } else {
    const config = await loadConfig(ctx);
    plan = await computePlan(ctx, op.operationType, config, selection);
    hash = planHash(plan.changes);
    context = { config };
  }

  if (hash !== op.planHash) {
    await ctx.db.setupOperation.update({
      where: { id: op.id },
      data: { status: 'CANCELLED', completedAt: ctx.now() },
    });
    await audit(ctx, {
      action: 'setup.confirm',
      targetType: 'SetupOperation',
      targetId: op.id,
      result: 'FAILURE',
      metadata: { stale: true },
    });
    const preview = await storePreview(ctx, {
      type: op.operationType,
      selection,
      plan,
      hash,
      targetOperationId: op.targetOperationId,
      context,
    });
    return { status: 'STALE', preview };
  }

  const fresh = toPreview(op.id, op.operationType, plan.blueprintVersion, plan);
  if (plan.blocked)
    throw invalidState('The setup is blocked; resolve the blocking findings and preview again.');
  if (fresh.requiresDisruptiveConsent && !opts.acceptDisruptive) {
    throw validation(
      'This operation changes things members already use. Confirm the disruptive changes to continue.',
    );
  }

  await ctx.db.$transaction(async (tx) => {
    // Serialise confirmations per guild: one queued/running operation at a time.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`setup:${ctx.guildId}`}))`);
    const active = await tx.setupOperation.findFirst({
      where: { guildId: ctx.guildId, status: { in: ['QUEUED', 'RUNNING'] }, id: { not: op.id } },
    });
    if (active) throw conflict('Another setup operation is already queued or running for this server.');
    const updated = await tx.setupOperation.updateMany({
      where: { id: op.id, status: 'PREVIEWED' },
      data: { status: 'QUEUED', confirmedAt: ctx.now(), preview: toJson({ ...fresh, context }) },
    });
    if (updated.count === 0) throw conflict('This setup operation was already confirmed or cancelled.');
    await enqueueJob(tx, {
      type: SETUP_APPLY_JOB,
      dedupeKey: jobKey(op.id),
      runAt: ctx.now(),
      guildId: ctx.guildId,
      payload: { operationId: op.id },
      maxAttempts: 3,
    });
    await audit(
      ctx,
      {
        action: 'setup.confirm',
        targetType: 'SetupOperation',
        targetId: op.id,
        metadata: { type: op.operationType, ...fresh.summary, acceptDisruptive: opts.acceptDisruptive },
      },
      tx,
    );
  });
  return { status: 'QUEUED', operationId: op.id };
}

export async function cancelOperation(ctx: Ctx, operationId: string): Promise<void> {
  await guard(ctx, 'setup.cancel');
  const op = await findOp(ctx, operationId);
  if (op.status !== 'PREVIEWED' && op.status !== 'QUEUED') {
    throw conflict('This setup operation can no longer be cancelled.');
  }
  await ctx.db.$transaction(async (tx) => {
    const r = await tx.setupOperation.updateMany({
      where: { id: op.id, status: { in: ['PREVIEWED', 'QUEUED'] } },
      data: { status: 'CANCELLED', completedAt: ctx.now() },
    });
    if (r.count === 0) throw conflict('This setup operation can no longer be cancelled.');
    if (op.status === 'QUEUED') await cancelJob(tx, jobKey(op.id));
    await audit(ctx, { action: 'setup.cancel', targetType: 'SetupOperation', targetId: op.id }, tx);
  });
}

// ── Reading operations ───────────────────────────────────────────────────────

export interface OperationListItem {
  id: string;
  type: 'START' | 'REPAIR' | 'UPDATE' | 'ROLLBACK';
  status: string;
  initiatedByUserId: string;
  startedAt: string;
  completedAt: string | null;
  summary: { created: number; updated: number; skipped: number; failed: number } | null;
}

function listItem(op: SetupOperation): OperationListItem {
  const r = parseSummary(op.result);
  return {
    id: op.id,
    type: op.operationType,
    status: op.status,
    initiatedByUserId: op.initiatedByUserId,
    startedAt: op.startedAt.toISOString(),
    completedAt: op.completedAt?.toISOString() ?? null,
    summary: r
      ? { created: r.created + r.adopted, updated: r.updated, skipped: r.skipped, failed: r.failed }
      : null,
  };
}

export async function listOperations(
  ctx: Ctx,
  page: { cursor?: string; limit?: number },
): Promise<{ items: OperationListItem[]; nextCursor: string | null }> {
  await guard(ctx, 'setup.view');
  const limit = Math.min(Math.max(page.limit ?? 20, 1), 100);
  const rows = await ctx.db.setupOperation.findMany({
    where: { guildId: ctx.guildId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, limit).map(listItem);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.id : null };
}

export interface OperationDetail extends OperationListItem {
  preview: OperationPreview;
  result: ExecutionSummary | null;
  changes: Array<{ seq: number; kind: string; key: string; status: string; error: string | null }>;
}

export async function getOperation(ctx: Ctx, operationId: string): Promise<OperationDetail> {
  await guard(ctx, 'setup.view');
  const op = await findOp(ctx, operationId);
  const changes = await ctx.db.setupChange.findMany({
    where: { operationId: op.id },
    orderBy: { seq: 'asc' },
  });
  return {
    ...listItem(op),
    preview: publicPreview(op.preview),
    result: parseSummary(op.result),
    changes: changes.map((c) => ({
      seq: c.seq,
      kind: c.kind,
      key: c.blueprintKey,
      status: c.status,
      error: c.error,
    })),
  };
}

/** Worker: execute a QUEUED operation (idempotent, resumable). Needs deps.discordAdmin. */
export async function runSetupOperation(deps: ServiceDeps, operationId: string): Promise<ExecutionSummary> {
  return executeSetupOperation(deps, operationId);
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function getSetupOverview(ctx: Ctx): Promise<SetupOverview> {
  await guard(ctx, 'setup.view');
  const port = adminPort(ctx);
  const setup = await loadGuildSetup(ctx.db, ctx.guildId);
  const config = parseStoredConfig(setup.configuration);
  const bp = resolveBlueprint(config);
  const [snapshot, manifest, lastOp] = await Promise.all([
    port.snapshot(ctx.guildId),
    ctx.db.setupResource.findMany({ where: { guildId: ctx.guildId } }),
    ctx.db.setupOperation.findFirst({
      where: { guildId: ctx.guildId, status: { not: 'PREVIEWED' } },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  const byKey = new Map(manifest.map((m) => [m.blueprintKey, m]));
  const roleById = new Map(snapshot.roles.map((r) => [r.id, r]));
  const chanById = new Map(snapshot.channels.map((c) => [c.id, c]));

  let expected = 0;
  let present = 0;
  const stateOf = (
    key: string,
    name: string,
    included: boolean,
    lookup: (id: string) => { name: string } | undefined,
  ) => {
    const m = byKey.get(key);
    if (!included) return { state: 'excluded' as const, discordId: m?.discordResourceId ?? null };
    expected++;
    const cur = m ? lookup(m.discordResourceId) : undefined;
    if (!m || !cur) return { state: 'missing' as const, discordId: null };
    present++;
    return {
      state: cur.name === name ? ('present' as const) : ('renamed' as const),
      discordId: m.discordResourceId,
    };
  };

  const rolesIncluded = bp.selection.has('roles');
  const roles = bp.roles.map((r) => ({
    key: r.key,
    name: r.name,
    ...stateOf(roleKey(r.key), r.name, rolesIncluded, (id) => roleById.get(id)),
  }));
  const channels: SetupOverview['channels'] = [];
  const panels: SetupOverview['panels'] = [];
  const state = await loadPlanState(ctx.db, port, ctx.guildId, manifest);
  for (const cat of bp.categories) {
    stateOf(categoryKey(cat.key), cat.name, cat.included, (id) => chanById.get(id));
    for (const ch of cat.channels) {
      channels.push({
        key: ch.key,
        name: ch.name,
        category: cat.name,
        ...stateOf(channelKey(ch.key), ch.name, ch.included, (id) => chanById.get(id)),
      });
      if (!ch.panel) continue;
      const mk = messageKey(ch.panel);
      const m = byKey.get(mk);
      if (!ch.included || !bp.selection.has(PANEL_COMPONENT[ch.panel])) {
        panels.push({
          key: ch.panel,
          state: 'not-configured',
          channelId: m?.channelId ?? null,
          messageId: m?.discordResourceId ?? null,
        });
        continue;
      }
      expected++;
      const live = state.liveMessages.has(mk);
      if (live) present++;
      panels.push({
        key: ch.panel,
        state: live ? 'deployed' : 'missing',
        channelId: m?.channelId ?? null,
        messageId: live ? (m?.discordResourceId ?? null) : null,
      });
    }
  }

  const permissionFindings = await verifySetup(port, snapshot, bp, manifest);
  const dryRun = buildPlan(snapshot, bp, manifest, {
    type: 'START',
    operatorPermissions: ctx.actor.permissions,
    state,
  });

  return {
    status: setup.status,
    blueprintVersion: bp.version,
    deployedBlueprintVersion: setup.status === 'NOT_STARTED' ? null : setup.blueprintVersion,
    completionPercent: expected === 0 ? 100 : Math.round((present / expected) * 100),
    roles,
    channels,
    panels,
    permissionFindings,
    outstanding: dryRun.findings.filter((f) => f.level !== 'info'),
    lastOperation: lastOp
      ? {
          id: lastOp.id,
          type: lastOp.operationType,
          status: lastOp.status,
          startedAt: lastOp.startedAt.toISOString(),
          completedAt: lastOp.completedAt?.toISOString() ?? null,
        }
      : null,
    lastVerifiedAt: setup.lastVerifiedAt?.toISOString() ?? null,
  };
}
