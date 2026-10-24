import type { APIAllowedMentions } from 'discord-api-types/v10';
import { AllowedMentionsTypes } from 'discord-api-types/v10';
import type { Announcement, AnnouncementType, MentionMode } from '@gynx/database';
import { EMBED_COLORS, isValidTimeZone, validation, zonedToUtc } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import type { MessageBody } from '../core/discord-port';
import { hexToInt } from './common';

export const ANNOUNCEMENT_TYPES = [
  'GENERAL',
  'MAINTENANCE',
  'GAME_LAUNCH',
  'FEATURE_RELEASE',
  'MILESTONE',
  'REVIEW_REQUEST',
  'POLL',
  'EVENT',
  'REFERRAL_CAMPAIGN',
] as const satisfies readonly AnnouncementType[];

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  GENERAL: 'General',
  MAINTENANCE: 'Maintenance',
  GAME_LAUNCH: 'Game launch',
  FEATURE_RELEASE: 'Feature release',
  MILESTONE: 'Milestone',
  REVIEW_REQUEST: 'Review request',
  POLL: 'Poll',
  EVENT: 'Event',
  REFERRAL_CAMPAIGN: 'Referral campaign',
};

export const MENTION_MODES = ['NONE', 'HERE', 'EVERYONE', 'ROLE'] as const satisfies readonly MentionMode[];

const TYPE_COLORS: Partial<Record<AnnouncementType, number>> = {
  MAINTENANCE: EMBED_COLORS.warning,
  MILESTONE: EMBED_COLORS.accent,
  REFERRAL_CAMPAIGN: EMBED_COLORS.accent,
};

export interface MentionPayload {
  /** Only the mention prefix (or undefined). The announcement text itself lives in the embed. */
  content?: string;
  allowed_mentions: APIAllowedMentions;
}

/**
 * Map a mention mode to message content + allowed_mentions that authorise
 * EXACTLY that mention and nothing else. Mentions inside the embed never ping.
 * Note: Discord controls @here with the same `everyone` parse flag.
 */
export function mentionPayload(mode: MentionMode, roleId?: string | null): MentionPayload {
  switch (mode) {
    case 'EVERYONE':
      return { content: '@everyone', allowed_mentions: { parse: [AllowedMentionsTypes.Everyone] } };
    case 'HERE':
      return { content: '@here', allowed_mentions: { parse: [AllowedMentionsTypes.Everyone] } };
    case 'ROLE':
      if (!roleId || !/^\d{17,20}$/.test(roleId)) throw validation('A role is required for role mentions.');
      return { content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId] } };
    case 'NONE':
    default:
      return { allowed_mentions: { parse: [] } };
  }
}

export type RenderableAnnouncement = Pick<
  Announcement,
  'type' | 'title' | 'body' | 'imageUrl' | 'color' | 'mention' | 'mentionRoleId'
>;

/** Discord message body for an announcement: one branded embed + optional mention prefix. */
export function renderAnnouncement(
  a: RenderableAnnouncement,
  opts: { footer?: string; now?: Date } = {},
): MessageBody {
  const mentions = mentionPayload(a.mention, a.mentionRoleId);
  const embed = brandEmbed({
    title: a.title,
    description: a.body,
    color: hexToInt(a.color) ?? TYPE_COLORS[a.type] ?? EMBED_COLORS.primary,
    imageUrl: a.imageUrl ?? undefined,
    footer: opts.footer,
    timestamp: opts.now,
  });
  return {
    ...(mentions.content ? { content: mentions.content } : {}),
    embeds: [embed],
    allowed_mentions: mentions.allowed_mentions,
  };
}

/** Human warning for the second confirmation step (null when nobody is pinged). */
export function mentionWarning(
  mode: MentionMode,
  roleId: string | null,
  counts: { memberCount?: number | null; roleMemberCount?: number | null } = {},
): string | null {
  const n = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString('en-US') : null);
  switch (mode) {
    case 'EVERYONE':
      return n(counts.memberCount)
        ? `This will ping @everyone and notify about ${n(counts.memberCount)} members.`
        : 'This will ping @everyone and notify every member of the server.';
    case 'HERE':
      return n(counts.memberCount)
        ? `This will ping @here and notify every online member (up to ${n(counts.memberCount)} members).`
        : 'This will ping @here and notify every online member.';
    case 'ROLE':
      return n(counts.roleMemberCount)
        ? `This will ping <@&${roleId}> and notify ${n(counts.roleMemberCount)} members.`
        : `This will ping <@&${roleId}> and notify everyone with that role.`;
    default:
      return null;
  }
}

/**
 * Parse "YYYY-MM-DD HH:MM" as wall-clock time in `tz` and return the UTC instant.
 * Rejects impossible dates (e.g. 2026-02-30) and non-existent DST gap times.
 */
export function parseScheduleInput(input: string, tz: string): Date {
  if (!isValidTimeZone(tz))
    throw validation(`Unknown time zone "${tz}". Use an IANA name like Europe/London.`);
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})\s*$/.exec(input);
  if (!m) throw validation('Use the format YYYY-MM-DD HH:MM, e.g. 2026-11-05 18:30.');
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || hour > 23 || minute > 59)
    throw validation('That date or time is not valid.');
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) throw validation('That date does not exist.');
  const utc = zonedToUtc(year, month, day, hour, minute, tz);
  // Round-trip check: wall times inside a DST gap don't exist.
  const back = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .formatToParts(utc)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  if (Number(back.hour) !== hour || Number(back.minute) !== minute || Number(back.day) !== day) {
    throw validation(
      'That time does not exist in this time zone (daylight-saving change). Pick another time.',
    );
  }
  return utc;
}
