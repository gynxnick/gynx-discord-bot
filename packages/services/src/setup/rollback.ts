import type { Db, SetupChange, SetupOperation } from '@gynx/database';
import { AppError, sha256 } from '@gynx/shared';
import type { Ctx } from '../core/context';
import { getGuildConfig } from '../core/config';
import type { ExecDeps, ExecRuntime } from './executor';
import { classifyError, countChanges, withRetries } from './executor';
import type { BindingKey } from './planner';
import type { DiscordAdminPort } from './port';
import { toJson } from './store';
import type { ExecutionSummary, Finding, PlannedChange } from './types';

/**
 * Scoped rollback: reverts only the changes APPLIED by one operation.
 * - created roles/channels are deleted only if they still exist and (channels)
 *   hold no member messages; a category is kept while it still has channels
 * - adopted resources are never deleted (they only leave the manifest)
 * - updates (rename, move, slow mode, overwrites, bindings) restore `before`
 * - overwrites the operation added are removed
 * - messages the operation posted are deleted
 */

export interface RollbackPlan {
  target: SetupOperation;
  changes: PlannedChange[];
  /** Target SetupChange id per planned change (same order). */
  targetChangeIds: string[];
  findings: Finding[];
  hash: string;
}

const undoable = (c: SetupChange) => c.status === 'APPLIED' && c.kind !== 'role.position';

export async function findRollbackTarget(
  db: Db,
  guildId: string,
  operationId?: string,
): Promise<SetupOperation> {
  if (operationId) {
    const op = await db.setupOperation.findFirst({ where: { id: operationId, guildId } });
    if (!op) throw new AppError('NOT_FOUND', 'Setup operation was not found.');
    if (op.operationType === 'ROLLBACK')
      throw new AppError('INVALID_STATE', 'A rollback cannot be rolled back.');
    if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(op.status))
      throw new AppError('INVALID_STATE', 'Only finished operations can be rolled back.');
    return op;
  }
  const ops = await db.setupOperation.findMany({
    where: {
      guildId,
      operationType: { not: 'ROLLBACK' },
      status: { in: ['SUCCEEDED', 'PARTIAL', 'FAILED'] },
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  for (const op of ops) {
    const n = await db.setupChange.count({ where: { operationId: op.id, status: 'APPLIED' } });
    if (n > 0) return op;
  }
  throw new AppError('NOT_FOUND', 'There is no applied setup operation to roll back.');
}

function describe(c: SetupChange): { text: string; disruptive: boolean } {
  const planned = c.after as unknown as PlannedChange & { name?: string };
  const what = planned.name ? `${planned.name}` : c.blueprintKey;
  switch (c.kind) {
    case 'role.create':
      return {
        text: `Delete role ${what} (created by the setup; members who were given it since will lose it).`,
        disruptive: true,
      };
    case 'channel.create':
      return {
        text: `Delete ${c.blueprintKey.startsWith('category:') ? 'category' : 'channel'} ${what} (created by the setup; kept if it has member messages or channels).`,
        disruptive: true,
      };
    case 'role.adopt':
    case 'channel.adopt':
      return { text: `Stop managing ${c.blueprintKey} (the resource itself is kept).`, disruptive: false };
    case 'role.update':
    case 'channel.update':
      return { text: `Restore the previous settings of ${c.blueprintKey}.`, disruptive: false };
    case 'overwrite.set':
      return { text: `Restore the previous permissions (${c.blueprintKey}).`, disruptive: false };
    case 'binding.set':
      return {
        text: `Restore the previous ${c.blueprintKey.replace('binding:', '')} setting.`,
        disruptive: false,
      };
    case 'grant.set':
      return { text: `Remove the dashboard grant ${c.blueprintKey} added by the setup.`, disruptive: false };
    case 'message.deploy':
      return {
        text: `Delete the ${c.blueprintKey.replace('message:', '')} message posted by the setup.`,
        disruptive: false,
      };
    case 'template.create':
      return { text: 'Delete the announcement template created by the setup.', disruptive: false };
    default:
      return { text: c.blueprintKey, disruptive: false };
  }
}

export async function planRollback(
  db: Db,
  port: DiscordAdminPort,
  guildId: string,
  operationId?: string,
): Promise<RollbackPlan> {
  const target = await findRollbackTarget(db, guildId, operationId);
  const rows = (
    await db.setupChange.findMany({ where: { operationId: target.id }, orderBy: { seq: 'desc' } })
  ).filter(undoable);
  const snapshot = await port.snapshot(guildId);
  const findings: Finding[] = [];
  const changes: PlannedChange[] = [];
  const targetChangeIds: string[] = [];
  for (const r of rows) {
    const planned = r.after as unknown as PlannedChange;
    const d = describe(r);
    if (r.kind === 'channel.create' && r.discordResourceId) {
      const ch = snapshot.channels.find((c) => c.id === r.discordResourceId);
      if (
        ch &&
        ch.type !== 4 &&
        (await port.hasNonBotMessages(ch.id, snapshot.botUserId).catch(() => true))
      ) {
        findings.push({
          level: 'warning',
          code: 'contains-member-messages',
          key: r.blueprintKey,
          message: `${ch.name} contains member messages and will be kept.`,
        });
      }
    }
    if (r.kind === 'role.adopt' || r.kind === 'channel.adopt') {
      findings.push({ level: 'info', code: 'adopted-kept', key: r.blueprintKey, message: d.text });
    }
    changes.push({
      ...planned,
      risk: d.disruptive ? 'disruptive' : 'safe',
      description: d.text,
    } as PlannedChange);
    targetChangeIds.push(r.id);
  }
  const hash = sha256(JSON.stringify(rows.map((r) => [r.id, r.status, r.discordResourceId])));
  return { target, changes, targetChangeIds, findings, hash };
}

class Skip extends Error {}

export async function runRollback(
  deps: ExecDeps,
  ctx: Ctx,
  op: SetupOperation,
  rt: ExecRuntime,
): Promise<ExecutionSummary> {
  const port = deps.discordAdmin;
  const guildId = op.guildId;
  const reason = `GYNX server setup rollback (${op.id})`;
  const preview = op.preview as unknown as { context: { targetChangeIds?: string[] } };
  const targetIds = preview.context?.targetChangeIds ?? [];

  if ((await deps.db.setupChange.count({ where: { operationId: op.id } })) === 0) {
    const targets = await deps.db.setupChange.findMany({ where: { id: { in: targetIds } } });
    const byId = new Map(targets.map((t) => [t.id, t]));
    await deps.db.setupChange.createMany({
      data: targetIds
        .map((id) => byId.get(id))
        .filter((t): t is SetupChange => Boolean(t))
        .map((t, seq) => ({
          operationId: op.id,
          seq,
          kind: t.kind,
          blueprintKey: t.blueprintKey,
          discordResourceId: t.discordResourceId,
          after: toJson({ targetChangeId: t.id }),
        })),
      skipDuplicates: true,
    });
  }
  const rows = await deps.db.setupChange.findMany({ where: { operationId: op.id }, orderBy: { seq: 'asc' } });
  const snapshot = await port.snapshot(guildId);
  const deletedChannels = new Set<string>();

  const removeManifest = (key: string, discordId: string | null) =>
    deps.db.setupResource.deleteMany({
      where: { guildId, blueprintKey: key, ...(discordId ? { discordResourceId: discordId } : {}) },
    });

  for (const row of rows) {
    if (row.status !== 'PENDING') continue;
    const targetId = (row.after as { targetChangeId?: string } | null)?.targetChangeId;
    const target = targetId ? await deps.db.setupChange.findUnique({ where: { id: targetId } }) : null;
    if (!target || target.status !== 'APPLIED') {
      await deps.db.setupChange.update({
        where: { id: row.id },
        data: { status: 'SKIPPED', error: 'Already rolled back or no longer applied.' },
      });
      continue;
    }
    try {
      await withRetries(deps, row, rt, () => revert(target));
      await deps.db.$transaction([
        deps.db.setupChange.update({ where: { id: row.id }, data: { status: 'APPLIED', error: null } }),
        deps.db.setupChange.update({ where: { id: target.id }, data: { status: 'ROLLED_BACK' } }),
      ]);
    } catch (e) {
      const skipped = e instanceof Skip;
      await deps.db.setupChange.update({
        where: { id: row.id },
        data: {
          status: skipped ? 'SKIPPED' : 'FAILED',
          error: (skipped ? e.message : classifyError(e).message).slice(0, 500),
        },
      });
    }
  }

  async function revert(t: SetupChange): Promise<void> {
    const before = (t.before ?? null) as Record<string, unknown> | null;
    const applied = ((t.after as { applied?: Record<string, unknown> } | null)?.applied ?? {}) as Record<
      string,
      string
    >;
    const id = t.discordResourceId;
    switch (t.kind) {
      case 'role.create': {
        if (id && snapshot.roles.some((r) => r.id === id)) await port.deleteRole(guildId, id, reason);
        await removeManifest(t.blueprintKey, id);
        return;
      }
      case 'channel.create': {
        const ch = id ? snapshot.channels.find((c) => c.id === id) : undefined;
        if (ch) {
          if (ch.type === 4) {
            const children = snapshot.channels.filter(
              (c) => c.parentId === ch.id && !deletedChannels.has(c.id),
            );
            if (children.length) throw new Skip('Kept: the category still contains channels.');
          } else if (await port.hasNonBotMessages(ch.id, snapshot.botUserId).catch(() => true)) {
            throw new Skip('Kept: contains member messages.');
          }
          await port.deleteChannel(ch.id, reason);
          deletedChannels.add(ch.id);
          await deps.db.setupResource.deleteMany({
            where: { guildId, resourceType: 'MESSAGE', channelId: ch.id },
          });
        }
        await removeManifest(t.blueprintKey, id);
        return;
      }
      case 'role.adopt':
      case 'channel.adopt':
        await removeManifest(t.blueprintKey, id);
        return;
      case 'role.update': {
        if (!id || !before || !snapshot.roles.some((r) => r.id === id))
          throw new Skip('The role no longer exists.');
        await port.editRole(
          guildId,
          id,
          {
            name: String(before.name),
            color: Number(before.color),
            permissions: BigInt(String(before.permissions)),
          },
          reason,
        );
        return;
      }
      case 'channel.update': {
        if (!id || !before || !snapshot.channels.some((c) => c.id === id))
          throw new Skip('The channel no longer exists.');
        await port.editChannel(
          id,
          {
            name: String(before.name),
            parentId: (before.parentId as string | null) ?? null,
            ...(before.topic !== null && before.topic !== undefined ? { topic: String(before.topic) } : {}),
            rateLimitPerUser: Number(before.rateLimitPerUser ?? 0),
          },
          reason,
        );
        return;
      }
      case 'overwrite.set': {
        const channelId = applied.channelId ?? id;
        const targetId = applied.targetId;
        if (!channelId || !targetId) throw new Skip('Nothing recorded to restore.');
        if (!snapshot.channels.some((c) => c.id === channelId))
          throw new Skip('The channel no longer exists.');
        if (before?.exists) {
          await port.setOverwrite(
            channelId,
            { id: targetId, type: Number(before.type ?? applied.targetType ?? 0) as 0 | 1 },
            BigInt(String(before.allow)),
            BigInt(String(before.deny)),
            reason,
          );
        } else {
          await port.deleteOverwrite(channelId, targetId, reason);
        }
        return;
      }
      case 'binding.set': {
        const b = t.blueprintKey.replace('binding:', '') as BindingKey;
        const value = (before?.value as string | null | undefined) ?? null;
        if (b === 'welcome.channelId') {
          await deps.db.welcomeConfig.update({ where: { guildId }, data: { channelId: value } });
        } else if (b === 'welcome.verifiedRoleId') {
          await deps.db.welcomeConfig.update({
            where: { guildId },
            data: { verifiedRoleId: value, verificationEnabled: Boolean(before?.verificationEnabled) },
          });
        } else {
          await getGuildConfig(deps.db, guildId);
          await deps.db.guildConfig.update({ where: { guildId }, data: { [b]: value } });
        }
        return;
      }
      case 'grant.set': {
        if (before?.existed) return;
        const planned = t.after as unknown as { preset: string };
        if (id)
          await deps.db.staffPermission.deleteMany({
            where: { guildId, subjectType: 'ROLE', subjectId: id, permission: planned.preset },
          });
        return;
      }
      case 'message.deploy': {
        const res = await deps.db.setupResource.findUnique({
          where: { guildId_blueprintKey: { guildId, blueprintKey: t.blueprintKey } },
        });
        const channelId = res?.channelId;
        if (id && channelId && !deletedChannels.has(channelId))
          await deps.discord.deleteMessage(channelId, id);
        if (before && typeof before.field === 'string') {
          const field = before.field as 'supportStatusChannelId' | 'dutyPanelChannelId';
          const refField = field === 'supportStatusChannelId' ? 'supportStatusMessage' : 'dutyPanelMessage';
          await deps.db.guildConfig.update({
            where: { guildId },
            data: { [field]: (before.channelBinding as string | null) ?? null, [refField]: null },
          });
        }
        await removeManifest(t.blueprintKey, id);
        return;
      }
      case 'template.create': {
        const templateId = applied.templateId;
        if (before?.created && templateId)
          await deps.db.announcementTemplate.deleteMany({ where: { id: templateId, guildId } });
        return;
      }
      default:
        throw new Skip('This change is not reverted.');
    }
  }

  const all = await deps.db.setupChange.findMany({ where: { operationId: op.id } });
  const counts = countChanges(all, 'rollback');
  const status: ExecutionSummary['status'] =
    counts.failed === 0 ? 'SUCCEEDED' : all.some((c) => c.status === 'APPLIED') ? 'PARTIAL' : 'FAILED';
  void ctx;
  return { operationId: op.id, status, ...counts, verified: false, verificationFindings: [] };
}
