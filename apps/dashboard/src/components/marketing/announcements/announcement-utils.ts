/** Pure helpers for the announcement editor and pages (no React; unit tested). */

import { httpsProblem } from '../../community/form-utils';

export type AnnouncementStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
export type MentionMode = 'NONE' | 'HERE' | 'EVERYONE' | 'ROLE';

export const ANNOUNCEMENT_STATUSES: readonly AnnouncementStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
];

export const STATUS_LABELS: Record<AnnouncementStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  PUBLISHING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONES: Record<
  AnnouncementStatus,
  'neutral' | 'accent' | 'success' | 'warning' | 'danger'
> = {
  DRAFT: 'neutral',
  SCHEDULED: 'accent',
  PUBLISHING: 'accent',
  PUBLISHED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

export const MENTION_OPTIONS: ReadonlyArray<{ value: MentionMode; label: string }> = [
  { value: 'NONE', label: 'No mention' },
  { value: 'HERE', label: '@here (online members)' },
  { value: 'EVERYONE', label: '@everyone (all members)' },
  { value: 'ROLE', label: 'A role' },
];

const EDITABLE: readonly AnnouncementStatus[] = ['DRAFT', 'SCHEDULED', 'FAILED', 'CANCELLED'];
const DELETABLE: readonly AnnouncementStatus[] = ['DRAFT', 'CANCELLED', 'FAILED'];

export const isEditable = (s: AnnouncementStatus) => EDITABLE.includes(s);
/** Publishable / schedulable states (same as the service's queueable set). */
export const isQueueable = (s: AnnouncementStatus) => EDITABLE.includes(s);
export const isDeletable = (s: AnnouncementStatus) => DELETABLE.includes(s);
export const isCancellable = (s: AnnouncementStatus) => s === 'SCHEDULED';

export interface AnnouncementDraft {
  type: string;
  title: string;
  body: string;
  imageUrl: string;
  color: string;
  channelId: string;
  mention: MentionMode;
  mentionRoleId: string;
}

export const emptyDraft = (channelId = ''): AnnouncementDraft => ({
  type: 'GENERAL',
  title: '',
  body: '',
  imageUrl: '',
  color: '',
  channelId,
  mention: 'NONE',
  mentionRoleId: '',
});

/** Normalise a hex colour input ("22d3ee" / "#22D3EE") to "#22D3EE"; null when blank or invalid. */
export function normalizeHex(v: string): string | null {
  const t = v.trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(t)) return null;
  return (t.startsWith('#') ? t : `#${t}`).toUpperCase();
}

/** Editor state → API body (create/update). Blank image/colour become null; the role only applies to ROLE mentions. */
export function draftToPayload(d: AnnouncementDraft) {
  return {
    type: d.type,
    title: d.title.trim(),
    body: d.body.trim(),
    imageUrl: d.imageUrl.trim() ? d.imageUrl.trim() : null,
    color: d.color.trim() ? (normalizeHex(d.color) ?? d.color.trim()) : null,
    channelId: d.channelId.trim(),
    mention: d.mention,
    mentionRoleId: d.mention === 'ROLE' && d.mentionRoleId ? d.mentionRoleId : null,
  };
}

/** True when the editor has changes that are not saved yet. */
export function isDirty(current: AnnouncementDraft, saved: AnnouncementDraft | null): boolean {
  if (!saved) return true;
  return JSON.stringify(draftToPayload(current)) !== JSON.stringify(draftToPayload(saved));
}

/** Client-side checks mirroring the service rules (the server re-validates). Keys match API issue paths. */
export function validateDraft(d: AnnouncementDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!d.title.trim()) errs.title = 'Add a title.';
  else if (d.title.trim().length > 256) errs.title = 'At most 256 characters.';
  if (!d.body.trim()) errs.body = 'Write the announcement text.';
  else if (d.body.trim().length > 4000) errs.body = 'At most 4,000 characters.';
  if (d.imageUrl.trim()) {
    const p = httpsProblem(d.imageUrl);
    if (p) errs.imageUrl = p;
  }
  if (d.color.trim() && !normalizeHex(d.color)) errs.color = 'Use a hex colour like #22D3EE.';
  if (!d.channelId.trim()) errs.channelId = 'Choose a channel.';
  if (d.mention === 'ROLE' && !d.mentionRoleId) errs.mentionRoleId = 'Choose a role to mention.';
  return errs;
}

/** Message content line for the preview (mention prefix only; the text lives in the embed). */
export function mentionContent(mode: MentionMode, roleId: string | null | undefined): string | null {
  switch (mode) {
    case 'EVERYONE':
      return '@everyone';
    case 'HERE':
      return '@here';
    case 'ROLE':
      return roleId ? `<@&${roleId}>` : '@role';
    default:
      return null;
  }
}

/** Replace `<@&id>` in a service warning with "@RoleName" (or "the selected role" when unknown). */
export function humanizeMentions(text: string, roleName: (id: string) => string | undefined): string {
  return text.replace(/<@&(\d{17,20})>/g, (_, id: string) => {
    const n = roleName(id);
    return n ? `@${n}` : 'the selected role';
  });
}

/** Link to a posted Discord message, or null when the delivery has no message ID. */
export function discordMessageUrl(
  guildId: string,
  channelId: string,
  messageId: string | null | undefined,
): string | null {
  if (
    !messageId ||
    !/^\d{17,20}$/.test(guildId) ||
    !/^\d{17,20}$/.test(channelId) ||
    !/^\d{17,20}$/.test(messageId)
  )
    return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Embed colour shown in the preview: explicit valid colour, otherwise the type's default. */
export function previewColor(
  color: string,
  type: string,
  typeColors: Record<string, string>,
  fallback = '#22D3EE',
): string {
  return normalizeHex(color) ?? typeColors[type] ?? fallback;
}

/** "#RRGGBB" from an embed colour integer. */
export const intToHex = (n: number | null | undefined): string | null =>
  typeof n === 'number' && Number.isFinite(n)
    ? `#${Math.max(0, Math.min(0xffffff, Math.floor(n)))
        .toString(16)
        .padStart(6, '0')
        .toUpperCase()}`
    : null;
