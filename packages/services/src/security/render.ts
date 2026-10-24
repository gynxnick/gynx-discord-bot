import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { AbuseReport } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { CATEGORY_LABELS } from './reports';

/** Private staff notification. Deliberately omits the reporter's identity. */
export function reportNotificationEmbed(r: AbuseReport): APIEmbed {
  return brandEmbed({
    title: `New report ${r.ref} · ${CATEGORY_LABELS[r.category]}`,
    color: EMBED_COLORS.warning,
    description: truncate(r.description, 1500),
    fields: [
      { name: 'Reported user', value: r.reportedUserId ? `<@${r.reportedUserId}> (\`${r.reportedUserId}\`)` : 'Not specified', inline: true },
      { name: 'Submitted', value: discordTimestamp(r.createdAt, 'R'), inline: true },
      { name: 'Evidence', value: r.evidenceUrls.length ? r.evidenceUrls.map((u) => `<${u}>`).join('\n') : 'None', inline: false },
      ...(r.messageLink ? [{ name: 'Message', value: r.messageLink, inline: false }] : []),
    ],
    footer: 'Reports are private. Do not act on a report without investigating it.',
  });
}

export function reportStaffButtons(r: AbuseReport, dashboardUrl?: string): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const buttons: APIComponentInMessageActionRow[] = [{ type: 2, style: 1, label: 'Claim', custom_id: `secreport:claim:${r.id}` }];
  if (dashboardUrl) buttons.push({ type: 2, style: 5, label: 'Open in dashboard', url: `${dashboardUrl}/security/reports/${r.id}` });
  return [{ type: 1, components: buttons }];
}

export function reporterUpdateEmbed(r: AbuseReport): APIEmbed {
  return brandEmbed({
    title: `Your report ${r.ref} has been reviewed`,
    description:
      r.status === 'RESOLVED'
        ? 'Thanks for letting us know. Our team has reviewed your report and taken appropriate action.'
        : 'Thanks for letting us know. Our team reviewed your report and closed it. If you have new information, you can submit another report.',
    footer: 'For privacy reasons we do not share the details of actions taken against other members.',
  });
}
