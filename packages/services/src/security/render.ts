import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { AbuseReport } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { reportCategoryLabel } from './reports';
import { SecurityText as T } from './texts';

/** Private staff notification. Deliberately omits the reporter's identity. */
export function reportNotificationEmbed(r: AbuseReport): APIEmbed {
  return brandEmbed({
    title: T.notifyTitle({ ref: r.ref, category: reportCategoryLabel(r.category) }),
    color: EMBED_COLORS.warning,
    description: truncate(r.description, 1500),
    fields: [
      {
        name: T.notifyReportedUserField(),
        value: r.reportedUserId
          ? `<@${r.reportedUserId}> (\`${r.reportedUserId}\`)`
          : T.notifyReportedUserNone(),
        inline: true,
      },
      { name: T.notifySubmittedField(), value: discordTimestamp(r.createdAt, 'R'), inline: true },
      {
        name: T.notifyEvidenceField(),
        value: r.evidenceUrls.length
          ? r.evidenceUrls.map((u) => `<${u}>`).join('\n')
          : T.notifyEvidenceNone(),
        inline: false,
      },
      ...(r.messageLink ? [{ name: T.notifyMessageField(), value: r.messageLink, inline: false }] : []),
    ],
    footer: T.notifyFooter(),
  });
}

export function reportStaffButtons(
  r: AbuseReport,
  dashboardUrl?: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const buttons: APIComponentInMessageActionRow[] = [
    { type: 2, style: 1, label: T.claimButton(), custom_id: `secreport:claim:${r.id}` },
  ];
  if (dashboardUrl)
    buttons.push({
      type: 2,
      style: 5,
      label: T.openDashboardButton(),
      url: `${dashboardUrl}/security/reports/${r.id}`,
    });
  return [{ type: 1, components: buttons }];
}

export function reporterUpdateEmbed(r: AbuseReport): APIEmbed {
  return brandEmbed({
    title: T.reporterUpdateTitle({ ref: r.ref }),
    description: r.status === 'RESOLVED' ? T.reporterUpdateResolved() : T.reporterUpdateDismissed(),
    footer: T.reporterUpdateFooter(),
  });
}
