import type { Prisma } from '@gynx/database';
import { sha256 } from '@gynx/shared';
import { parseStoredConfig } from './config';
import type { ExecutionSummary, OperationPreview, Plan, PlannedChange, SetupConfig } from './types';

/** JSON-safe copy (bigints → strings). */
export function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

/** Canonical hash of a plan's changes (descriptions excluded: wording is not state). */
export function planHash(changes: readonly PlannedChange[]): string {
  const canonical = changes.map((c) => {
    const { description: _d, ...rest } = c;
    return Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));
  });
  return sha256(JSON.stringify(canonical));
}

export function summarize(plan: Plan): OperationPreview['summary'] {
  const count = (pred: (c: PlannedChange) => boolean) => plan.changes.filter(pred).length;
  return {
    create: count(
      (c) => c.kind === 'role.create' || c.kind === 'channel.create' || c.kind === 'template.create',
    ),
    adopt: count((c) => c.kind === 'role.adopt' || c.kind === 'channel.adopt'),
    update: count(
      (c) =>
        c.kind === 'role.update' ||
        c.kind === 'channel.update' ||
        c.kind === 'role.position' ||
        c.kind === 'binding.set' ||
        c.kind === 'grant.set',
    ),
    permissions: count((c) => c.kind === 'overwrite.set'),
    messages: count((c) => c.kind === 'message.deploy'),
    disruptive: count((c) => c.risk === 'disruptive'),
  };
}

/** What SetupOperation.preview stores: the preview plus the context it was planned with. */
export interface StoredPreview extends OperationPreview {
  context: { config: SetupConfig; targetOperationId?: string | null; targetChangeIds?: string[] };
}

export function parseStoredPreview(raw: unknown): StoredPreview {
  const p = raw as StoredPreview;
  return { ...p, context: { ...p.context, config: parseStoredConfig(p.context?.config) } };
}

/** The preview without the internal context (API responses). */
export function publicPreview(raw: unknown): OperationPreview {
  const { context: _c, ...rest } = raw as StoredPreview;
  return rest;
}

export function parseSummary(raw: unknown): ExecutionSummary | null {
  return raw && typeof raw === 'object' ? (raw as ExecutionSummary) : null;
}
