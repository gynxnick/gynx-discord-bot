/**
 * Game utilities are information-only: the bot never controls, configures or
 * manages game servers. Adapters describe a game and (optionally) know how to
 * read its public query protocol.
 */

export interface GameServerInfo {
  /** false when the game has no usable public query protocol or the server did not answer it. */
  available: boolean;
  /** Honest, user-facing reason when `available` is false. */
  unavailableReason?: string;
  name: string | null;
  map: string | null;
  version: string | null;
  protocol: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  motd: string | null;
  latencyMs: number | null;
  /** The port that was actually queried (may differ from the game port, e.g. Valheim). */
  queryPort: number;
}

export interface QueryOptions {
  /** Hostname the user asked for. Sent in protocol handshakes (Minecraft virtual hosts); never resolved again. */
  hostname: string;
  family: 4 | 6;
  timeoutMs: number;
}

export interface PortInfo {
  port: number;
  proto: 'tcp' | 'udp';
  purpose: string;
}

export interface DocsLink {
  label: string;
  url: string;
}

export interface GameAdapter {
  id: string;
  name: string;
  aliases: readonly string[];
  developer: string;
  officialSite: string;
  steamAppId?: number;
  /** Default game (connect) port. */
  defaultPort: number;
  /** Transport of the game port itself. */
  protocol: 'tcp' | 'udp';
  /** Live query protocol used by `query`, or 'none' when the game has no reliable public query. */
  queryProtocol: 'minecraft-slp' | 'a2s' | 'none';
  typicalPorts: readonly PortInfo[];
  docsLinks: readonly DocsLink[];
  /** Short static notes (shown in /gameinfo). Generic guidance only — never infrastructure claims. */
  notes: readonly string[];
  /**
   * Ports to try for a live query given the port the user supplied (if any).
   * Example: Valheim answers Steam queries on game port + 1.
   */
  queryPorts(port?: number): number[];
  /**
   * Query a server at an already-validated, pinned address. Callers MUST obtain
   * `address` from `resolveSafeTarget` — adapters never resolve hostnames.
   */
  query?(address: string, port: number, opts: QueryOptions): Promise<GameServerInfo>;
}

export const emptyInfo = (queryPort: number, unavailableReason?: string): GameServerInfo => ({
  available: false,
  unavailableReason,
  name: null,
  map: null,
  version: null,
  protocol: null,
  playersOnline: null,
  playersMax: null,
  motd: null,
  latencyMs: null,
  queryPort,
});
