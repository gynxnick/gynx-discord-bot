import { DiscordAPIError } from '@discordjs/rest';
import type { APIEmbed } from 'discord-api-types/v10';
import type { Logger } from '@gynx/config';
import type { Db } from '@gynx/database';
import { EMBED_COLORS, isValidTimeZone, sha256, truncate } from '@gynx/shared';
import { getGuildConfig } from '../core/config';
import type { DiscordPort, MessageBody } from '../core/discord-port';
import { brandEmbed } from '../core/render';
import { listOnDuty, type OnDutyEntry } from './duty';
import { SupportText as T } from './texts';

/**
 * Customer-facing support status panel. Availability only: it never contains
 * ticket controls; the optional link button points at the official website.
 */
export const PANEL_MAX_NAMES = 20;
const SAFE_URL = /^https:\/\/[^\s<>"']+$/i;

/** "10:42 AM UTC" today, "Oct 24, 10:42 AM UTC" on other days, in the server's time zone. */
export function formatLastUpdated(at: Date, timeZone: string, now: Date): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(at);
  if (day(at) === day(now)) return time;
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(at);
  return `${date}, ${time}`;
}

export interface PanelInput {
  onDuty: readonly OnDutyEntry[];
  lastUpdated: Date;
  timeZone: string;
  websiteUrl: string | null;
  now: Date;
  /** List approved staff names (setup option `showStaffNames`); counts are always shown. */
  showNames?: boolean;
}

export function renderSupportPanel(p: PanelInput): MessageBody {
  const count = p.onDuty.length;
  const online = count > 0;
  const updated = formatLastUpdated(p.lastUpdated, p.timeZone, p.now);

  const fields: NonNullable<APIEmbed['fields']> = [];
  if (online && p.showNames !== false) {
    const shown = p.onDuty.slice(0, PANEL_MAX_NAMES).map((e) => T.onDutyMember({ name: e.publicName }));
    if (count > PANEL_MAX_NAMES) shown.push(T.onDutyMore({ count: count - PANEL_MAX_NAMES }));
    fields.push({ name: T.onDutyTeamField(), value: shown.join('\n'), inline: false });
  }
  fields.push(
    {
      name: T.availabilityField(),
      value: online ? T.availabilityOnline() : T.availabilityOffline(),
      inline: true,
    },
    { name: T.staffOnDutyField(), value: String(count), inline: true },
    { name: T.lastUpdatedField(), value: updated, inline: true },
  );
  if (online) fields.push({ name: '​', value: T.onlineFooterLine(), inline: false });

  const description = online
    ? `${T.onlineHeadline()}\n\n${count === 1 ? T.onlineBodyOne() : T.onlineBodyMany({ count })}`
    : `${T.offlineHeadline()}\n\n${T.offlineBody()}`;

  const embed = brandEmbed({
    title: T.panelTitle(),
    description,
    color: online ? EMBED_COLORS.success : EMBED_COLORS.neutral,
    fields,
    timestamp: p.lastUpdated,
  });

  const website = p.websiteUrl && SAFE_URL.test(p.websiteUrl) ? p.websiteUrl : null;
  return {
    embeds: [embed],
    components: website
      ? [
          {
            type: 1,
            components: [{ type: 2, style: 5, label: truncate(T.websiteButton(), 80), url: website }],
          },
        ]
      : [],
  };
}

export type SupportPanelResult =
  'disabled' | 'module_disabled' | 'posted' | 'edited' | 'unchanged' | 'reposted' | 'no_access';

const httpStatus = (e: unknown) => (e instanceof DiscordAPIError ? e.status : undefined);
const parseRef = (ref: string | null) => {
  const [channelId, messageId] = (ref ?? '').split(':');
  return channelId && messageId ? { channelId, messageId } : null;
};

/** Post or edit the panel. Edits only when what customers see changed. */
export async function syncSupportPanel(
  deps: { db: Db; discord: DiscordPort; log: Logger },
  guildId: string,
  now: Date,
): Promise<SupportPanelResult> {
  const cfg = await getGuildConfig(deps.db, guildId);
  const channelId = cfg.supportStatusChannelId;
  if (!channelId) return 'disabled';
  if (!cfg.enabledModules.includes('support')) return 'module_disabled';

  const onDuty = await listOnDuty(deps.db, guildId, now);
  const lastUpdated = cfg.supportStatusChangedAt ?? now;
  const setup = await deps.db.guildSetup.findUnique({ where: { guildId }, select: { configuration: true } });
  const showNames = (setup?.configuration as { showStaffNames?: unknown } | null)?.showStaffNames !== false;
  const body = renderSupportPanel({
    onDuty,
    lastUpdated,
    timeZone: cfg.timezone,
    websiteUrl: cfg.websiteUrl,
    now,
    showNames,
  });
  const hash = sha256(JSON.stringify(body));
  const existing = parseRef(cfg.supportStatusMessage);

  const save = (messageId: string) =>
    deps.db.guildConfig.update({
      where: { guildId },
      data: {
        supportStatusMessage: `${channelId}:${messageId}`,
        supportStatusHash: hash,
        supportStatusChangedAt: cfg.supportStatusChangedAt ?? now,
      },
    });

  if (existing && existing.channelId !== channelId) {
    await deps.discord.deleteMessage(existing.channelId, existing.messageId).catch(() => undefined);
  }

  if (existing && existing.channelId === channelId) {
    if (cfg.supportStatusHash === hash) return 'unchanged';
    try {
      await deps.discord.editMessage(channelId, existing.messageId, body);
      await save(existing.messageId);
      return 'edited';
    } catch (e) {
      const code = httpStatus(e);
      if (code === 403) {
        deps.log.warn({ guildId, channelId }, 'support panel: missing access to edit');
        return 'no_access';
      }
      if (code !== 404) throw e;
      deps.log.info({ guildId }, 'support panel message was deleted; posting a new one');
    }
  }

  try {
    const msg = await deps.discord.sendMessage(channelId, body);
    await save(msg.id);
    return existing ? 'reposted' : 'posted';
  } catch (e) {
    const code = httpStatus(e);
    if (code === 403 || code === 404) {
      deps.log.warn({ guildId, channelId }, 'support panel: cannot post (check channel and bot permissions)');
      return 'no_access';
    }
    throw e;
  }
}
