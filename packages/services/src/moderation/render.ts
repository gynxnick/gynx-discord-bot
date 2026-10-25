import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { ModerationAction, ModerationAppeal, ModerationType } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, formatDuration, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { AUTOMOD_MODERATOR_ID, SYSTEM_MODERATOR_ID } from './common';
import { ModerationText as T, actionLabel } from './texts';

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
  id === AUTOMOD_MODERATOR_ID
    ? T.moderatorAutomod()
    : id === SYSTEM_MODERATOR_ID
      ? T.moderatorSystem()
      : `<@${id}> (\`${id}\`)`;

/** Staff modlog entry. Never includes the restricted moderator note. */
export function modlogEmbed(a: ModerationAction): APIEmbed {
  const fields = [
    { name: T.modlogFieldTarget(), value: `<@${a.targetId}> (\`${a.targetId}\`)`, inline: true },
    { name: T.modlogFieldModerator(), value: moderatorLabel(a.moderatorId), inline: true },
    { name: T.modlogFieldReason(), value: truncate(neutraliseMentions(a.reason), 1000), inline: false },
  ];
  if (a.durationSeconds) {
    fields.push({
      name: T.modlogFieldDuration(),
      value: formatDuration(a.durationSeconds * 1000),
      inline: true,
    });
    if (a.expiresAt)
      fields.push({ name: T.modlogFieldExpires(), value: discordTimestamp(a.expiresAt, 'R'), inline: true });
  } else if (a.type === 'BAN') {
    fields.push({ name: T.modlogFieldDuration(), value: T.durationPermanent(), inline: true });
  }
  if (a.status === 'FAILED')
    fields.push({
      name: T.modlogFieldStatus(),
      value: T.modlogStatusFailed({ error: truncate(a.failureReason ?? T.modlogUnknownError(), 200) }),
      inline: false,
    });
  if (a.type !== 'UNBAN' && a.type !== 'UNTIMEOUT')
    fields.push({
      name: T.modlogFieldDmDelivered(),
      value: a.dmSent ? T.modlogDmYes() : T.modlogDmNo(),
      inline: true,
    });
  return brandEmbed({
    title: (a.status === 'FAILED' ? T.modlogTitleFailed : T.modlogTitle)({
      ref: a.ref,
      action: actionLabel(a.type),
    }),
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
  const server = truncate(i.guildName, 100);
  const title =
    i.type === 'WARN'
      ? T.dmTitleWarn({ server })
      : i.type === 'TIMEOUT'
        ? T.dmTitleTimeout({ server })
        : i.type === 'KICK'
          ? T.dmTitleKick({ server })
          : i.type === 'BAN'
            ? T.dmTitleBan({ server })
            : T.dmTitleOther({ server });
  const lines = [T.dmReason({ reason: truncate(neutraliseMentions(i.reason), 800) })];
  if (i.durationMs) lines.push(T.dmDuration({ duration: formatDuration(i.durationMs) }));
  else if (i.type === 'BAN') lines.push(T.dmDuration({ duration: T.durationPermanent() }));
  if (i.type === 'BAN' || i.type === 'KICK') {
    lines.push('', i.supportUrl ? T.dmAppealSupportUrl({ url: i.supportUrl }) : T.dmAppealSupportTeam());
  } else {
    lines.push('', T.dmAppealCommand());
  }
  return brandEmbed({
    title,
    description: lines.join('\n'),
    color: i.type === 'BAN' || i.type === 'KICK' ? EMBED_COLORS.danger : EMBED_COLORS.warning,
    footer: T.dmFooter(),
  });
}

export function appealStaffEmbed(appeal: ModerationAppeal, action: ModerationAction | null): APIEmbed {
  return brandEmbed({
    title: action
      ? T.appealStaffTitleWithAction({ ref: action.ref, action: actionLabel(action.type) })
      : T.appealStaffTitle(),
    description: truncate(neutraliseMentions(appeal.statement), 2000),
    color: EMBED_COLORS.accent,
    fields: [
      { name: T.appealFieldMember(), value: `<@${appeal.userId}> (\`${appeal.userId}\`)`, inline: true },
      { name: T.appealFieldSubmitted(), value: discordTimestamp(appeal.createdAt, 'R'), inline: true },
      ...(action
        ? [
            {
              name: T.appealFieldOriginalReason(),
              value: truncate(neutraliseMentions(action.reason), 500),
              inline: false,
            },
          ]
        : []),
    ],
    footer: action?.type === 'BAN' ? T.appealFooterBan() : T.appealFooterDefault(),
  });
}

export function appealReviewButtons(
  appealId: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: T.appealAcceptButton(), custom_id: `modappeal:accept:${appealId}` },
        { type: 2, style: 4, label: T.appealDenyButton(), custom_id: `modappeal:deny:${appealId}` },
      ],
    },
  ];
}

export function appealDecisionEmbed(
  appeal: ModerationAppeal,
  actionRef: string | null,
  guildName: string,
  supportUrl: string | null,
): APIEmbed {
  const accepted = appeal.status === 'ACCEPTED';
  const lines = [
    accepted
      ? actionRef
        ? T.appealAcceptedFor({ ref: actionRef })
        : T.appealAccepted()
      : actionRef
        ? T.appealDeniedFor({ ref: actionRef })
        : T.appealDenied(),
  ];
  if (appeal.reviewNote)
    lines.push('', T.appealStaffNote({ note: truncate(neutraliseMentions(appeal.reviewNote), 800) }));
  if (!accepted) lines.push('', supportUrl ? T.appealNewInfoUrl({ url: supportUrl }) : T.appealNewInfoTeam());
  return brandEmbed({
    title: T.appealDecisionTitle({ server: truncate(guildName, 100) }),
    description: lines.join('\n'),
    color: accepted ? EMBED_COLORS.success : EMBED_COLORS.neutral,
  });
}
