import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { FaqCategory, FaqEntry, Guide, SelfAssignableRole, WelcomeConfig } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { parseLinks } from './schemas';
import type { OffsetPage } from './schemas';
import { CommunityText as T, groupLabel } from './texts';
import { renderWelcomeMessage } from './welcome';

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

const BUTTON = 2;
const STRING_SELECT = 3;
const PRIMARY = 1;
const SECONDARY = 2;
const SUCCESS = 3;
const LINK = 5;

/** Component customIds (prefixes are unique to this module). */
export const CID = {
  faqFeedback: (id: string, helpful: boolean) => `faq:fb:${id}:${helpful ? 'y' : 'n'}`,
  faqOpen: 'faq:open',
  guidesPage: (page: number, category?: string | null, game?: string | null) =>
    `guides:page:${page}:${encodeArg(category)}:${encodeArg(game)}`,
  rulesAccept: 'onboard:rules',
  verify: 'onboard:verify',
  interests: 'onboard:interests',
  selfRoleToggle: (group: string) => `selfrole:toggle:${group}`,
} as const;

/** Escape ':' and '%' so free-text filters survive a customId round trip; '-' means "none". */
export function encodeArg(v?: string | null): string {
  return v ? v.replace(/%/g, '%25').replace(/:/g, '%3A') : '-';
}
export function decodeArg(v?: string): string | undefined {
  if (!v || v === '-') return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return undefined;
  }
}

/** Default (English) group names, for statically registered slash command choices. Messages use `groupLabel`. */
export const GROUP_LABELS: Record<string, string> = {
  games: 'Games',
  community: 'Community',
  notifications: 'Notifications',
};

export function supportLine(supportUrl: string | null | undefined): string {
  return supportUrl ? T.supportLineWithUrl({ url: supportUrl }) : T.supportLine();
}

// ── Welcome / rules ──────────────────────────────────────────────────────────

export function welcomeEmbed(
  w: WelcomeConfig,
  vars: { userId: string; serverName: string; requiresVerification: boolean },
): APIEmbed {
  const steps = [
    w.requireRulesAck || vars.requiresVerification ? T.welcomeStepRules() : null,
    vars.requiresVerification ? T.welcomeStepVerify() : null,
    T.welcomeStepRoles(),
    T.welcomeStepFaq(),
  ].filter(Boolean);
  return brandEmbed({
    title: w.title,
    description: `${renderWelcomeMessage(w.message, vars)}\n\n${steps.join('\n')}`,
    fields: [
      ...(w.docsUrl ? [{ name: T.fieldDocs(), value: w.docsUrl, inline: true }] : []),
      ...(w.supportUrl ? [{ name: T.fieldSupport(), value: w.supportUrl, inline: true }] : []),
    ],
  });
}

export function welcomeDmEmbed(
  w: WelcomeConfig,
  opts: { serverName: string; supportUrl: string | null; requiresVerification: boolean },
): APIEmbed {
  return brandEmbed({
    title: truncate(T.welcomeDmTitle({ server: truncate(neutraliseMentions(opts.serverName), 200) }), 256),
    description: [
      T.welcomeDmIntro(),
      opts.requiresVerification ? T.welcomeDmStepVerify() : T.welcomeDmStepRules(),
      T.welcomeDmStepRoles(),
      T.welcomeDmStepFaq(),
      '',
      T.welcomeDmSafety(),
    ].join('\n'),
    fields: [
      ...(w.docsUrl ? [{ name: T.fieldDocs(), value: w.docsUrl, inline: true }] : []),
      { name: T.fieldSupport(), value: opts.supportUrl ?? T.welcomeDmSupportFallback(), inline: true },
    ],
  });
}

export function rulesEmbed(
  w: WelcomeConfig,
  status?: { rulesAccepted: boolean; verified: boolean; requiresVerification: boolean },
): APIEmbed {
  const notes: string[] = [];
  if (status?.rulesAccepted) notes.push(T.rulesAcceptedNote());
  else if (w.requireRulesAck) notes.push(T.rulesAckNote());
  if (status?.requiresVerification && !status.verified) notes.push(T.rulesVerifyNote());
  return brandEmbed({
    title: T.rulesTitle(),
    description: `${truncate(w.rulesText, 3800)}${notes.length ? `\n\n${notes.join('\n')}` : ''}`,
  });
}

export function onboardingButtons(opts: { showAccept: boolean; showVerify: boolean }): Row[] {
  const buttons: APIComponentInMessageActionRow[] = [];
  if (opts.showAccept)
    buttons.push({ type: BUTTON, style: SUCCESS, label: T.acceptButton(), custom_id: CID.rulesAccept });
  if (opts.showVerify)
    buttons.push({ type: BUTTON, style: PRIMARY, label: T.verifyButton(), custom_id: CID.verify });
  return buttons.length ? [{ type: 1, components: buttons }] : [];
}

/** Single-select of game roles for the interests step (set semantics). */
export function interestsSelect(games: readonly SelfAssignableRole[], current: readonly string[]): Row[] {
  if (games.length === 0) return [];
  const opts = games.slice(0, 25);
  return [
    {
      type: 1,
      components: [
        {
          type: STRING_SELECT,
          custom_id: CID.interests,
          placeholder: T.interestsPlaceholder(),
          min_values: 0,
          max_values: opts.length,
          options: opts.map((g) => ({
            label: truncate(g.label, 100),
            value: g.roleId,
            description: g.description ? truncate(g.description, 100) : undefined,
            default: current.includes(g.roleId),
          })),
        },
      ],
    },
  ];
}

/** One select per group (max 5 rows, 25 options each). Selecting an option toggles that role. */
export function selfRoleSelects(roles: readonly SelfAssignableRole[]): Row[] {
  const byGroup = new Map<string, SelfAssignableRole[]>();
  for (const r of roles) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  return [...byGroup.entries()].slice(0, 5).map(([group, list]) => {
    const opts = list.slice(0, 25);
    return {
      type: 1,
      components: [
        {
          type: STRING_SELECT,
          custom_id: CID.selfRoleToggle(group),
          placeholder: truncate(T.selfRolePlaceholder({ group: groupLabel(group) }), 100),
          min_values: 1,
          max_values: opts.length,
          options: opts.map((r) => ({
            label: truncate(r.label, 100),
            value: r.roleId,
            description: r.description ? truncate(r.description, 100) : undefined,
          })),
        },
      ],
    };
  });
}

export function selfRolesEmbed(
  roles: readonly SelfAssignableRole[],
  memberRoleIds: readonly string[],
): APIEmbed {
  const byGroup = new Map<string, string[]>();
  for (const r of roles) {
    const line = `${memberRoleIds.includes(r.roleId) ? '✅' : '▫️'} ${r.emoji ? `${r.emoji} ` : ''}**${r.label}**${r.description ? ` · ${r.description}` : ''}`;
    byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), line]);
  }
  return brandEmbed({
    title: T.selfRolesTitle(),
    description: roles.length ? T.selfRolesDescription() : T.selfRolesEmpty(),
    fields: [...byGroup.entries()].map(([g, lines]) => ({
      name: groupLabel(g),
      value: lines.join('\n'),
    })),
  });
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

export function faqAnswerEmbed(
  entry: FaqEntry & { category?: FaqCategory | null },
  supportUrl: string | null,
): APIEmbed {
  const links = parseLinks(entry.links);
  return brandEmbed({
    title: entry.question,
    description: truncate(entry.answer, 3900),
    fields: [
      ...(links.length
        ? [
            {
              name: T.faqLinksField(),
              value: links.map((l) => `[${l.label.replace(/[[\]]/g, '')}](${l.url})`).join('\n'),
            },
          ]
        : []),
      { name: T.faqMoreHelpField(), value: supportLine(supportUrl) },
    ],
    footer: entry.category ? T.faqFooterCategory({ category: entry.category.name }) : T.faqFooter(),
  });
}

export function faqAnswerButtons(entryId: string, supportUrl: string | null): Row[] {
  const buttons: APIComponentInMessageActionRow[] = [
    {
      type: BUTTON,
      style: SECONDARY,
      label: T.faqHelpfulButton(),
      emoji: { name: '👍' },
      custom_id: CID.faqFeedback(entryId, true),
    },
    {
      type: BUTTON,
      style: SECONDARY,
      label: T.faqNotHelpfulButton(),
      emoji: { name: '👎' },
      custom_id: CID.faqFeedback(entryId, false),
    },
  ];
  if (supportUrl)
    buttons.push({ type: BUTTON, style: LINK, label: T.faqContactSupportButton(), url: supportUrl });
  return [{ type: 1, components: buttons }];
}

export function faqOverviewEmbed(
  categories: ReadonlyArray<FaqCategory & { publishedCount: number }>,
  mostViewed: readonly FaqEntry[],
): APIEmbed {
  return brandEmbed({
    title: T.faqOverviewTitle(),
    description: T.faqOverviewDescription(),
    fields: [
      {
        name: T.faqCategoriesField(),
        value: categories.length
          ? categories.map((c) => `• **${c.name}** (${c.publishedCount})`).join('\n')
          : T.faqNoCategories(),
      },
      {
        name: T.faqMostViewedField(),
        value: mostViewed.length
          ? mostViewed.map((e, n) => `${n + 1}. ${truncate(e.question, 120)}`).join('\n')
          : T.faqNoEntries(),
      },
    ],
  });
}

export function faqPickSelect(entries: readonly FaqEntry[]): Row[] {
  if (entries.length === 0) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: STRING_SELECT,
          custom_id: CID.faqOpen,
          placeholder: T.faqPickPlaceholder(),
          options: entries.slice(0, 25).map((e) => ({ label: truncate(e.question, 100), value: e.id })),
        },
      ],
    },
  ];
}

// ── Guides ───────────────────────────────────────────────────────────────────

export function guidesEmbed(
  page: OffsetPage<Guide>,
  filters: { category?: string; game?: string },
): APIEmbed {
  const filterText = [
    filters.category && T.guidesFilterCategory({ category: filters.category }),
    filters.game && T.guidesFilterGame({ game: filters.game }),
  ]
    .filter(Boolean)
    .join(', ');
  return brandEmbed({
    title: T.guidesTitle(),
    description: page.total
      ? [
          filterText ? T.guidesFilteredBy({ filters: filterText }) : '',
          T.guidesShowing({ shown: page.items.length, total: page.total }),
        ]
          .filter(Boolean)
          .join(' ')
      : filterText
        ? T.guidesNoneMatch({ filters: filterText })
        : T.guidesNoneYet(),
    fields: page.items.map((g) => ({
      name: truncate(`${g.title}${g.game ? ` · ${g.game}` : ''}`, 256),
      value: `${truncate(g.summary, 300)}\n${g.url}`,
    })),
    footer: T.guidesFooter({ page: page.page, pageCount: page.pageCount }),
  });
}

/** Prev/next buttons; returns no row when the customId would exceed Discord's 100-char limit. */
export function guidesPager(page: OffsetPage<unknown>, filters: { category?: string; game?: string }): Row[] {
  if (page.pageCount <= 1) return [];
  const prev = CID.guidesPage(page.page - 1, filters.category, filters.game);
  const next = CID.guidesPage(page.page + 1, filters.category, filters.game);
  if (next.length > 100) return [];
  return [
    {
      type: 1,
      components: [
        {
          type: BUTTON,
          style: SECONDARY,
          label: T.guidesPrevButton(),
          custom_id: prev,
          disabled: page.page <= 1,
        },
        {
          type: BUTTON,
          style: SECONDARY,
          label: T.guidesNextButton(),
          custom_id: next,
          disabled: page.page >= page.pageCount,
        },
      ],
    },
  ];
}

// ── Raid alert (worker) ──────────────────────────────────────────────────────

export interface RaidAlertPayload {
  detectedAt: string;
  windowStart: string;
  windowSeconds: number;
  threshold: number;
  joinsInWindow: number;
  action: 'ALERT' | 'REQUIRE_VERIFICATION';
}

/** Staff alert. Deliberately contains counts only — no member lists. */
export function raidAlertEmbed(p: RaidAlertPayload, flaggedSoFar: number): APIEmbed {
  return brandEmbed({
    title: T.raidAlertTitle(),
    color: EMBED_COLORS.warning,
    description: T.raidAlertDescription({
      joins: p.joinsInWindow,
      seconds: p.windowSeconds,
      threshold: p.threshold,
    }),
    fields: [
      { name: T.raidDetectedField(), value: discordTimestamp(new Date(p.detectedAt), 'R'), inline: true },
      { name: T.raidFlaggedField(), value: String(flaggedSoFar), inline: true },
      {
        name: T.raidActionField(),
        value: p.action === 'REQUIRE_VERIFICATION' ? T.raidActionVerify() : T.raidActionAlert(),
      },
    ],
    footer: T.raidAlertFooter(),
  });
}
