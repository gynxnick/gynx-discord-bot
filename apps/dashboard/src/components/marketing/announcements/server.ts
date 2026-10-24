import 'server-only';
import type { Announcement } from '@gynx/database';
import { marketing } from '@gynx/services';
import { intToHex, type AnnouncementDraft } from './announcement-utils';

/** Type select options from the service's labels. */
export const announcementTypeOptions = (): Array<{ value: string; label: string }> =>
  marketing.ANNOUNCEMENT_TYPES.map((t) => ({ value: t, label: marketing.ANNOUNCEMENT_TYPE_LABELS[t] }));

/** Default embed colour per type, taken from the real renderer so the preview matches the post. */
export function announcementTypeColors(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const type of marketing.ANNOUNCEMENT_TYPES) {
    const body = marketing.renderAnnouncement({
      type,
      title: 'x',
      body: 'x',
      imageUrl: null,
      color: null,
      mention: 'NONE',
      mentionRoleId: null,
    });
    const hex = intToHex(body.embeds?.[0]?.color);
    if (hex) out[type] = hex;
  }
  return out;
}

/** DB row → editor state. */
export function toDraft(
  a: Pick<
    Announcement,
    'type' | 'title' | 'body' | 'imageUrl' | 'color' | 'channelId' | 'mention' | 'mentionRoleId'
  >,
): AnnouncementDraft {
  return {
    type: a.type,
    title: a.title,
    body: a.body,
    imageUrl: a.imageUrl ?? '',
    color: a.color ?? '',
    channelId: a.channelId,
    mention: a.mention,
    mentionRoleId: a.mentionRoleId ?? '',
  };
}
