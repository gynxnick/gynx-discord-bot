import type { GameAdapter } from '../types';
import { queryViaA2S } from './a2s-query';

/** Rust reports real player counts in A2S keywords (`cp<current>`, `mp<max>`) because the byte fields cap at 255. */
export function parseRustKeywords(keywords: string | null): { current: number | null; max: number | null } {
  if (!keywords) return { current: null, max: null };
  const cp = keywords.match(/(?:^|,)cp(\d+)(?:,|$)/);
  const mp = keywords.match(/(?:^|,)mp(\d+)(?:,|$)/);
  return { current: cp ? Number(cp[1]) : null, max: mp ? Number(mp[1]) : null };
}

export const rustAdapter: GameAdapter = {
  id: 'rust',
  name: 'Rust',
  aliases: ['rust game'],
  developer: 'Facepunch Studios',
  officialSite: 'https://rust.facepunch.com',
  steamAppId: 252490,
  defaultPort: 28015,
  protocol: 'udp',
  queryProtocol: 'a2s',
  typicalPorts: [
    { port: 28015, proto: 'udp', purpose: 'Game' },
    { port: 28016, proto: 'tcp', purpose: 'RCON (keep private)' },
    { port: 28017, proto: 'udp', purpose: 'Steam query (server.queryport — varies by host)' },
  ],
  docsLinks: [
    { label: 'Rust wiki (Facepunch)', url: 'https://wiki.facepunch.com/rust' },
    { label: 'Creating a server', url: 'https://wiki.facepunch.com/rust/Creating-a-server' },
  ],
  notes: [
    'Client and server must be on the same game build; forced updates usually land on the first Thursday of the month.',
    'The Steam query port is configured with server.queryport and differs between hosts — pass it explicitly if known.',
  ],
  // Without an explicit port we try the common query-port layouts within one time budget.
  queryPorts: (port) => (port ? [port] : [28015, 28017, 28016]),
  query: (address, port, opts) =>
    queryViaA2S(address, port, opts, (info, base) => {
      const kw = parseRustKeywords(info.keywords);
      return { ...base, playersOnline: kw.current ?? base.playersOnline, playersMax: kw.max ?? base.playersMax };
    }),
};
