import { defineTexts } from '../core/text';

/** Default wording kept as constants so tests can assert on it; always read through `GamesText` at runtime. */
export const LIVE_DISABLED_MESSAGE =
  'Live server checks are disabled: no authorized GYNX endpoints are configured on this bot (PORTCHECK_ALLOWED_SUFFIXES).';
export const VERSION_UNAVAILABLE = 'Version info is currently unavailable. Please try again later.';
export const PALWORLD_UNAVAILABLE =
  'Palworld does not offer a reliable public query protocol, so live server data is unavailable. ' +
  'Check the in-game server browser or your server console instead.';

/**
 * Member-facing wording of the games module (/gameinfo, /version, /steam,
 * /playercount, /minecraft, /portcheck). Per-game metadata (developers, ports,
 * notes, docs links) is data and is not part of this catalogue.
 */
export const GamesText = defineTexts('games', {
  infoOnlyFooter: {
    default: 'Information only — GYNX bot never controls game servers.',
    help: 'Footer of /gameinfo and /portcheck, and start of the live-query footer.',
    kind: 'short',
  },
  queriedFooter: {
    default: "{infoOnly} Queried from the bot's network.",
    help: 'Footer of /playercount and /minecraft. {infoOnly} is the information-only footer.',
    vars: ['infoOnly'],
  },

  // ── /gameinfo ──
  developerField: { default: 'Developer', help: '/gameinfo field name.', kind: 'title' },
  defaultPortField: { default: 'Default port', help: '/gameinfo field name.', kind: 'title' },
  liveQueryField: { default: 'Live query', help: '/gameinfo field name.', kind: 'title' },
  liveQuerySlp: {
    default: 'Server List Ping',
    help: '/gameinfo live query value for Minecraft.',
    kind: 'short',
  },
  liveQueryA2s: { default: 'Steam A2S', help: '/gameinfo live query value for Steam games.', kind: 'short' },
  liveQueryNone: {
    default: 'Not available',
    help: '/gameinfo live query value when the game has no query protocol.',
    kind: 'short',
  },
  typicalPortsField: { default: 'Typical ports', help: '/gameinfo field name.', kind: 'title' },
  linksField: { default: 'Links', help: '/gameinfo field name.', kind: 'title' },
  officialSiteLink: {
    default: 'Official site',
    help: '/gameinfo link text to the official site.',
    kind: 'short',
  },
  steamStoreLink: { default: 'Steam store', help: '/gameinfo link text to the Steam store.', kind: 'short' },

  // ── /version ──
  versionTitle: {
    default: '{game} · latest version',
    help: 'Title of /version. {game} is the game name.',
    vars: ['game'],
    kind: 'title',
  },
  versionUnavailable: {
    default: VERSION_UNAVAILABLE,
    help: '/version reply when version info could not be fetched.',
  },
  latestReleaseField: { default: 'Latest release', help: '/version field name (Minecraft).', kind: 'title' },
  latestSnapshotField: {
    default: 'Latest snapshot',
    help: '/version field name (Minecraft).',
    kind: 'title',
  },
  notApplicable: {
    default: 'n/a',
    help: '/version value when there is no snapshot.',
    kind: 'short',
  },
  mojangSourceFooter: {
    default: 'Source: Mojang version manifest · cached up to 10 minutes',
    help: 'Footer of /version for Minecraft.',
    kind: 'short',
  },
  newsTitle: {
    default: '{game} · latest update news',
    help: 'Title of /version for Steam games. {game} is the game name.',
    vars: ['game'],
    kind: 'title',
  },
  newsIntro: {
    default:
      'Steam does not publish a version number for this game, so here is the most recent official news post:',
    help: '/version intro for Steam games, above the latest news post.',
  },
  steamStoreField: {
    default: 'Steam store',
    help: '/version field name for the Steam store link.',
    kind: 'title',
  },
  steamNewsSourceFooter: {
    default: 'Source: Steam news · cached up to 10 minutes',
    help: 'Footer of /version for Steam games.',
    kind: 'short',
  },

  // ── /steam ──
  steamTitle: {
    default: '{game} on Steam',
    help: 'Title of /steam. {game} is the game name.',
    vars: ['game'],
    kind: 'title',
  },
  notOnSteam: {
    default: '{game} is not distributed through Steam. See {site}',
    help: '/steam reply for a game not on Steam. {site} is the official site.',
    vars: ['game', 'site'],
  },
  latestNews: {
    default: '**Latest news:** {title}',
    help: '/steam latest news line. {title} is the news post title.',
    vars: ['title'],
  },
  newsUnavailable: {
    default: 'Latest news is currently unavailable.',
    help: '/steam reply when news could not be fetched.',
  },
  storePageField: { default: 'Store page', help: '/steam field name.', kind: 'title' },
  steamApiSourceFooter: {
    default: 'Source: Steam Web API (public) · cached up to 10 minutes',
    help: 'Footer of /steam.',
    kind: 'short',
  },

  // ── /playercount, /minecraft ──
  serverTitle: {
    default: '{game} · {host}',
    help: 'Title of /playercount and /minecraft. {host} is the server hostname.',
    vars: ['game', 'host'],
    kind: 'title',
  },
  liveUnavailable: {
    default: 'Live data is unavailable.',
    help: 'Fallback when a server query returned no data.',
  },
  liveDisabled: {
    default: LIVE_DISABLED_MESSAGE,
    help: 'Error when live server checks are not configured on this bot.',
  },
  noQueryProtocol: {
    default: '{game} has no public query protocol, so live data is unavailable.',
    help: '/playercount reply for a game without a query protocol.',
    vars: ['game'],
  },
  serverNoAnswer: {
    default:
      'The server did not answer the status query. It may be offline, starting up, or have queries disabled.',
    help: '/playercount reply when the server did not answer.',
  },
  palworldUnavailable: {
    default: PALWORLD_UNAVAILABLE,
    help: '/playercount reply when a Palworld server does not answer Steam queries.',
  },
  unknownValue: {
    default: 'unknown',
    help: 'Shown for player count or version when the server did not report it.',
    kind: 'short',
  },
  playersField: { default: 'Players', help: '/playercount field name.', kind: 'title' },
  versionField: { default: 'Version', help: '/playercount field name.', kind: 'title' },
  protocolField: { default: 'Protocol', help: '/minecraft field name.', kind: 'title' },
  mapField: { default: 'Map', help: '/playercount field name.', kind: 'title' },
  responseTimeField: { default: 'Response time', help: '/playercount field name.', kind: 'title' },
  queryPortField: { default: 'Query port', help: '/playercount field name.', kind: 'title' },
  latencyValue: {
    default: '{ms} ms',
    help: 'Response time value. {ms} is milliseconds.',
    vars: ['ms'],
    kind: 'short',
  },

  // ── /portcheck ──
  portCheckTitle: {
    default: 'Port check · {host}:{port}',
    help: 'Title of /portcheck.',
    vars: ['host', 'port'],
    kind: 'title',
  },
  portOpen: {
    default: 'Open — a TCP connection was accepted',
    help: '/portcheck result: open.',
    kind: 'short',
  },
  portClosed: {
    default: 'Closed — the connection was refused',
    help: '/portcheck result: closed.',
    kind: 'short',
  },
  portTimeout: {
    default: 'Timed out — no answer within 3 seconds (filtered or offline)',
    help: '/portcheck result: timed out.',
    kind: 'short',
  },
  portUnreachable: {
    default: 'Unreachable — the network path to the host failed',
    help: '/portcheck result: unreachable.',
    kind: 'short',
  },
  portCheckExplainer: {
    default:
      'This tests TCP reachability from the bot’s network only — results from your own network may differ. Many game ports (Rust, Valheim, Palworld) are UDP and cannot be tested this way; use `/playercount` for those.',
    help: 'Explanation under the /portcheck result.',
    kind: 'long',
  },
});
