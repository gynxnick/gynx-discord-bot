import type { Ctx, ServiceDeps } from '../core/context';
import type {
  ExecutionSummary,
  OperationPreview,
  SetupConfig,
  SetupConfigInput,
  SetupOverview,
} from './types';
import type { ComponentKey } from './blueprint';

/**
 * Setup wizard service API. Every function that reads or changes setup
 * requires `setup.manage` (checked inside, audited on denial), so the bot
 * command and the dashboard share one authorization and audit path.
 *
 * Flow: preview → confirm → (worker) run. A preview stores a SetupOperation
 * (PREVIEWED) with the plan and its hash; confirm re-plans against the live
 * server and refuses (returns a fresh preview) if anything changed.
 *
 * CONTRACT FILE: signatures are fixed; the engine implements the bodies.
 */

const todo = (): never => {
  throw new Error('setup engine not implemented yet');
};

export async function getSetupOverview(_ctx: Ctx): Promise<SetupOverview> {
  return todo();
}

export async function getSetupConfig(_ctx: Ctx): Promise<SetupConfig> {
  return todo();
}

/** Validates with setupConfigSchema; audited (`setup.config`). */
export async function updateSetupConfig(_ctx: Ctx, _patch: SetupConfigInput): Promise<SetupConfig> {
  return todo();
}

/** START (first provisioning / resume), REPAIR (restore missing/renamed), UPDATE (apply a newer blueprint). */
export async function previewOperation(
  _ctx: Ctx,
  _input: { type: 'START' | 'REPAIR' | 'UPDATE'; selection?: ComponentKey[] },
): Promise<OperationPreview> {
  return todo();
}

/** Preview reverting an operation (default: the most recent applied one). */
export async function previewRollback(_ctx: Ctx, _operationId?: string): Promise<OperationPreview> {
  return todo();
}

/**
 * Confirm a previewed operation. `acceptDisruptive` must be true when the
 * preview had disruptive changes. Returns `stale` + a fresh preview when the
 * server changed since the preview; otherwise queues the worker job.
 */
export async function confirmOperation(
  _ctx: Ctx,
  _operationId: string,
  _opts: { acceptDisruptive: boolean },
): Promise<{ status: 'QUEUED'; operationId: string } | { status: 'STALE'; preview: OperationPreview }> {
  return todo();
}

export async function cancelOperation(_ctx: Ctx, _operationId: string): Promise<void> {
  return todo();
}

export interface OperationListItem {
  id: string;
  type: 'START' | 'REPAIR' | 'UPDATE' | 'ROLLBACK';
  status: string;
  initiatedByUserId: string;
  startedAt: string;
  completedAt: string | null;
  summary: { created: number; updated: number; skipped: number; failed: number } | null;
}

export async function listOperations(
  _ctx: Ctx,
  _page: { cursor?: string; limit?: number },
): Promise<{ items: OperationListItem[]; nextCursor: string | null }> {
  return todo();
}

export interface OperationDetail extends OperationListItem {
  preview: OperationPreview;
  result: ExecutionSummary | null;
  changes: Array<{ seq: number; kind: string; key: string; status: string; error: string | null }>;
}

export async function getOperation(_ctx: Ctx, _operationId: string): Promise<OperationDetail> {
  return todo();
}

/** Worker: execute a QUEUED operation (idempotent, resumable). Needs deps.discordAdmin. */
export async function runSetupOperation(_deps: ServiceDeps, _operationId: string): Promise<ExecutionSummary> {
  return todo();
}

/** Job type the worker handles (payload: { operationId }). */
export const SETUP_APPLY_JOB = 'setup.apply';
