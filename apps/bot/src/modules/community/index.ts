import { SlashCommandBuilder, type GuildMember, type Interaction } from 'discord.js';
import { brandEmbed, community, type Ctx } from '@gynx/services';
import { AppError, isAppError, truncate } from '@gynx/shared';
import { respond, replyInfo, replySuccess } from '../../framework/reply';
import type { BotModule, BotRuntime, ComponentHandler, SlashCommand } from '../../framework/types';
import { applyRoleChange, liveRoleContext, liveRolesContext } from './discord-roles';
import { helpEmbed } from './help';
import { communityListeners } from './listeners';

const GUIDE_PAGE_SIZE = 5;
const CUID = /^c[a-z0-9]{20,32}$/;

const memberFacts = (m: GuildMember): community.MemberFacts => ({
  joinedAt: m.joinedAt,
  accountCreatedAt: m.user.createdAt,
});

function requireMember(i: Interaction): GuildMember {
  if (!i.inCachedGuild()) throw new AppError('FORBIDDEN', 'This only works inside the server.');
  return i.member;
}

// ── /faq rendering ───────────────────────────────────────────────────────────

async function faqAnswerReply(ctx: Ctx, id: string) {
  const [entry, supportUrl] = await Promise.all([
    community.viewFaqEntry(ctx, id),
    community.resolveSupportUrl(ctx.db, ctx.guildId),
  ]);
  return {
    embeds: [community.faqAnswerEmbed(entry, supportUrl)],
    components: community.faqAnswerButtons(entry.id, supportUrl),
  };
}

async function faqOverviewReply(ctx: Ctx) {
  const [categories, popular] = await Promise.all([
    community.listFaqCategories(ctx),
    community.mostViewedFaq(ctx, 10),
  ]);
  return {
    embeds: [community.faqOverviewEmbed(categories, popular)],
    components: community.faqPickSelect(popular),
  };
}

// ── /guides rendering ────────────────────────────────────────────────────────

async function guidesReply(ctx: Ctx, page: number, filters: { category?: string; game?: string }) {
  const result = await community.listGuides(ctx, { ...filters, page, pageSize: GUIDE_PAGE_SIZE });
  await Promise.all(result.items.map((g) => community.recordGuideView(ctx, g.id)));
  return {
    embeds: [community.guidesEmbed(result, filters)],
    components: community.guidesPager(result, filters),
  };
}

// ── role application ─────────────────────────────────────────────────────────

async function applyChanges(
  rt: BotRuntime,
  member: GuildMember,
  changes: community.RoleChange[],
  reason: string,
): Promise<string[]> {
  const lines: string[] = [];
  for (const c of changes) {
    const r = await applyRoleChange(member, c, reason, rt.log);
    lines.push(r.ok ? `${c.action === 'add' ? '➕ Added' : '➖ Removed'} **${c.label}**` : `⚠️ ${r.message}`);
  }
  return lines;
}

async function interestsPrompt(ctx: Ctx, current: readonly string[]) {
  const roles = await community.listEnabledSelfRoles(ctx);
  return community.interestsSelect(
    roles.filter((r) => r.group === 'games'),
    current,
  );
}

// ── commands ─────────────────────────────────────────────────────────────────

const commands: SlashCommand[] = [
  {
    module: 'core',
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Overview of everything the GYNX.GG bot can do')
      .toJSON(),
    async execute(i, h) {
      const supportUrl = await community.resolveSupportUrl(h.ctx.db, h.ctx.guildId);
      await respond(i, { embeds: [helpEmbed(supportUrl)] });
    },
  },
  {
    module: 'community',
    data: new SlashCommandBuilder()
      .setName('faq')
      .setDescription('Search frequently asked questions')
      .addStringOption((o) =>
        o
          .setName('query')
          .setDescription('What do you need help with?')
          .setMaxLength(100)
          .setAutocomplete(true),
      )
      .toJSON(),
    async autocomplete(i, h) {
      try {
        const typed = String(i.options.getFocused());
        const rows = await community.suggestFaqQuestions(h.ctx, typed, 25);
        await i.respond(rows.map((r) => ({ name: truncate(r.question, 100), value: r.id })));
      } catch {
        await i.respond([]).catch(() => undefined);
      }
    },
    async execute(i, h) {
      const query = i.options.getString('query')?.trim();
      if (!query) {
        await respond(i, await faqOverviewReply(h.ctx));
        return;
      }
      // Autocomplete passes the entry id; a typed query falls back to search.
      if (CUID.test(query)) {
        try {
          await respond(i, await faqAnswerReply(h.ctx, query));
          return;
        } catch (err) {
          if (!isAppError(err) || err.code !== 'NOT_FOUND') throw err;
        }
      }
      const results = await community.searchFaq(h.ctx, { query, pageSize: 6 });
      const [top, ...others] = results.items;
      if (!top) {
        const supportUrl = await community.resolveSupportUrl(h.ctx.db, h.ctx.guildId);
        await replyInfo(
          i,
          'No matching FAQ',
          `I couldn't find an answer for that.\nTry different words, browse \`/guides\`, or use \`/troubleshoot\`.\n\n${community.supportLine(supportUrl)}`,
        );
        return;
      }
      const reply = await faqAnswerReply(h.ctx, top.id);
      await respond(i, { ...reply, components: [...reply.components, ...community.faqPickSelect(others)] });
    },
  },
  {
    module: 'community',
    data: new SlashCommandBuilder()
      .setName('guides')
      .setDescription('Browse setup and how-to guides')
      .addStringOption((o) =>
        o.setName('category').setDescription('Filter by category').setMaxLength(30).setAutocomplete(true),
      )
      .addStringOption((o) =>
        o.setName('game').setDescription('Filter by game').setMaxLength(30).setAutocomplete(true),
      )
      .toJSON(),
    async autocomplete(i, h) {
      try {
        const focused = i.options.getFocused(true);
        const facets = await community.guideFacets(h.ctx);
        const pool = focused.name === 'game' ? facets.games : facets.categories;
        const typed = String(focused.value).toLowerCase();
        await i.respond(
          pool
            .filter((v) => v.toLowerCase().includes(typed))
            .slice(0, 25)
            .map((v) => ({ name: truncate(v, 100), value: v })),
        );
      } catch {
        await i.respond([]).catch(() => undefined);
      }
    },
    async execute(i, h) {
      const filters = {
        category: i.options.getString('category') ?? undefined,
        game: i.options.getString('game') ?? undefined,
      };
      await respond(i, await guidesReply(h.ctx, 1, filters));
    },
  },
  {
    module: 'community',
    data: new SlashCommandBuilder().setName('rules').setDescription('Read the server rules').toJSON(),
    async execute(i, h) {
      const member = requireMember(i);
      const status = await community.getOnboardingStatus(h.ctx, memberFacts(member));
      await respond(i, {
        embeds: [community.rulesEmbed(status.welcome, status)],
        components: community.onboardingButtons({
          showAccept: status.welcome.requireRulesAck && !status.rulesAccepted,
          showVerify: status.requiresVerification && !status.verified,
        }),
      });
    },
  },
  {
    module: 'community',
    data: new SlashCommandBuilder()
      .setName('roles')
      .setDescription('Pick your game and notification roles')
      .toJSON(),
    async execute(i, h) {
      const roles = await community.listEnabledSelfRoles(h.ctx);
      await respond(i, {
        embeds: [community.selfRolesEmbed(roles, h.ctx.actor.roleIds)],
        components: community.selfRoleSelects(roles),
      });
    },
  },
];

// ── components ───────────────────────────────────────────────────────────────

const components: ComponentHandler[] = [
  {
    prefix: 'faq',
    module: 'community',
    async handle(i, args, h) {
      const [action, id, vote] = args;
      if (action === 'fb' && i.isButton() && id) {
        try {
          await community.recordFaqFeedback(h.ctx, id, vote === 'y');
        } catch (err) {
          if (isAppError(err) && err.code === 'RATE_LIMITED') {
            await replyInfo(i, 'Already recorded', 'You already gave feedback on this answer. Thanks!');
            return;
          }
          throw err;
        }
        if (vote === 'y') {
          await replySuccess(i, 'Thanks for the feedback!');
        } else {
          const supportUrl = await community.resolveSupportUrl(h.ctx.db, h.ctx.guildId);
          await replyInfo(
            i,
            'Sorry that didn’t help',
            `Try \`/troubleshoot\` or \`/guides\`.\n${community.supportLine(supportUrl)}`,
          );
        }
        return;
      }
      if (action === 'open' && i.isStringSelectMenu()) {
        const picked = i.values[0];
        if (!picked) return;
        await respond(i, await faqAnswerReply(h.ctx, picked));
        return;
      }
      await respond(i, { content: 'This control is no longer active.' });
    },
  },
  {
    prefix: 'guides',
    module: 'community',
    async handle(i, args, h) {
      const [action, page, category, game] = args;
      if (action === 'page' && i.isButton()) {
        const n = Math.max(1, Math.min(1000, Number.parseInt(page ?? '1', 10) || 1));
        const reply = await guidesReply(h.ctx, n, {
          category: community.decodeArg(category),
          game: community.decodeArg(game),
        });
        await i.update({ ...reply, allowedMentions: { parse: [] } });
        return;
      }
      await respond(i, { content: 'This control is no longer active.' });
    },
  },
  {
    prefix: 'onboard',
    module: 'community',
    async handle(i, args, h) {
      const member = requireMember(i);
      const facts = memberFacts(member);
      const [action] = args;

      if (action === 'rules' && i.isButton()) {
        const { alreadyAccepted, status } = await community.acceptRules(h.ctx, facts);
        const needsVerify = status.requiresVerification && !status.verified;
        await respond(i, {
          embeds: [
            brandEmbed({
              title: alreadyAccepted ? 'Rules already accepted' : 'Thanks for accepting the rules',
              description: needsVerify
                ? 'One more step: press **Verify** to finish onboarding.'
                : 'Pick the games you play below, or use `/roles` any time.',
            }),
          ],
          components: needsVerify
            ? community.onboardingButtons({ showAccept: false, showVerify: true })
            : await interestsPrompt(h.ctx, status.interests),
        });
        return;
      }

      if (action === 'verify' && i.isButton()) {
        await i.deferReply({ flags: 64 });
        const result = await community.completeVerification(h.ctx, facts);
        const lines: string[] = [];
        if (result.verifiedRoleId && !member.roles.cache.has(result.verifiedRoleId)) {
          // The verified role must never be privileged: re-check with live data before applying.
          const live = await liveRoleContext(member.guild, result.verifiedRoleId);
          const safety = community.assessRoleSafety({ guildId: member.guild.id, ...live });
          if (!safety.ok) {
            h.rt.log.warn(
              { roleId: result.verifiedRoleId, reason: safety.reason },
              'verified role is unsafe; not applied',
            );
            lines.push('⚠️ The verified role is misconfigured. Please let the staff team know.');
          } else {
            const r = await applyRoleChange(
              member,
              { roleId: result.verifiedRoleId, action: 'add' },
              'Onboarding verification',
              h.rt.log,
            );
            if (!r.ok) lines.push(`⚠️ ${r.message}`);
          }
        }
        const status = await community.getOnboardingStatus(h.ctx, facts);
        await respond(i, {
          embeds: [
            brandEmbed({
              title: result.alreadyVerified ? 'You are already verified' : 'You are verified',
              description: [...lines, 'Pick the games you play below, or use `/roles` any time.'].join('\n'),
            }),
          ],
          components: await interestsPrompt(h.ctx, status.interests),
        });
        return;
      }

      if (action === 'interests' && i.isStringSelectMenu()) {
        await i.deferReply({ flags: 64 });
        const games = (await community.listEnabledSelfRoles(h.ctx)).filter((r) => r.group === 'games');
        const live = await liveRolesContext(
          member.guild,
          games.map((g) => g.roleId),
        );
        const sel = await community.selectInterests(h.ctx, i.values, live, facts);
        const lines = await applyChanges(h.rt, member, [...sel.add, ...sel.remove], 'Onboarding interests');
        await respond(i, {
          embeds: [
            brandEmbed({ title: 'Interests saved', description: lines.join('\n') || 'No changes needed.' }),
          ],
        });
        return;
      }

      await respond(i, { content: 'This control is no longer active.' });
    },
  },
  {
    prefix: 'selfrole',
    module: 'community',
    async handle(i, args, h) {
      const member = requireMember(i);
      if (args[0] !== 'toggle' || !i.isStringSelectMenu()) {
        await respond(i, { content: 'This control is no longer active.' });
        return;
      }
      await i.deferReply({ flags: 64 });
      const lines: string[] = [];
      for (const roleId of [...new Set(i.values)].slice(0, 25)) {
        try {
          // The service re-checks the allowlist and role safety; the selected value is never trusted.
          const live = await liveRoleContext(member.guild, roleId);
          const change = await community.toggleSelfRole(h.ctx, roleId, live);
          lines.push(...(await applyChanges(h.rt, member, [change], 'Self-assigned role')));
        } catch (err) {
          if (!isAppError(err)) throw err;
          lines.push(`⚠️ ${err.message}`);
        }
      }
      await respond(i, {
        embeds: [brandEmbed({ title: 'Your roles', description: lines.join('\n') || 'No changes.' })],
      });
    },
  },
];

export const communityModule: BotModule = {
  name: 'community',
  commands,
  components,
  events: communityListeners,
};
