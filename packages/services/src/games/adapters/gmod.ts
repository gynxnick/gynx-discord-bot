import type { GameAdapter } from '../types';
import { queryViaA2S } from './a2s-query';

export const gmodAdapter: GameAdapter = {
  id: 'gmod',
  name: "Garry's Mod",
  aliases: ['garrysmod', 'garrys mod', "garry's mod"],
  developer: 'Facepunch Studios',
  officialSite: 'https://gmod.facepunch.com',
  steamAppId: 4000,
  defaultPort: 27015,
  protocol: 'udp',
  queryProtocol: 'a2s',
  typicalPorts: [
    { port: 27015, proto: 'udp', purpose: 'Game + Steam query' },
    { port: 27015, proto: 'tcp', purpose: 'RCON (keep private)' },
  ],
  docsLinks: [
    { label: "Garry's Mod wiki", url: 'https://wiki.facepunch.com/gmod/' },
    {
      label: 'Workshop for dedicated servers',
      url: 'https://wiki.facepunch.com/gmod/Workshop_for_Dedicated_Servers',
    },
  ],
  notes: [
    'Missing textures (purple/black checkers) or ERROR models usually mean missing Workshop content or mounted games (e.g. CS:S).',
    'Servers distribute Workshop content via a Workshop collection (+host_workshop_collection).',
  ],
  queryPorts: (port) => [port ?? 27015],
  query: (address, port, opts) => queryViaA2S(address, port, opts),
};
