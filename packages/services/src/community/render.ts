import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord-api-types/v10';
import type { FaqCategory, FaqEntry, Guide, SelfAssignableRole, WelcomeConfig } from '@gynx/database';
import { EMBED_COLORS, discordTimestamp, neutraliseMentions, truncate } from '@gynx/shared';
import { brandEmbed } from '../core/render';
import { parseLinks } from './schemas';
import type { OffsetPage } from './schemas';
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

export const GROUP_LABELS: Record<string, string> = {
  games: 'Games',
  community: 'Community',
  notifications: 'Notifications',
};

export function supportLine(supportUrl: string | null | undefined): string {
  return supportUrl
    ? `Still stuck? Reach the support team: ${supportUrl}`
    : 'Still stuck? Contact the support team.';
}

// ── Welcome / rules ──────────────────────────────────────────────────────────

export function welcomeEmbed(
  w: WelcomeConfig,
  vars: { userId: string; serverName: string; requiresVerification: boolean },
): APIEmbed {
  const steps = [
    w.requireRulesAck || vars.requiresVerification ? '• Read the rules with `/rules`' : null,
    vars.requiresVerification ? '• Press **Verify** below to unlock the server' : null,
    '• Pick your games and notifications with `/roles`',
    '• Find quick answers with `/faq`',
  ].filter(Boolean);
  return brandEmbed({
    title: w.title,
    description: `${renderWelcomeMessage(w.message, vars)}\n\n${steps.join('\n')}`,
    fields: [
      ...(w.docsUrl ? [{ name: 'Docs', value: w.docsUrl, inline: true }] : []),
      ...(w.supportUrl ? [{ name: 'Support', value: w.supportUrl, inline: true }] : []),
    ],
  });
}

export function welcomeDmEmbed(
  w: WelcomeConfig,
  opts: { serverName: string; supportUrl: string | null; requiresVerification: boolean },
): APIEmbed {
  return brandEmbed({
    title: `Welcome to ${truncate(neutraliseMentions(opts.serverName), 200)}`,
    description: [
      'Here is how to get started:',
      opts.requiresVerification
        ? '1. Open the server and press **Verify** in the welcome channel (or run `/rules`).'
        : '1. Read the rules with `/rules`.',
      '2. Choose your games and notification roles with `/roles`.',
      '3. Browse quick answers with `/faq` and guides with `/guides`.',
      '',
      'GYNX staff will never ask for your password or payment details in DMs.',
    ].join('\n'),
    fields: [
      ...(w.docsUrl ? [{ name: 'Docs', value: w.docsUrl, inline: true }] : []),
      { name: 'Support', value: opts.supportUrl ?? 'Contact the support team in the server.', inline: true },
    ],
  });
}

export function rulesEmbed(
  w: WelcomeConfig,
  status?: { rulesAccepted: boolean; verified: boolean; requiresVerification: boolean },
): APIEmbed {
  const notes: string[] = [];
  if (status?.rulesAccepted) notes.push('✅ You have accepted the rules.');
  else if (w.requireRulesAck) notes.push('Please press **I accept** to confirm you have read the rules.');
  if (status?.requiresVerification && !status.verified) notes.push('Press **Verify** to finish onboarding.');
  return brandEmbed({
    title: 'Server rules',
    description: `${truncate(w.rulesText, 3800)}${notes.length ? `\n\n${notes.join('\n')}` : ''}`,
  });
}

export function onboardingButtons(opts: { showAccept: boolean; showVerify: boolean }): Row[] {
  const buttons: APIComponentInMessageActionRow[] = [];
  if (opts.showAccept)
    buttons.push({ type: BUTTON, style: SUCCESS, label: 'I accept', custom_id: CID.rulesAccept });
  if (opts.showVerify) buttons.push({ type: BUTTON, style: PRIMARY, label: 'Verify', custom_id: CID.verify });
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
          placeholder: 'Which games do you play?',
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
          placeholder: `${GROUP_LABELS[group] ?? group}: pick roles to add or remove`,
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
    title: 'Self-assignable roles',
    description: roles.length
      ? 'Select a role to toggle it: roles you have are removed, others are added.'
      : 'No self-assignable roles are configured yet.',
    fields: [...byGroup.entries()].map(([g, lines]) => ({
      name: GROUP_LABELS[g] ?? g,
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
              name: 'Links',
              value: links.map((l) => `[${l.label.replace(/[[\]]/g, '')}](${l.url})`).join('\n'),
            },
          ]
        : []),
      { name: 'Need more help?', value: supportLine(supportUrl) },
    ],
    footer: entry.category ? `FAQ · ${entry.category.name}` : 'FAQ',
  });
}

export function faqAnswerButtons(entryId: string, supportUrl: string | null): Row[] {
  const buttons: APIComponentInMessageActionRow[] = [
    {
      type: BUTTON,
      style: SECONDARY,
      label: 'Helpful',
      emoji: { name: '👍' },
      custom_id: CID.faqFeedback(entryId, true),
    },
    {
      type: BUTTON,
      style: SECONDARY,
      label: 'Not helpful',
      emoji: { name: '👎' },
      custom_id: CID.faqFeedback(entryId, false),
    },
  ];
  if (supportUrl) buttons.push({ type: BUTTON, style: LINK, label: 'Contact support', url: supportUrl });
  return [{ type: 1, components: buttons }];
}

export function faqOverviewEmbed(
  categories: ReadonlyArray<FaqCategory & { publishedCount: number }>,
  mostViewed: readonly FaqEntry[],
): APIEmbed {
  return brandEmbed({
    title: 'Frequently asked questions',
    description: 'Use `/faq query:<words>` to search, or pick a popular question below.',
    fields: [
      {
        name: 'Categories',
        value: categories.length
          ? categories.map((c) => `• **${c.name}** (${c.publishedCount})`).join('\n')
          : 'No categories yet.',
      },
      {
        name: 'Most viewed',
        value: mostViewed.length
          ? mostViewed.map((e, n) => `${n + 1}. ${truncate(e.question, 120)}`).join('\n')
          : 'No published FAQs yet.',
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
          placeholder: 'Open a question',
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
    filters.category && `category **${filters.category}**`,
    filters.game && `game **${filters.game}**`,
  ]
    .filter(Boolean)
    .join(', ');
  return brandEmbed({
    title: 'Guides',
    description: page.total
      ? `${filterText ? `Filtered by ${filterText}. ` : ''}Showing ${page.items.length} of ${page.total}.`
      : `No published guides${filterText ? ` match ${filterText}` : ' yet'}.`,
    fields: page.items.map((g) => ({
      name: truncate(`${g.title}${g.game ? ` · ${g.game}` : ''}`, 256),
      value: `${truncate(g.summary, 300)}\n${g.url}`,
    })),
    footer: `Page ${page.page} of ${page.pageCount}`,
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
        { type: BUTTON, style: SECONDARY, label: 'Previous', custom_id: prev, disabled: page.page <= 1 },
        {
          type: BUTTON,
          style: SECONDARY,
          label: 'Next',
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
    title: 'Possible raid detected',
    color: EMBED_COLORS.warning,
    description: `**${p.joinsInWindow}** members joined within ${p.windowSeconds}s (threshold ${p.threshold}).`,
    fields: [
      { name: 'Detected', value: discordTimestamp(new Date(p.detectedAt), 'R'), inline: true },
      { name: 'Flagged joiners', value: String(flaggedSoFar), inline: true },
      {
        name: 'Automatic action',
        value:
          p.action === 'REQUIRE_VERIFICATION'
            ? 'New joiners in this window must pass verification. Nobody was kicked or banned.'
            : 'Alert only. Nobody was kicked or banned.',
      },
    ],
    footer: 'Review recent joins in the dashboard before taking action.',
  });
}
