import { connect } from 'node:net';
import { AppError } from '@gynx/shared';

/**
 * Minecraft: Java Edition "Server List Ping" (SLP), the protocol the
 * multiplayer screen uses. https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping
 *
 *   C→S  Handshake      [len][0x00][VarInt protocol][String host][UShort port][VarInt nextState=1]
 *   C→S  Status Request [len=1][0x00]
 *   S→C  Status Response[len][0x00][String json]
 *
 * Implemented with node:net only. Responses are capped at 64 KB and the whole
 * exchange has a strict timeout.
 */

export const SLP_MAX_RESPONSE_BYTES = 64 * 1024;
export const SLP_DEFAULT_TIMEOUT_MS = 5000;

export function encodeVarInt(value: number): Buffer {
  let v = value >>> 0; // negative numbers are encoded as their 32-bit two's complement
  const bytes: number[] = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

/** Decode a VarInt. Returns null if the buffer ends before the VarInt does. Throws on >5 bytes. */
export function decodeVarInt(buf: Buffer, offset = 0): { value: number; size: number } | null {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buf.length) return null;
    const b = buf[pos++]!;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift >= 35) throw new AppError('INTEGRATION', 'Malformed server response (VarInt too long).');
  }
  return { value: result | 0, size: pos - offset };
}

export function encodeString(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([encodeVarInt(bytes.length), bytes]);
}

function frame(packet: Buffer): Buffer {
  return Buffer.concat([encodeVarInt(packet.length), packet]);
}

/** Handshake with next state = 1 (status). Protocol -1 = "tell me your version". */
export function buildHandshake(host: string, port: number, protocolVersion = -1): Buffer {
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  return frame(Buffer.concat([encodeVarInt(0x00), encodeVarInt(protocolVersion), encodeString(host), portBuf, encodeVarInt(1)]));
}

export function buildStatusRequest(): Buffer {
  return frame(encodeVarInt(0x00));
}

/**
 * Parse a (possibly partial) Status Response. Returns null if more bytes are
 * needed; throws if the response is malformed or exceeds the size cap.
 */
export function parseStatusResponse(buf: Buffer, maxBytes = SLP_MAX_RESPONSE_BYTES): string | null {
  const len = decodeVarInt(buf, 0);
  if (!len) return null;
  if (len.value <= 0 || len.value > maxBytes) throw new AppError('INTEGRATION', 'Server response was too large or malformed.');
  if (buf.length < len.size + len.value) return null;
  const body = buf.subarray(len.size, len.size + len.value);
  const id = decodeVarInt(body, 0);
  if (!id || id.value !== 0x00) throw new AppError('INTEGRATION', 'Unexpected packet from server.');
  const strLen = decodeVarInt(body, id.size);
  if (!strLen) throw new AppError('INTEGRATION', 'Malformed server response.');
  const start = id.size + strLen.size;
  if (strLen.value < 0 || start + strLen.value > body.length) throw new AppError('INTEGRATION', 'Malformed server response.');
  return body.subarray(start, start + strLen.value).toString('utf8');
}

/** Remove legacy § formatting codes and collapse whitespace. */
export function stripFormatting(s: string): string {
  return s
    .replace(/§[0-9a-fk-orx]/gi, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/** Flatten a chat component (string | {text, extra[]} | array) into plain text. */
export function chatToText(c: unknown, depth = 0): string {
  if (depth > 10 || c === null || c === undefined) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => chatToText(x, depth + 1)).join('');
  if (typeof c === 'object') {
    const o = c as { text?: unknown; translate?: unknown; extra?: unknown };
    const own = typeof o.text === 'string' ? o.text : typeof o.translate === 'string' ? o.translate : '';
    return own + (Array.isArray(o.extra) ? o.extra.map((x) => chatToText(x, depth + 1)).join('') : '');
  }
  return '';
}

export interface SlpStatus {
  versionName: string | null;
  protocol: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  motd: string | null;
}

export function parseStatusJson(json: string): SlpStatus {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new AppError('INTEGRATION', 'Server returned an invalid status response.');
  }
  const d = (data ?? {}) as {
    version?: { name?: unknown; protocol?: unknown };
    players?: { online?: unknown; max?: unknown };
    description?: unknown;
  };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
  const motd = stripFormatting(chatToText(d.description)).slice(0, 300);
  return {
    versionName: typeof d.version?.name === 'string' ? stripFormatting(d.version.name).slice(0, 100) : null,
    protocol: num(d.version?.protocol),
    playersOnline: num(d.players?.online),
    playersMax: num(d.players?.max),
    motd: motd || null,
  };
}

export interface SlpOptions {
  hostname: string;
  family?: 4 | 6;
  timeoutMs?: number;
}

/** Perform a status ping against a pinned address. */
export function minecraftPing(address: string, port: number, opts: SlpOptions): Promise<SlpStatus & { latencyMs: number }> {
  const timeoutMs = opts.timeoutMs ?? SLP_DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port, family: opts.family });
    let chunks = Buffer.alloc(0);
    let sentAt = 0;
    let settled = false;
    const finish = (err: Error | null, value?: SlpStatus & { latencyMs: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new AppError('INTEGRATION', 'The server did not respond in time.')), timeoutMs);

    socket.once('connect', () => {
      sentAt = Date.now();
      socket.write(Buffer.concat([buildHandshake(opts.hostname, port), buildStatusRequest()]));
    });
    socket.on('data', (d: Buffer) => {
      chunks = Buffer.concat([chunks, d]);
      if (chunks.length > SLP_MAX_RESPONSE_BYTES + 10) {
        finish(new AppError('INTEGRATION', 'Server response was too large.'));
        return;
      }
      try {
        const json = parseStatusResponse(chunks);
        if (json === null) return;
        finish(null, { ...parseStatusJson(json), latencyMs: Date.now() - sentAt });
      } catch (e) {
        finish(e as Error);
      }
    });
    socket.on('error', () => finish(new AppError('INTEGRATION', 'Could not connect to the server.')));
    socket.once('close', () => finish(new AppError('INTEGRATION', 'The server closed the connection without a status response.')));
  });
}
