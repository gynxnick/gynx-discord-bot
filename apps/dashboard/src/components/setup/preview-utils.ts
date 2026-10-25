/**
 * Pure helpers for rendering setup previews, progress and results.
 * Safe on server and client (no bigint: previews carry permission bits as strings).
 */
import type { BadgeTone } from '@/components/ui/Badge';
import type { FindingView, PlannedChangeView } from './types';

export type ChangeKind = PlannedChangeView['kind'];

export interface ChangeGroupDef {
  id: string;
  label: string;
  kinds: readonly ChangeKind[];
}

/** Display order of change groups (mirrors the order the engine applies them). */
export const CHANGE_GROUPS: readonly ChangeGroupDef[] = [
  { id: 'roles', label: 'Roles', kinds: ['role.create', 'role.adopt', 'role.update', 'role.position'] },
  {
    id: 'channels',
    label: 'Categories and channels',
    kinds: ['channel.create', 'channel.adopt', 'channel.update'],
  },
  { id: 'permissions', label: 'Permissions', kinds: ['overwrite.set'] },
  { id: 'grants', label: 'Bot dashboard access for staff roles', kinds: ['grant.set'] },
  { id: 'messages', label: 'Messages and panels', kinds: ['message.deploy'] },
  { id: 'routing', label: 'Log, alert and feature routing', kinds: ['binding.set'] },
  { id: 'templates', label: 'Templates', kinds: ['template.create'] },
];

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  'role.create': 'Create role',
  'role.adopt': 'Adopt existing role',
  'role.update': 'Update role',
  'role.position': 'Reorder role',
  'channel.create': 'Create',
  'channel.adopt': 'Adopt existing',
  'channel.update': 'Update',
  'overwrite.set': 'Set permissions',
  'binding.set': 'Route feature',
  'grant.set': 'Grant dashboard access',
  'message.deploy': 'Post or update message',
  'template.create': 'Create template',
};

const KIND_ORDER = new Map<string, number>(CHANGE_GROUPS.flatMap((g) => g.kinds).map((k, i) => [k, i]));

export interface ChangeGroup {
  id: string;
  label: string;
  changes: PlannedChangeView[];
  disruptive: number;
}

/**
 * Group planned changes by area (CHANGE_GROUPS order). Within a group,
 * disruptive changes come first, then kind order, then the original plan
 * order (stable). Empty groups are dropped; unknown kinds go to "Other".
 */
export function groupChanges(changes: readonly PlannedChangeView[]): ChangeGroup[] {
  const byGroup = new Map<string, Array<{ c: PlannedChangeView; i: number }>>();
  const groupOf = new Map<string, string>(CHANGE_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.id])));
  changes.forEach((c, i) => {
    const gid = groupOf.get(c.kind) ?? 'other';
    byGroup.set(gid, [...(byGroup.get(gid) ?? []), { c, i }]);
  });
  const defs = [...CHANGE_GROUPS, { id: 'other', label: 'Other', kinds: [] }];
  const out: ChangeGroup[] = [];
  for (const g of defs) {
    const items = byGroup.get(g.id);
    if (!items?.length) continue;
    items.sort(
      (a, b) =>
        Number(b.c.risk === 'disruptive') - Number(a.c.risk === 'disruptive') ||
        (KIND_ORDER.get(a.c.kind) ?? 99) - (KIND_ORDER.get(b.c.kind) ?? 99) ||
        a.i - b.i,
    );
    out.push({
      id: g.id,
      label: g.label,
      changes: items.map((x) => x.c),
      disruptive: items.filter((x) => x.c.risk === 'disruptive').length,
    });
  }
  return out;
}

const LEVEL_ORDER: Record<string, number> = { blocking: 0, warning: 1, info: 2 };

/** Blocking first, then warnings, then info; stable within a level. */
export function sortFindings<T extends Pick<FindingView, 'level'>>(findings: readonly T[]): T[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (LEVEL_ORDER[a.f.level] ?? 3) - (LEVEL_ORDER[b.f.level] ?? 3) || a.i - b.i)
    .map((x) => x.f);
}

export function countFindings(
  findings: readonly Pick<FindingView, 'level'>[],
): Record<FindingView['level'], number> {
  const out = { blocking: 0, warning: 0, info: 0 };
  for (const f of findings) if (f.level in out) out[f.level] += 1;
  return out;
}

export const FINDING_TONES: Record<FindingView['level'], BadgeTone> = {
  blocking: 'danger',
  warning: 'warning',
  info: 'accent',
};
export const FINDING_LABELS: Record<FindingView['level'], string> = {
  blocking: 'Blocking',
  warning: 'Warning',
  info: 'Info',
};

export const OPERATION_TYPE_LABELS: Record<string, string> = {
  START: 'Setup',
  REPAIR: 'Repair',
  UPDATE: 'Blueprint update',
  ROLLBACK: 'Rollback',
};

export const OPERATION_STATUS_TONES: Record<string, BadgeTone> = {
  PREVIEWED: 'neutral',
  QUEUED: 'accent',
  RUNNING: 'accent',
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};
export const OPERATION_STATUS_LABELS: Record<string, string> = {
  PREVIEWED: 'Awaiting confirmation',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  PARTIAL: 'Partly applied',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const SETUP_STATUS_TONES: Record<string, BadgeTone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'accent',
  PARTIAL: 'warning',
  COMPLETE: 'success',
  FAILED: 'danger',
};

/** The operation is waiting for the worker or being applied: keep polling. */
export const isActiveStatus = (status: string) => status === 'QUEUED' || status === 'RUNNING';

/** The operation will not change any more. */
export const isFinishedStatus = (status: string) =>
  status === 'SUCCEEDED' || status === 'PARTIAL' || status === 'FAILED' || status === 'CANCELLED';

/** An applied operation that can be rolled back (rolling back a rollback is not offered). */
export const isRollbackCandidate = (op: { type: string; status: string }) =>
  op.type !== 'ROLLBACK' && (op.status === 'SUCCEEDED' || op.status === 'PARTIAL');

export interface Progress {
  total: number;
  done: number;
  applied: number;
  skipped: number;
  failed: number;
  percent: number;
}

/** Progress from per-change checkpoints (APPLIED/SKIPPED/FAILED/ROLLED_BACK count as done). */
export function progressOf(changes: ReadonlyArray<{ status: string }>, plannedTotal: number): Progress {
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const c of changes) {
    if (c.status === 'APPLIED' || c.status === 'ROLLED_BACK') applied += 1;
    else if (c.status === 'SKIPPED') skipped += 1;
    else if (c.status === 'FAILED') failed += 1;
  }
  const total = Math.max(plannedTotal, changes.length);
  const done = applied + skipped + failed;
  return {
    total,
    done,
    applied,
    skipped,
    failed,
    percent: total === 0 ? 100 : Math.min(100, Math.round((done / total) * 100)),
  };
}

/** One-line description of a change's target for tables (e.g. the new name or the channel). */
export function changeTarget(c: PlannedChangeView): string {
  switch (c.kind) {
    case 'role.create':
    case 'channel.create':
    case 'template.create':
      return c.name;
    case 'overwrite.set':
      return `${c.channelKey} → ${c.target}`;
    case 'message.deploy':
      return `${c.panel} in ${c.channelKey}`;
    case 'binding.set':
      return `${c.binding} → ${c.resourceKey}`;
    case 'grant.set':
      return `${c.roleKey} → ${c.preset}`;
    default:
      return c.key;
  }
}
