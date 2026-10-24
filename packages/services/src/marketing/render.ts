import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { PartnerApplication } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { PARTNER_CATEGORY_LABELS, PARTNER_QUESTIONS } from './partners';

const answersOf = (app: PartnerApplication): Record<string, string> =>
  app.answers && typeof app.answers === 'object' && !Array.isArray(app.answers) ? (app.answers as Record<string, string>) : {};

/** Staff review-channel notification: the application answers only (no internal data). */
export function partnerApplicationEmbed(app: PartnerApplication): APIEmbed {
  const answers = answersOf(app);
  return brandEmbed({
    title: `Partner application ${app.ref} · ${PARTNER_CATEGORY_LABELS[app.category]}`,
    color: EMBED_COLORS.accent,
    fields: [
      { name: 'Applicant', value: `<@${app.applicantId}> (\`${app.applicantId}\`)`, inline: true },
      { name: 'Submitted', value: discordTimestamp(app.createdAt, 'R'), inline: true },
      ...PARTNER_QUESTIONS[app.category]
        .filter((q) => answers[q.id])
        .map((q) => ({ name: q.label, value: truncate(neutraliseMentions(String(answers[q.id])), 1000) })),
    ],
    footer: 'Review with /partners review-queue or the dashboard.',
  });
}

export function partnerStaffButtons(app: Pick<PartnerApplication, 'id'>, dashboardUrl?: string): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const buttons: APIComponentInMessageActionRow[] = [
    { type: 2, style: 2, label: 'Start review', custom_id: `partner:start:${app.id}` },
    { type: 2, style: 3, label: 'Approve', custom_id: `partner:approve:${app.id}` },
    { type: 2, style: 4, label: 'Reject', custom_id: `partner:reject:${app.id}` },
  ];
  if (dashboardUrl) buttons.push({ type: 2, style: 5, label: 'Open in dashboard', url: `${dashboardUrl}/partners/applications/${app.id}` });
  return [{ type: 1, components: buttons }];
}

/** DM to the applicant. Contains the decision note only — never internal notes. */
export function partnerDecisionEmbed(app: Pick<PartnerApplication, 'ref' | 'status' | 'decisionNote'>, supportUrl?: string | null): APIEmbed {
  const approved = app.status === 'APPROVED';
  return brandEmbed({
    title: approved ? `Your partner application ${app.ref} was approved` : `Update on your partner application ${app.ref}`,
    color: approved ? EMBED_COLORS.success : EMBED_COLORS.neutral,
    description: [
      approved
        ? 'Welcome aboard! The GYNX.GG team will be in touch about next steps.'
        : 'Thank you for your interest in partnering with GYNX.GG. We are unable to approve your application at this time.',
      app.decisionNote ? `\n**Note from the team:** ${truncate(neutraliseMentions(app.decisionNote), 1000)}` : '',
      supportUrl ? `\nQuestions? Contact the support team: ${supportUrl}` : '\nQuestions? Contact the support team.',
    ].join('\n'),
  });
}
