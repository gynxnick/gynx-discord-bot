import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { ModerationAction, ModerationAppeal, ModerationType } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, formatDuration, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { ACTION_LABELS } from './actions';
import { AUTOMOD_MODERATOR_ID, SYSTEM_MODERATOR_ID } from './common';

const TYPE_COLOR: Record<ModerationType, number> = {
  WARN: EMBED_COLORS.warning,
  TIMEOUT: EMBED_COLORS.warning,
  UNTIMEOUT: EMBED_COLORS.success,
  KICK: EMBED_COLORS.danger,
  BAN: EMBED_COLORS.danger,
  UNBAN: EMBED_COLORS.success,
  MESSAGE_DELETE: EMBED_COLORS.neutral,
};

export const moderatorLabel = (id: string) =>
  id === AUTOMOD_MODERATOR_ID ? 'Automod' : id === SYSTEM_MODERATOR_ID ? 'GYNX System' : `<@${id}> (\`${id}\`)`;

/** Staff modlog entry. Never includes the restricted moderator note. */
export function modlogEmbed(a: ModerationAction): APIEmbed {
  const fields = [
    { name: 'Target', value: `<@${a.targetId}> (\`${a.targetId}\`)`, inline: true },
    { name: 'Moderator', value: moderatorLabel(a.moderatorId), inline: true },
    { name: 'Reason', value: truncate(neutraliseMentions(a.reason), 1000), inline: false },
  ];
  if (a.durationSeconds) {
    fields.push({ name: 'Duration', value: formatDuration(a.durationSeconds * 1000), inline: true });
    if (a.expiresAt) fields.push({ name: 'Expires', value: discordTimestamp(a.expiresAt, 'R'), inline: true });
  } else if (a.type === 'BAN') {
    fields.push({ name: 'Duration', value: 'Permanent', inline: true });
  }
  if (a.status === 'FAILED') fields.push({ name: 'Status', value: `Failed: ${truncate(a.failureReason ?? 'unknown error', 200)}`, inline: false });
  if (a.type !== 'UNBAN' && a.type !== 'UNTIMEOUT') fields.push({ name: 'DM delivered', value: a.dmSent ? 'Yes' : 'No', inline: true });
  return brandEmbed({
    title: `${a.ref} · ${ACTION_LABELS[a.type]}${a.status === 'FAILED' ? ' (failed)' : ''}`,
    color: a.status === 'FAILED' ? EMBED_COLORS.neutral : TYPE_COLOR[a.type],
    fields,
    timestamp: a.createdAt,
  });
}

export interface ActionDmInput {
  type: ModerationType;
  reason: string;
  durationMs: number | null;
  guildName: string;
  supportUrl: string | null;
}

/** DM to the target. Bans/kicks point to the external support system because /appeal needs guild access. */
export function actionDmEmbed(i: ActionDmInput): APIEmbed {
  const verb: Partial<Record<ModerationType, string>> = {
    WARN: 'You received a warning',
    TIMEOUT: 'You have been timed out',
    KICK: 'You have been removed',
    BAN: 'You have been banned',
  };
  const lines = [`**Reason:** ${truncate(neutraliseMentions(i.reason), 800)}`];
  if (i.durationMs) lines.push(`**Duration:** ${formatDuration(i.durationMs)}`);
  else if (i.type === 'BAN') lines.push('**Duration:** Permanent');
  const support = i.supportUrl ? `through our support system: ${i.supportUrl}` : 'by contacting the support team';
  if (i.type === 'BAN' || i.type === 'KICK') {
    lines.push('', `If you believe this was a mistake, you can appeal ${support}.`);
  } else {
    lines.push('', 'If you believe this was a mistake, use `/appeal` in the server and select this action.');
  }
  return brandEmbed({
    title: `${verb[i.type] ?? 'Moderation notice'} in ${truncate(i.guildName, 100)}`,
    description: lines.join('\n'),
    color: i.type === 'BAN' || i.type === 'KICK' ? EMBED_COLORS.danger : EMBED_COLORS.warning,
    footer: 'Please review the server rules.',
  });
}

export function appealStaffEmbed(appeal: ModerationAppeal, action: ModerationAction | null): APIEmbed {
  return brandEmbed({
    title: `New appeal${action ? ` · ${action.ref} (${ACTION_LABELS[action.type]})` : ''}`,
    description: truncate(neutraliseMentions(appeal.statement), 2000),
    color: EMBED_COLORS.accent,
    fields: [
      { name: 'Member', value: `<@${appeal.userId}> (\`${appeal.userId}\`)`, inline: true },
      { name: 'Submitted', value: discordTimestamp(appeal.createdAt, 'R'), inline: true },
      ...(action ? [{ name: 'Original reason', value: truncate(neutraliseMentions(action.reason), 500), inline: false }] : []),
    ],
    footer: action?.type === 'BAN' ? 'Ban appeals require ban permission to review.' : 'Review requires moderation permission.',
  });
}

export function appealReviewButtons(appealId: string): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Accept', custom_id: `modappeal:accept:${appealId}` },
        { type: 2, style: 4, label: 'Deny', custom_id: `modappeal:deny:${appealId}` },
      ],
    },
  ];
}

export function appealDecisionEmbed(appeal: ModerationAppeal, actionRef: string | null, guildName: string, supportUrl: string | null): APIEmbed {
  const accepted = appeal.status === 'ACCEPTED';
  const lines = [
    accepted
      ? `Your appeal${actionRef ? ` for ${actionRef}` : ''} has been **accepted**.`
      : `Your appeal${actionRef ? ` for ${actionRef}` : ''} has been **denied**.`,
  ];
  if (appeal.reviewNote) lines.push('', `**Note from staff:** ${truncate(neutraliseMentions(appeal.reviewNote), 800)}`);
  if (!accepted) lines.push('', supportUrl ? `If you have new information, you can contact support: ${supportUrl}` : 'If you have new information, please contact the support team.');
  return brandEmbed({
    title: `Appeal update · ${truncate(guildName, 100)}`,
    description: lines.join('\n'),
    color: accepted ? EMBED_COLORS.success : EMBED_COLORS.neutral,
  });
}
