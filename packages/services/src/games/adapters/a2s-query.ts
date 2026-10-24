import { a2sInfo, type A2SInfo } from '../a2s';
import type { GameServerInfo, QueryOptions } from '../types';

/** Shared A2S → GameServerInfo mapping. `refine` lets an adapter interpret game-specific keywords. */
export async function queryViaA2S(
  address: string,
  port: number,
  opts: QueryOptions,
  refine?: (info: A2SInfo, base: GameServerInfo) => GameServerInfo,
): Promise<GameServerInfo> {
  const info = await a2sInfo(address, port, { family: opts.family, timeoutMs: opts.timeoutMs });
  const base: GameServerInfo = {
    available: true,
    name: info.name || null,
    map: info.map || null,
    version: info.version || null,
    protocol: info.protocol,
    playersOnline: info.players,
    playersMax: info.maxPlayers,
    motd: null,
    latencyMs: info.latencyMs,
    queryPort: port,
  };
  return refine ? refine(info, base) : base;
}
