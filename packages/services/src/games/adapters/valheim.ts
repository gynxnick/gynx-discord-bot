import type { GameAdapter } from '../types';
import { queryViaA2S } from './a2s-query';

/**
 * Valheim answers Steam (A2S) queries on the game port + 1. Users supply the
 * game/connect port (default 2456); we query 2457. Crossplay servers (-crossplay)
 * use PlayFab relays and may not answer A2S at all.
 */
export const valheimAdapter: GameAdapter = {
  id: 'valheim',
  name: 'Valheim',
  aliases: ['val'],
  developer: 'Iron Gate AB',
  officialSite: 'https://www.valheimgame.com',
  steamAppId: 892970,
  defaultPort: 2456,
  protocol: 'udp',
  queryProtocol: 'a2s',
  typicalPorts: [
    { port: 2456, proto: 'udp', purpose: 'Game (connect port)' },
    { port: 2457, proto: 'udp', purpose: 'Steam query (game port + 1)' },
  ],
  docsLinks: [{ label: 'Dedicated servers (Valheim wiki)', url: 'https://valheim.fandom.com/wiki/Dedicated_servers' }],
  notes: [
    'The Steam query port is always the game port + 1 — /playercount does this for you.',
    'Crossplay servers are joined via join code and may not answer Steam queries.',
    'Server passwords must be at least 5 characters and must not appear in the server name.',
  ],
  queryPorts: (port) => [(port ?? 2456) + 1],
  query: (address, port, opts) => queryViaA2S(address, port, opts),
};
