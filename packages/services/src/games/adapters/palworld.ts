import { emptyInfo, type GameAdapter } from '../types';
import { GamesText } from '../texts';
import { queryViaA2S } from './a2s-query';

export { PALWORLD_UNAVAILABLE } from '../texts';

export const palworldAdapter: GameAdapter = {
  id: 'palworld',
  name: 'Palworld',
  aliases: ['pal', 'pal world'],
  developer: 'Pocketpair',
  officialSite: 'https://www.pocketpair.jp/palworld',
  steamAppId: 1623730,
  defaultPort: 8211,
  protocol: 'udp',
  queryProtocol: 'a2s',
  typicalPorts: [
    { port: 8211, proto: 'udp', purpose: 'Game' },
    { port: 27015, proto: 'udp', purpose: 'Steam query (only on community-listed servers)' },
    { port: 25575, proto: 'tcp', purpose: 'RCON (keep private)' },
  ],
  docsLinks: [{ label: 'Palworld dedicated server guide (official)', url: 'https://docs.palworldgame.com/' }],
  notes: [
    'Client and server versions must match — update both after a patch.',
    'Live player counts are only available when the server answers Steam queries on its query port.',
  ],
  // Pass the Steam query port (default 27015), not the 8211 game port.
  queryPorts: (port) => [port ?? 27015],
  async query(address, port, opts) {
    // Best effort: some servers answer A2S on the query port; otherwise be honest that data is unavailable.
    try {
      return await queryViaA2S(address, port, opts);
    } catch {
      return emptyInfo(port, GamesText.palworldUnavailable());
    }
  },
};
