import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { PartnerApplication } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { PARTNER_QUESTIONS, partnerCategoryLabel, partnerQuestionLabel } from './partners';
import { MarketingText as T } from './texts';

const answersOf = (app: PartnerApplication): Record<string, string> =>
  app.answers && typeof app.answers === 'object' && !Array.isArray(app.answers)
    ? (app.answers as Record<string, string>)
    : {};

/** Staff review-channel notification: the application answers only (no internal data). */
export function partnerApplicationEmbed(app: PartnerApplication): APIEmbed {
  const answers = answersOf(app);
  return brandEmbed({
    title: T.reviewEmbedTitle({ ref: app.ref, category: partnerCategoryLabel(app.category) }),
    color: EMBED_COLORS.accent,
    fields: [
      { name: T.reviewApplicant(), value: `<@${app.applicantId}> (\`${app.applicantId}\`)`, inline: true },
      { name: T.reviewSubmitted(), value: discordTimestamp(app.createdAt, 'R'), inline: true },
      ...PARTNER_QUESTIONS[app.category]
        .filter((q) => answers[q.id])
        .map((q) => ({
          name: partnerQuestionLabel(q),
          value: truncate(neutraliseMentions(String(answers[q.id])), 1000),
        })),
    ],
    footer: T.reviewFooter(),
  });
}

export function partnerStaffButtons(
  app: Pick<PartnerApplication, 'id'>,
  dashboardUrl?: string,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const buttons: APIComponentInMessageActionRow[] = [
    { type: 2, style: 2, label: T.btnStartReview(), custom_id: `partner:start:${app.id}` },
    { type: 2, style: 3, label: T.btnApprove(), custom_id: `partner:approve:${app.id}` },
    { type: 2, style: 4, label: T.btnReject(), custom_id: `partner:reject:${app.id}` },
  ];
  if (dashboardUrl)
    buttons.push({
      type: 2,
      style: 5,
      label: T.btnOpenDashboard(),
      url: `${dashboardUrl}/partners/applications/${app.id}`,
    });
  return [{ type: 1, components: buttons }];
}

/** DM to the applicant. Contains the decision note only — never internal notes. */
export function partnerDecisionEmbed(
  app: Pick<PartnerApplication, 'ref' | 'status' | 'decisionNote'>,
  supportUrl?: string | null,
): APIEmbed {
  const approved = app.status === 'APPROVED';
  return brandEmbed({
    title: approved ? T.decisionApprovedTitle({ ref: app.ref }) : T.decisionUpdateTitle({ ref: app.ref }),
    color: approved ? EMBED_COLORS.success : EMBED_COLORS.neutral,
    description: [
      approved ? T.decisionApprovedBody() : T.decisionRejectedBody(),
      app.decisionNote
        ? `\n${T.decisionNote({ note: truncate(neutraliseMentions(app.decisionNote), 1000) })}`
        : '',
      supportUrl ? `\n${T.decisionContactUrl({ url: supportUrl })}` : `\n${T.decisionContact()}`,
    ].join('\n'),
  });
}
