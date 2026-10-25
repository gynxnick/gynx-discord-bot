import { DiscordAPIError } from '@discordjs/rest';
import type { APIEmbed } from 'discord-api-types/v10';
import type { Logger } from '@gynx/config';
import type { Db } from '@gynx/database';
import { EMBED_COLORS, sha256, truncate } from '@gynx/shared';
import { requirePermission } from '../core/authz';
import { getGuildConfig } from '../core/config';
import type { Ctx } from '../core/context';
import type { DiscordPort, MessageBody } from '../core/discord-port';
import { brandEmbed } from '../core/render';
import { listOnDuty, type OnDutyEntry } from './duty';
import { PANEL_MAX_NAMES, formatLastUpdated } from './panel';
import { SupportText as T } from './texts';

/**
 * Staff-facing duty-control panel (private channel): Go On Duty, Go Off Duty,
 * My Status, View On-Duty Team. Buttons call the existing duty service, which
 * updates the customer-facing support status panel.
 *
 * CONTRACT FILE: signatures are fixed; implemented by the bot/duty-panel work.
 */

/** customId prefix for the panel's buttons (handled in apps/bot/src/modules/support). */
export const DUTY_PANEL_PREFIX = 'dutypanel';

export const DUTY_PANEL_ACTIONS = ['on', 'off', 'me', 'team'] as const;
export type DutyPanelAction = (typeof DUTY_PANEL_ACTIONS)[number];

export type DutyPanelResult = 'disabled' | 'posted' | 'edited' | 'unchanged' | 'reposted' | 'no_access';

// Discord button styles: 2 secondary, 3 success, 4 danger.
const button = (action: DutyPanelAction, label: string, style: 2 | 3 | 4) => ({
  type: 2 as const,
  style,
  label: truncate(label, 80),
  custom_id: `${DUTY_PANEL_PREFIX}:${action}`,
});

/** Private staff panel. Shows only approved public names; never any ticket controls. */
export function renderDutyControlPanel(
  onDuty: readonly OnDutyEntry[],
  now: Date,
  timeZone: string,
): MessageBody {
  const count = onDuty.length;
  const lines = onDuty
    .slice(0, PANEL_MAX_NAMES)
    .map((e) =>
      T.dutyPanelMember({ name: e.publicName, since: formatLastUpdated(e.startedAt, timeZone, now) }),
    );
  if (count > PANEL_MAX_NAMES) lines.push(T.onDutyMore({ count: count - PANEL_MAX_NAMES }));

  const fields: NonNullable<APIEmbed['fields']> = [
    { name: T.dutyPanelCountField(), value: String(count), inline: true },
    { name: T.dutyPanelTeamField(), value: lines.join('\n') || T.dutyPanelNone(), inline: false },
  ];
  const embed = brandEmbed({
    title: T.dutyPanelTitle(),
    description: T.dutyPanelBody(),
    color: count > 0 ? EMBED_COLORS.success : EMBED_COLORS.neutral,
    fields,
    timestamp: now,
  });
  return {
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          button('on', T.dutyPanelOnButton(), 3),
          button('off', T.dutyPanelOffButton(), 4),
          button('me', T.dutyPanelMeButton(), 2),
          button('team', T.dutyPanelTeamButton(), 2),
        ],
      },
    ],
  };
}

/** Fingerprint of what staff see (the embed timestamp is ignored so re-syncs don't edit needlessly). */
function fingerprint(body: MessageBody): string {
  const embeds = (body.embeds ?? []).map(({ timestamp: _t, ...rest }) => rest);
  return sha256(JSON.stringify({ ...body, embeds }));
}

/**
 * Last rendered fingerprint per guild. GuildConfig has no hash column for this
 * panel, so it lives in process memory (the worker is long-lived); after a restart
 * the first sync edits once, which is harmless.
 */
const lastRendered = new Map<string, { ref: string; hash: string }>();

/** Tests: forget fingerprints (simulates a worker restart). */
export function resetDutyPanelFingerprints(): void {
  lastRendered.clear();
}

const httpStatus = (e: unknown) => (e instanceof DiscordAPIError ? e.status : undefined);
const parseRef = (ref: string | null) => {
  const [channelId, messageId] = (ref ?? '').split(':');
  return channelId && messageId ? { channelId, messageId } : null;
};

/** Post or edit the duty-control panel in GuildConfig.dutyPanelChannelId; stores GuildConfig.dutyPanelMessage. */
export async function syncDutyControlPanel(
  deps: { db: Db; discord: DiscordPort; log: Logger },
  guildId: string,
  now: Date,
): Promise<DutyPanelResult> {
  const cfg = await getGuildConfig(deps.db, guildId);
  const channelId = cfg.dutyPanelChannelId;
  if (!channelId || !cfg.enabledModules.includes('support')) return 'disabled';

  const onDuty = await listOnDuty(deps.db, guildId, now);
  const body = renderDutyControlPanel(onDuty, now, cfg.timezone);
  const hash = fingerprint(body);
  const existing = parseRef(cfg.dutyPanelMessage);

  const save = async (messageId: string) => {
    const ref = `${channelId}:${messageId}`;
    await deps.db.guildConfig.update({ where: { guildId }, data: { dutyPanelMessage: ref } });
    lastRendered.set(guildId, { ref, hash });
  };

  if (existing && existing.channelId !== channelId) {
    await deps.discord.deleteMessage(existing.channelId, existing.messageId).catch(() => undefined);
  }

  if (existing && existing.channelId === channelId) {
    const last = lastRendered.get(guildId);
    if (last && last.ref === cfg.dutyPanelMessage && last.hash === hash) return 'unchanged';
    try {
      await deps.discord.editMessage(channelId, existing.messageId, body);
      await save(existing.messageId);
      return 'edited';
    } catch (e) {
      const code = httpStatus(e);
      if (code === 403) {
        deps.log.warn({ guildId, channelId }, 'duty panel: missing access to edit');
        return 'no_access';
      }
      if (code !== 404) throw e;
      deps.log.info({ guildId }, 'duty panel message was deleted; posting a new one');
    }
  }

  try {
    const msg = await deps.discord.sendMessage(channelId, body);
    await save(msg.id);
    return existing ? 'reposted' : 'posted';
  } catch (e) {
    const code = httpStatus(e);
    if (code === 403 || code === 404) {
      deps.log.warn({ guildId, channelId }, 'duty panel: cannot post (check channel and bot permissions)');
      return 'no_access';
    }
    throw e;
  }
}

// ── Button reads (the on/off buttons call startDuty / endDuty directly) ─────

export type MyDutyStatus =
  { onDuty: true; publicName: string; startedAt: Date; expiresAt: Date } | { onDuty: false };

/** "My Status": the caller's own open session, if any. Requires `support.duty`. */
export async function getMyDutyStatus(ctx: Ctx): Promise<MyDutyStatus> {
  await requirePermission(ctx, 'support.duty', 'support.duty.status');
  const mine = (await listOnDuty(ctx.db, ctx.guildId, ctx.now())).find((e) => e.userId === ctx.actor.userId);
  return mine
    ? { onDuty: true, publicName: mine.publicName, startedAt: mine.startedAt, expiresAt: mine.expiresAt }
    : { onDuty: false };
}

/** "View On-Duty Team": approved names currently on duty. Requires `support.duty`. */
export async function viewOnDutyTeam(ctx: Ctx): Promise<OnDutyEntry[]> {
  await requirePermission(ctx, 'support.duty', 'support.duty.team');
  return listOnDuty(ctx.db, ctx.guildId, ctx.now());
}
