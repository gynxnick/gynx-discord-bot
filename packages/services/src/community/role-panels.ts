import { DiscordAPIError } from '@discordjs/rest';
import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
  APIMessageComponentEmoji,
} from 'discord-api-types/v10';
import { z } from 'zod';
import type { Logger } from '@gynx/config';
import type { Db, RolePanel, SelfAssignableRole } from '@gynx/database';
import { neutraliseMentions, notFound, sha256, truncate } from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import type { DiscordPort, MessageBody } from '../core/discord-port';
import { enqueueJob } from '../core/jobs';
import { brandEmbed } from '../core/render';
import { GROUP_LABELS } from './render';
import { SELF_ROLE_GROUPS, snowflakeSchema } from './schemas';

/**
 * Role panels: a public message with one button per self-assignable role.
 * Clicking a button toggles that role through `toggleSelfRole`, which re-checks
 * the allowlist and role safety every time (the button's role ID is never trusted).
 * The worker keeps each panel in sync with the allowlist.
 */

/** Discord allows 5 rows of 5 buttons. */
export const MAX_PANEL_ROLES = 25;
/** Re-send unchanged panels this often, so a deleted message is noticed and re-posted. */
export const PANEL_REFRESH_MS = 30 * 60_000;
export const PANEL_BUTTON_PREFIX = 'selfrole:btn:';

export const rolePanelCreateSchema = z.object({
  channelId: snowflakeSchema,
  title: z.string().trim().min(1).max(100).default('Pick your roles'),
  description: z.string().trim().max(1000).optional(),
  /** Empty = every group. */
  groups: z.array(z.enum(SELF_ROLE_GROUPS)).max(SELF_ROLE_GROUPS.length).default([]),
});
export const rolePanelUpdateSchema = rolePanelCreateSchema.partial().strict();

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

/** Unicode emoji or a custom `<:name:id>` / `<a:name:id>`; anything else is dropped (Discord rejects bad emoji). */
export function buttonEmoji(raw: string | null): APIMessageComponentEmoji | undefined {
  if (!raw) return undefined;
  const custom = raw.trim().match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
  if (custom) return { name: custom[2]!, id: custom[3]!, animated: custom[1] === 'a' };
  const t = raw.trim();
  return t.length <= 16 && /\p{Extended_Pictographic}/u.test(t) && !/[A-Za-z0-9<>:]/.test(t)
    ? { name: t }
    : undefined;
}

export function panelRoles(
  panel: Pick<RolePanel, 'groups'>,
  roles: readonly SelfAssignableRole[],
): SelfAssignableRole[] {
  const wanted = new Set(panel.groups);
  return roles
    .filter((r) => r.enabled && (wanted.size === 0 || wanted.has(r.group)))
    .sort(
      (a, b) =>
        a.group.localeCompare(b.group) ||
        a.sortOrder - b.sortOrder ||
        a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
}

export function renderRolePanel(
  panel: Pick<RolePanel, 'title' | 'description' | 'groups'>,
  allRoles: readonly SelfAssignableRole[],
): MessageBody {
  const roles = panelRoles(panel, allRoles);
  const shown = roles.slice(0, MAX_PANEL_ROLES);
  const byGroup = new Map<string, string[]>();
  for (const r of shown) {
    const line = `${r.emoji ? `${r.emoji} ` : ''}**${neutraliseMentions(r.label)}**${r.description ? ` · ${neutraliseMentions(r.description)}` : ''}`;
    byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), line]);
  }
  const intro = panel.description
    ? neutraliseMentions(panel.description)
    : 'Click a button to add a role. Click it again to remove it.';
  const extra =
    roles.length > MAX_PANEL_ROLES
      ? `\n\n${roles.length - MAX_PANEL_ROLES} more roles are available with \`/roles\`.`
      : '';
  const embed: APIEmbed = brandEmbed({
    title: truncate(panel.title, 256),
    description: shown.length ? `${intro}${extra}` : 'No roles are available here yet.',
    fields: [...byGroup.entries()].map(([g, lines]) => ({
      name: GROUP_LABELS[g] ?? g,
      value: lines.join('\n'),
    })),
    footer: 'Only you see the confirmation · Roles update instantly',
  });

  const rows: Row[] = [];
  for (let i = 0; i < shown.length; i += 5) {
    rows.push({
      type: 1,
      components: shown.slice(i, i + 5).map((r) => ({
        type: 2,
        style: 2,
        label: truncate(r.label, 80),
        custom_id: `${PANEL_BUTTON_PREFIX}${r.roleId}`,
        emoji: buttonEmoji(r.emoji),
      })),
    });
  }
  return { embeds: [embed], components: rows };
}

// ── Staff management ─────────────────────────────────────────────────────────

const syncKey = (panelId: string, now: Date) => `community.rolepanel.sync:${panelId}:${now.getTime()}`;

async function enqueueSync(db: Db, guildId: string, panelId: string, now: Date) {
  await enqueueJob(db, {
    type: 'community.rolepanel.sync',
    dedupeKey: syncKey(panelId, now),
    runAt: now,
    guildId,
    payload: { panelId },
  });
}

/** Re-render every panel of the guild soon (called when the allowlist changes). */
export async function requestRolePanelSync(db: Db, guildId: string, now: Date): Promise<number> {
  const panels = await db.rolePanel.findMany({ where: { guildId }, select: { id: true } });
  for (const p of panels) await enqueueSync(db, guildId, p.id, now);
  return panels.length;
}

export async function listRolePanels(ctx: Ctx): Promise<RolePanel[]> {
  await requirePermission(ctx, 'community.manage');
  return ctx.db.rolePanel.findMany({ where: { guildId: ctx.guildId }, orderBy: { createdAt: 'asc' } });
}

export async function createRolePanel(
  ctx: Ctx,
  raw: z.input<typeof rolePanelCreateSchema>,
): Promise<RolePanel> {
  await requireModule(ctx, 'community');
  await requirePermission(ctx, 'community.manage', 'community.rolepanel.create');
  const input = rolePanelCreateSchema.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const panel = await tx.rolePanel.create({
      data: {
        guildId: ctx.guildId,
        channelId: input.channelId,
        title: input.title,
        description: input.description ?? null,
        groups: input.groups,
        createdById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'community.rolepanel.create',
        targetType: 'RolePanel',
        targetId: panel.id,
        metadata: { channelId: input.channelId, groups: input.groups },
      },
      tx,
    );
    await enqueueSync(tx, ctx.guildId, panel.id, ctx.now());
    return panel;
  });
}

export async function updateRolePanel(
  ctx: Ctx,
  id: string,
  raw: z.input<typeof rolePanelUpdateSchema>,
): Promise<RolePanel> {
  await requirePermission(ctx, 'community.manage', 'community.rolepanel.update');
  const input = rolePanelUpdateSchema.parse(raw);
  const existing = await ctx.db.rolePanel.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!existing) throw notFound('Role panel');
  const moved = input.channelId !== undefined && input.channelId !== existing.channelId;
  return ctx.db.$transaction(async (tx) => {
    const panel = await tx.rolePanel.update({
      where: { id },
      data: {
        ...input,
        description: input.description === undefined ? undefined : input.description || null,
        // Moving channels: forget the old message (it is deleted below) so a new one is posted.
        ...(moved ? { messageId: null, hash: null } : { hash: null }),
      },
    });
    if (moved && existing.messageId) {
      await enqueueJob(tx, {
        type: 'community.rolepanel.delete',
        dedupeKey: `community.rolepanel.delete:${existing.channelId}:${existing.messageId}`,
        runAt: ctx.now(),
        guildId: ctx.guildId,
        payload: { channelId: existing.channelId, messageId: existing.messageId },
      });
    }
    await audit(
      ctx,
      {
        action: 'community.rolepanel.update',
        targetType: 'RolePanel',
        targetId: id,
        metadata: { fields: Object.keys(input) },
      },
      tx,
    );
    await enqueueSync(tx, ctx.guildId, id, ctx.now());
    return panel;
  });
}

export async function deleteRolePanel(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'community.manage', 'community.rolepanel.delete');
  const panel = await ctx.db.rolePanel.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!panel) throw notFound('Role panel');
  await ctx.db.$transaction(async (tx) => {
    await tx.rolePanel.delete({ where: { id } });
    if (panel.messageId) {
      await enqueueJob(tx, {
        type: 'community.rolepanel.delete',
        dedupeKey: `community.rolepanel.delete:${panel.channelId}:${panel.messageId}`,
        runAt: ctx.now(),
        guildId: ctx.guildId,
        payload: { channelId: panel.channelId, messageId: panel.messageId },
      });
    }
    await audit(
      ctx,
      {
        action: 'community.rolepanel.delete',
        targetType: 'RolePanel',
        targetId: id,
        metadata: { channelId: panel.channelId },
      },
      tx,
    );
  });
}

/** Staff "refresh now": forces a re-render of one panel or all panels. */
export async function refreshRolePanels(ctx: Ctx, id?: string): Promise<number> {
  await requirePermission(ctx, 'community.manage');
  const where = { guildId: ctx.guildId, ...(id ? { id } : {}) };
  await ctx.db.rolePanel.updateMany({ where, data: { hash: null } });
  const panels = await ctx.db.rolePanel.findMany({ where, select: { id: true } });
  for (const p of panels) await enqueueSync(ctx.db, ctx.guildId, p.id, ctx.now());
  return panels.length;
}

// ── Sync (worker) ────────────────────────────────────────────────────────────

export type PanelSyncResult =
  'gone' | 'module_disabled' | 'posted' | 'edited' | 'unchanged' | 'reposted' | 'no_access';

const httpStatus = (e: unknown) => (e instanceof DiscordAPIError ? e.status : undefined);

export async function syncRolePanel(
  deps: { db: Db; discord: DiscordPort; log: Logger },
  panelId: string,
  now: Date,
): Promise<PanelSyncResult> {
  const panel = await deps.db.rolePanel.findUnique({ where: { id: panelId } });
  if (!panel) return 'gone';
  const cfg = await getGuildConfig(deps.db, panel.guildId);
  if (!cfg.enabledModules.includes('community')) return 'module_disabled';

  const roles = await deps.db.selfAssignableRole.findMany({
    where: { guildId: panel.guildId, enabled: true },
  });
  const body = renderRolePanel(panel, roles);
  const { timestamp: _t, ...embedWithoutTime } = body.embeds![0]!;
  const hash = sha256(JSON.stringify({ embed: embedWithoutTime, components: body.components }));

  const save = (messageId: string) =>
    deps.db.rolePanel.update({ where: { id: panel.id }, data: { messageId, hash, syncedAt: now } });

  if (panel.messageId) {
    const fresh = panel.syncedAt && now.getTime() - panel.syncedAt.getTime() < PANEL_REFRESH_MS;
    if (panel.hash === hash && fresh) return 'unchanged';
    try {
      await deps.discord.editMessage(panel.channelId, panel.messageId, body);
      await save(panel.messageId);
      return 'edited';
    } catch (e) {
      const code = httpStatus(e);
      if (code === 403) {
        deps.log.warn({ panelId, channelId: panel.channelId }, 'role panel: missing access to edit');
        return 'no_access';
      }
      if (code !== 404) throw e;
      deps.log.info({ panelId }, 'role panel message was deleted; posting a new one');
    }
  }

  try {
    const msg = await deps.discord.sendMessage(panel.channelId, body);
    await save(msg.id);
    return panel.messageId ? 'reposted' : 'posted';
  } catch (e) {
    const code = httpStatus(e);
    if (code === 403 || code === 404) {
      deps.log.warn(
        { panelId, channelId: panel.channelId },
        'role panel: cannot post (check channel and bot permissions)',
      );
      return 'no_access';
    }
    throw e;
  }
}
