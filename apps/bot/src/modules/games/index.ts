import { SlashCommandBuilder } from 'discord.js';
import { games } from '@gynx/services';
import { respond } from '../../framework/reply';
import type { BotModule, HandlerCtx } from '../../framework/types';

/**
 * Game utilities: information only. The bot never controls or manages game
 * servers. Live checks are restricted to authorized GYNX endpoints
 * (PORTCHECK_ALLOWED_SUFFIXES) and show hostnames only — never resolved IPs.
 */

const gameChoices = games.gameChoices();
const liveOpts = (h: HandlerCtx): games.LiveNetOptions => ({
  allowedSuffixes: games.parseAllowedSuffixes(h.rt.env.PORTCHECK_ALLOWED_SUFFIXES),
});

const gameOption = (b: SlashCommandBuilder, description = 'Game') =>
  b.addStringOption((o) =>
    o
      .setName('game')
      .setDescription(description)
      .setRequired(true)
      .addChoices(...gameChoices),
  );

const gameinfo = gameOption(
  new SlashCommandBuilder().setName('gameinfo').setDescription('Ports, docs and tips for a supported game'),
);
const version = gameOption(
  new SlashCommandBuilder()
    .setName('version')
    .setDescription('Latest public version / update news for a game'),
);
const steam = gameOption(
  new SlashCommandBuilder()
    .setName('steam')
    .setDescription('Steam store link and latest official news for a game'),
);

const playercount = gameOption(
  new SlashCommandBuilder()
    .setName('playercount')
    .setDescription('Live players and version of a GYNX-hosted server'),
)
  .addStringOption((o) =>
    o
      .setName('host')
      .setDescription('Server hostname (authorized GYNX endpoints only)')
      .setRequired(true)
      .setMaxLength(253),
  )
  .addIntegerOption((o) =>
    o
      .setName('port')
      .setDescription('Game port (Valheim: game port; query port = +1)')
      .setMinValue(1)
      .setMaxValue(65535),
  );

const minecraft = new SlashCommandBuilder()
  .setName('minecraft')
  .setDescription('Minecraft Java server status: version, players and MOTD')
  .addStringOption((o) =>
    o
      .setName('host')
      .setDescription('Server hostname (authorized GYNX endpoints only)')
      .setRequired(true)
      .setMaxLength(253),
  )
  .addIntegerOption((o) =>
    o.setName('port').setDescription('Port (default 25565)').setMinValue(1).setMaxValue(65535),
  );

const portcheck = new SlashCommandBuilder()
  .setName('portcheck')
  .setDescription("Test TCP reachability of a GYNX endpoint from the bot's network")
  .addStringOption((o) =>
    o
      .setName('host')
      .setDescription('Hostname (authorized GYNX endpoints only)')
      .setRequired(true)
      .setMaxLength(253),
  )
  .addIntegerOption((o) =>
    o.setName('port').setDescription('TCP port').setRequired(true).setMinValue(1).setMaxValue(65535),
  );

export const gamesModule: BotModule = {
  name: 'games',
  commands: [
    {
      module: 'games',
      data: gameinfo.toJSON(),
      async execute(i) {
        const game = games.getGame(i.options.getString('game', true));
        await respond(i, { embeds: [games.gameInfoEmbed(game)], ephemeral: false });
      },
    },
    {
      module: 'games',
      data: version.toJSON(),
      async execute(i) {
        const game = games.getGame(i.options.getString('game', true));
        await i.deferReply();
        const info = await games.getLatestVersion(game.id);
        await respond(i, { embeds: [games.versionEmbed(game, info)] });
      },
    },
    {
      module: 'games',
      data: steam.toJSON(),
      async execute(i) {
        const game = games.getGame(i.options.getString('game', true));
        await i.deferReply();
        const news = game.steamAppId ? await games.getSteamNews(game.steamAppId) : null;
        await respond(i, { embeds: [games.steamEmbed(game, news)] });
      },
    },
    {
      module: 'games',
      data: playercount.toJSON(),
      async execute(i, h) {
        await i.deferReply({ flags: 64 });
        const result = await games.queryServer(
          h.ctx,
          {
            game: i.options.getString('game', true),
            host: i.options.getString('host', true),
            port: i.options.getInteger('port') ?? undefined,
          },
          liveOpts(h),
        );
        await respond(i, { embeds: [games.serverStatusEmbed(result)] });
      },
    },
    {
      module: 'games',
      data: minecraft.toJSON(),
      async execute(i, h) {
        await i.deferReply({ flags: 64 });
        const result = await games.queryServer(
          h.ctx,
          {
            game: 'minecraft',
            host: i.options.getString('host', true),
            port: i.options.getInteger('port') ?? undefined,
          },
          liveOpts(h),
        );
        await respond(i, { embeds: [games.serverStatusEmbed(result)] });
      },
    },
    {
      module: 'games',
      data: portcheck.toJSON(),
      async execute(i, h) {
        await i.deferReply({ flags: 64 });
        const outcome = await games.portCheck(
          h.ctx,
          { host: i.options.getString('host', true), port: i.options.getInteger('port', true) },
          liveOpts(h),
        );
        await respond(i, { embeds: [games.portCheckEmbed(outcome)] });
      },
    },
  ],
  components: [],
  events: [],
};
