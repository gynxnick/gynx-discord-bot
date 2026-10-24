import { createSocket, type RemoteInfo } from 'node:dgram';
import { AppError } from '@gynx/shared';

/**
 * Valve Source "A2S_INFO" server query over UDP (node:dgram only).
 * https://developer.valvesoftware.com/wiki/Server_queries#A2S_INFO
 *
 *   request:  FF FF FF FF 54 "Source Engine Query\0" [challenge(4)]
 *   response: FF FF FF FF 41 <challenge(4)>   → resend the request with the challenge appended
 *             FF FF FF FF 49 <info payload>
 *
 * Used for Rust, Garry's Mod, Valheim and (best effort) Palworld.
 */

const SIMPLE_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const QUERY = Buffer.from('Source Engine Query\0', 'latin1');
export const A2S_DEFAULT_TIMEOUT_MS = 5000;
const MAX_CHALLENGES = 2;

export function buildA2SInfoRequest(challenge?: Buffer): Buffer {
  return Buffer.concat([SIMPLE_HEADER, Buffer.from([0x54]), QUERY, challenge ?? Buffer.alloc(0)]);
}

export interface A2SInfo {
  protocol: number;
  name: string;
  map: string;
  folder: string;
  game: string;
  appId: number;
  players: number;
  maxPlayers: number;
  bots: number;
  serverType: string;
  environment: string;
  visibility: 'public' | 'private';
  vac: boolean;
  version: string;
  port: number | null;
  keywords: string | null;
  gameId: string | null;
}

export type A2SResponse = { type: 'challenge'; challenge: Buffer } | { type: 'info'; info: A2SInfo };

class Reader {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}
  get remaining() {
    return this.buf.length - this.pos;
  }
  private need(n: number) {
    if (this.pos + n > this.buf.length) throw new AppError('INTEGRATION', 'Truncated server query response.');
  }
  byte(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }
  short(): number {
    this.need(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  longlong(): bigint {
    this.need(8);
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  bytes(n: number): Buffer {
    this.need(n);
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  string(): string {
    const end = this.buf.indexOf(0, this.pos);
    if (end < 0) throw new AppError('INTEGRATION', 'Truncated server query response.');
    const s = this.buf.subarray(this.pos, end).toString('utf8');
    this.pos = end + 1;
    return s;
  }
}

const SERVER_TYPES: Record<string, string> = { d: 'dedicated', l: 'listen', p: 'proxy' };
const ENVIRONMENTS: Record<string, string> = { l: 'linux', w: 'windows', m: 'mac', o: 'mac' };

/** Parse a single-packet A2S response. Throws on malformed/unsupported payloads. */
export function parseA2SResponse(buf: Buffer): A2SResponse {
  if (buf.length < 5) throw new AppError('INTEGRATION', 'Truncated server query response.');
  const header = buf.readInt32LE(0);
  if (header === -2) throw new AppError('INTEGRATION', 'Split query responses are not supported.');
  if (header !== -1) throw new AppError('INTEGRATION', 'Unexpected server query response.');
  const r = new Reader(buf.subarray(4));
  const kind = r.byte();
  if (kind === 0x41) return { type: 'challenge', challenge: Buffer.from(r.bytes(4)) };
  if (kind !== 0x49) throw new AppError('INTEGRATION', 'Unsupported server query response.');

  const protocol = r.byte();
  const name = r.string();
  const map = r.string();
  const folder = r.string();
  const game = r.string();
  const appId = r.short();
  const players = r.byte();
  const maxPlayers = r.byte();
  const bots = r.byte();
  const serverType = SERVER_TYPES[String.fromCharCode(r.byte()).toLowerCase()] ?? 'unknown';
  const environment = ENVIRONMENTS[String.fromCharCode(r.byte()).toLowerCase()] ?? 'unknown';
  const visibility = r.byte() === 1 ? 'private' : 'public';
  const vac = r.byte() === 1;
  if (appId === 2400) r.bytes(3); // The Ship: mode, witnesses, duration
  const version = r.string();

  let port: number | null = null;
  let keywords: string | null = null;
  let gameId: string | null = null;
  if (r.remaining > 0) {
    const edf = r.byte();
    if (edf & 0x80) port = r.short();
    if (edf & 0x10) r.longlong(); // server SteamID — not exposed
    if (edf & 0x40) {
      r.short(); // SourceTV port
      r.string(); // SourceTV name
    }
    if (edf & 0x20) keywords = r.string();
    if (edf & 0x01) gameId = r.longlong().toString();
  }
  return {
    type: 'info',
    info: {
      protocol,
      name,
      map,
      folder,
      game,
      appId,
      players,
      maxPlayers,
      bots,
      serverType,
      environment,
      visibility,
      vac,
      version,
      port,
      keywords,
      gameId,
    },
  };
}

export interface A2SOptions {
  family?: 4 | 6;
  timeoutMs?: number;
}

/** Query A2S_INFO from a pinned address, handling the 0x41 challenge. */
export function a2sInfo(
  address: string,
  port: number,
  opts: A2SOptions = {},
): Promise<A2SInfo & { latencyMs: number }> {
  const timeoutMs = opts.timeoutMs ?? A2S_DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const socket = createSocket(opts.family === 6 ? 'udp6' : 'udp4');
    let settled = false;
    let challenges = 0;
    let sentAt = 0;
    const finish = (err: Error | null, value?: A2SInfo & { latencyMs: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new AppError('INTEGRATION', 'The server did not respond in time.')),
      timeoutMs,
    );
    const send = (challenge?: Buffer) => {
      sentAt = Date.now();
      socket.send(buildA2SInfoRequest(challenge), port, address, (err) => {
        if (err) finish(new AppError('INTEGRATION', 'Could not send the server query.'));
      });
    };
    socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
      // Ignore datagrams that do not come from the target (spoofing / stray packets).
      if (rinfo.port !== port || rinfo.address.replace(/^::ffff:/, '') !== address.replace(/^::ffff:/, ''))
        return;
      try {
        const res = parseA2SResponse(msg);
        if (res.type === 'challenge') {
          if (++challenges > MAX_CHALLENGES)
            throw new AppError('INTEGRATION', 'The server kept challenging the query.');
          send(res.challenge);
          return;
        }
        finish(null, { ...res.info, latencyMs: Date.now() - sentAt });
      } catch (e) {
        finish(e as Error);
      }
    });
    socket.on('error', () => finish(new AppError('INTEGRATION', 'Could not query the server.')));
    send();
  });
}
