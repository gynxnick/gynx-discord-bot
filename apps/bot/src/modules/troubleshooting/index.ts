import { SlashCommandBuilder, type InteractionUpdateOptions } from 'discord.js';
import { games, getGuildConfig, troubleshooting, type Ctx } from '@gynx/services';
import { respond } from '../../framework/reply';
import type { BotModule, ComponentInteraction } from '../../framework/types';

const gameChoices = games.gameChoices();

const troubleshoot = new SlashCommandBuilder()
  .setName('troubleshoot')
  .setDescription('Guided, step-by-step help for common game server problems')
  .addStringOption((o) =>
    o
      .setName('game')
      .setDescription('Only show guides for this game')
      .addChoices(...gameChoices),
  );

const diagnose = new SlashCommandBuilder()
  .setName('diagnose')
  .setDescription(
    'Scan a .log/.txt for known issues. Credentials & IPs are auto-redacted; never upload passwords',
  )
  .addAttachmentOption((o) =>
    o
      .setName('file')
      .setDescription('Logs may hold sensitive data: credentials/IPs are redacted. Never upload passwords')
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('game')
      .setDescription('Which game the log is from (auto-detected for Minecraft)')
      .addChoices(...gameChoices),
  );

const knowledgeSearch = new SlashCommandBuilder()
  .setName('knowledge-search')
  .setDescription('Search the GYNX knowledge base')
  .addStringOption((o) =>
    o
      .setName('query')
      .setDescription('What do you need help with?')
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(100)
      .setAutocomplete(true),
  )
  .addStringOption((o) =>
    o
      .setName('game')
      .setDescription('Prefer articles for this game')
      .addChoices(...gameChoices),
  );

async function supportUrl(ctx: Ctx): Promise<string | null> {
  return troubleshooting.supportUrlOf(await getGuildConfig(ctx.db, ctx.guildId));
}

/** Replace the ephemeral flow message in place (buttons/selects), or reply if it cannot be updated. */
async function updateOrRespond(
  i: ComponentInteraction,
  body: Pick<InteractionUpdateOptions, 'embeds' | 'components'>,
): Promise<void> {
  if ((i.isButton() || i.isStringSelectMenu()) && !i.replied && !i.deferred) {
    await i.update({ ...body, allowedMentions: { parse: [] } } as InteractionUpdateOptions);
    return;
  }
  await respond(i, body as never);
}

export const troubleshootingModule: BotModule = {
  name: 'troubleshooting',
  commands: [
    {
      module: 'troubleshooting',
      data: troubleshoot.toJSON(),
      async execute(i, h) {
        const flows = await troubleshooting.listFlows(h.ctx, {
          game: i.options.getString('game') ?? undefined,
        });
        await respond(i, {
          embeds: [troubleshooting.flowPickerEmbed(flows)],
          components: troubleshooting.flowPickerComponents(flows) as never,
        });
      },
    },
    {
      module: 'troubleshooting',
      data: diagnose.toJSON(),
      async execute(i, h) {
        const file = i.options.getAttachment('file', true);
        await i.deferReply({ flags: 64 });
        const outcome = await troubleshooting.runDiagnosis(h.ctx, {
          attachment: { url: file.url, name: file.name, size: file.size, contentType: file.contentType },
          game: i.options.getString('game') ?? undefined,
        });
        await respond(i, {
          embeds: [troubleshooting.diagnosisEmbed(outcome, file.name)],
          components: troubleshooting.diagnosisComponents(outcome) as never,
        });
      },
    },
    {
      module: 'troubleshooting',
      data: knowledgeSearch.toJSON(),
      async execute(i, h) {
        const query = i.options.getString('query', true);
        const result = await troubleshooting.searchArticles(h.ctx, {
          query,
          game: i.options.getString('game') ?? undefined,
          limit: 5,
        });
        await respond(i, {
          embeds: [troubleshooting.searchResultsEmbed(query, result.items, result.total)],
          components: troubleshooting.searchResultsComponents(result.items) as never,
        });
      },
      async autocomplete(i, h) {
        const focused = String(i.options.getFocused());
        const rows = await troubleshooting.autocompleteArticles(
          h.ctx,
          focused,
          i.options.getString('game') ?? undefined,
        );
        await i.respond(rows.map((r) => ({ name: r.title.slice(0, 100), value: r.title.slice(0, 100) })));
      },
    },
  ],
  components: [
    {
      prefix: 'tshoot',
      module: 'troubleshooting',
      async handle(i, args, h) {
        const [action, ...rest] = args;
        if (action === 'flow' && i.isStringSelectMenu()) {
          const view = await troubleshooting.startSession(h.ctx, i.values[0] ?? '');
          await updateOrRespond(i, {
            embeds: [troubleshooting.stepEmbed(view)],
            components: troubleshooting.stepComponents(view) as never,
          });
          return;
        }
        if (action === 'opt' && i.isButton()) {
          const [sessionId = '', nodeId = '', idx = ''] = rest;
          const view = await troubleshooting.chooseOption(h.ctx, sessionId, Number(idx), nodeId);
          await updateOrRespond(i, {
            embeds: [troubleshooting.stepEmbed(view)],
            components: troubleshooting.stepComponents(view) as never,
          });
          return;
        }
        if (action === 'esc' && i.isButton()) {
          const { supportUrl: url } = await troubleshooting.escalateSession(h.ctx, rest[0] ?? '');
          await updateOrRespond(i, {
            embeds: [troubleshooting.escalatedEmbed(url)],
            components: troubleshooting.supportRow(url) as never,
          });
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
    {
      prefix: 'tskb',
      module: 'troubleshooting',
      async handle(i, args, h) {
        const [action, key = '', vote] = args;
        if (action === 'view' && i.isButton()) {
          const article = await troubleshooting.viewArticle(h.ctx, key);
          const url = await supportUrl(h.ctx);
          await respond(i, {
            embeds: [troubleshooting.articleEmbed(article, url)],
            components: troubleshooting.articleComponents(article, url) as never,
          });
          return;
        }
        if (action === 'vote' && i.isButton()) {
          await troubleshooting.voteArticle(h.ctx, key, vote === 'y');
          if (vote === 'y') {
            await respond(i, { content: 'Thanks for the feedback — glad it helped!' });
          } else {
            const url = await supportUrl(h.ctx);
            await respond(i, {
              embeds: [troubleshooting.escalatedEmbed(url)],
              components: troubleshooting.supportRow(url) as never,
            });
          }
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
    {
      prefix: 'tsdiag',
      module: 'troubleshooting',
      async handle(i, args, h) {
        const [action, recordId = '', answer] = args;
        if (action === 'fb' && i.isButton()) {
          const helped = answer === 'y';
          const { supportUrl: url } = await troubleshooting.diagnosticFeedback(h.ctx, recordId, helped);
          if (helped) await respond(i, { content: 'Great — thanks for letting us know!' });
          else
            await respond(i, {
              embeds: [troubleshooting.escalatedEmbed(url)],
              components: troubleshooting.supportRow(url) as never,
            });
          return;
        }
        await respond(i, { content: 'This control is no longer active.' });
      },
    },
  ],
  events: [],
};
