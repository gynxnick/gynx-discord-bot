import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { a2sInfo, buildA2SInfoRequest, parseA2SResponse } from './a2s';
import { parseRustKeywords } from './adapters/rust';

/** A2S_INFO response captured from a Rust server (name anonymised). */
const RUST_CAPTURE = Buffer.from(
  'ffffffff49115b45555d204578616d706c652052757374207c204d6f6e74686c790050726f6365647572616c204d617000727573740052757374000000ffff00646c00013235383600b16f6d00000000000040016d703330302c63703238372c7170302c76323538362c626f726e31373030303030303030004ada030000000000',
  'hex',
);

describe('A2S_INFO parsing', () => {
  it('builds the request with and without a challenge', () => {
    expect(buildA2SInfoRequest().toString('latin1')).toBe('\xff\xff\xff\xffTSource Engine Query\0');
    expect(buildA2SInfoRequest(Buffer.from([1, 2, 3, 4])).subarray(-4)).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('parses a captured Rust response including EDF keywords', () => {
    const r = parseA2SResponse(RUST_CAPTURE);
    expect(r.type).toBe('info');
    if (r.type !== 'info') return;
    expect(r.info).toMatchObject({
      protocol: 17,
      name: '[EU] Example Rust | Monthly',
      map: 'Procedural Map',
      folder: 'rust',
      game: 'Rust',
      players: 255,
      maxPlayers: 255,
      serverType: 'dedicated',
      environment: 'linux',
      visibility: 'public',
      vac: true,
      version: '2586',
      port: 28015,
      gameId: '252490',
    });
    // Rust's real counts live in keywords because the byte fields cap at 255.
    expect(parseRustKeywords(r.info.keywords)).toEqual({ current: 287, max: 300 });
  });

  it('recognises a challenge and rejects malformed or split packets', () => {
    expect(parseA2SResponse(Buffer.from('ffffffff41deadbeef', 'hex'))).toEqual({
      type: 'challenge',
      challenge: Buffer.from('deadbeef', 'hex'),
    });
    expect(() => parseA2SResponse(RUST_CAPTURE.subarray(0, 30))).toThrow(/Truncated/);
    expect(() => parseA2SResponse(Buffer.from('feffffff0000000000', 'hex'))).toThrow(/Split/);
    expect(() => parseA2SResponse(Buffer.from('0000000049', 'hex'))).toThrow();
  });
});

const sockets: Socket[] = [];
afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

/** Fake Source server on 127.0.0.1 that demands a challenge first (like modern Valve servers). */
function fakeSourceServer(): Promise<{ port: number; requests: Buffer[] }> {
  return new Promise((resolve) => {
    const sock = createSocket('udp4');
    sockets.push(sock);
    const requests: Buffer[] = [];
    const challenge = Buffer.from('0a0b0c0d', 'hex');
    sock.on('message', (msg, rinfo) => {
      requests.push(msg);
      const hasChallenge = msg.length === 25 + 4 && msg.subarray(-4).equals(challenge);
      const reply = hasChallenge
        ? RUST_CAPTURE
        : Buffer.concat([Buffer.from('ffffffff41', 'hex'), challenge]);
      sock.send(reply, rinfo.port, rinfo.address);
    });
    sock.bind(0, '127.0.0.1', () => resolve({ port: sock.address().port, requests }));
  });
}

describe('a2sInfo against a local fake UDP server', () => {
  it('handles the 0x41 challenge and returns server info', async () => {
    const { port, requests } = await fakeSourceServer();
    const info = await a2sInfo('127.0.0.1', port, { timeoutMs: 2000 });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.subarray(-4).toString('hex')).toBe('0a0b0c0d');
    expect(info.name).toBe('[EU] Example Rust | Monthly');
    expect(info.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('times out when nothing answers', async () => {
    const silent = createSocket('udp4');
    sockets.push(silent);
    const port = await new Promise<number>((r) =>
      silent.bind(0, '127.0.0.1', () => r(silent.address().port)),
    );
    await expect(a2sInfo('127.0.0.1', port, { timeoutMs: 300 })).rejects.toThrow(/did not respond/);
  });
});
