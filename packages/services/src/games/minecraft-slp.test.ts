import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHandshake,
  buildStatusRequest,
  chatToText,
  decodeVarInt,
  encodeString,
  encodeVarInt,
  minecraftPing,
  parseStatusJson,
  parseStatusResponse,
  stripFormatting,
} from './minecraft-slp';

describe('VarInt', () => {
  it.each([
    [0, '00'],
    [1, '01'],
    [127, '7f'],
    [128, '8001'],
    [255, 'ff01'],
    [25565, 'ddc701'],
    [2097151, 'ffff7f'],
    [2147483647, 'ffffffff07'],
    [-1, 'ffffffff0f'],
    [-2147483648, '8080808008'],
  ])('encodes %i as %s and decodes it back', (value, hex) => {
    expect(encodeVarInt(value).toString('hex')).toBe(hex);
    expect(decodeVarInt(Buffer.from(hex, 'hex'))).toEqual({ value, size: hex.length / 2 });
  });

  it('returns null for an incomplete VarInt and throws when it is too long', () => {
    expect(decodeVarInt(Buffer.from([0x80]))).toBeNull();
    expect(() => decodeVarInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]))).toThrow();
  });
});

describe('SLP packets', () => {
  it('builds the handshake: [len][0x00][proto -1][host][port BE][next=1]', () => {
    const hs = buildHandshake('mc.example.com', 25565);
    const len = decodeVarInt(hs)!;
    expect(len.value).toBe(hs.length - len.size);
    const body = hs.subarray(len.size);
    expect(body[0]).toBe(0x00);
    expect(body.subarray(1, 6).toString('hex')).toBe('ffffffff0f');
    expect(body.subarray(6, 6 + 15)).toEqual(encodeString('mc.example.com'));
    expect(body.readUInt16BE(21)).toBe(25565);
    expect(body[23]).toBe(0x01);
    expect(buildStatusRequest().toString('hex')).toBe('0100');
  });

  it('parses partial and complete status responses and enforces the size cap', () => {
    const json = '{"version":{"name":"Paper 1.21.1","protocol":767}}';
    const packet = Buffer.concat([encodeVarInt(0x00), encodeString(json)]);
    const framed = Buffer.concat([encodeVarInt(packet.length), packet]);
    expect(parseStatusResponse(framed.subarray(0, 5))).toBeNull();
    expect(parseStatusResponse(framed)).toBe(json);
    expect(() => parseStatusResponse(Buffer.concat([encodeVarInt(70_000), Buffer.alloc(10)]))).toThrow(/too large/);
  });

  it('turns chat components into plain text and strips § codes', () => {
    expect(stripFormatting('§aWelcome §l§cto §rthe server')).toBe('Welcome to the server');
    expect(chatToText({ text: 'A', extra: [{ text: 'B', extra: ['C'] }, 'D'] })).toBe('ABCD');
    const s = parseStatusJson(
      JSON.stringify({
        version: { name: '§61.21.1', protocol: 767 },
        players: { online: 12, max: 100, sample: [] },
        description: { text: '', extra: [{ text: '§bA Minecraft', color: 'aqua' }, { text: ' Server\n§7Line two' }] },
      }),
    );
    expect(s).toEqual({ versionName: '1.21.1', protocol: 767, playersOnline: 12, playersMax: 100, motd: 'A Minecraft Server\nLine two' });
    expect(() => parseStatusJson('not json')).toThrow();
  });
});

/** Minimal fake Minecraft server speaking SLP on 127.0.0.1. */
function fakeMinecraft(onConn: (sock: Socket, received: () => Buffer) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((sock) => {
      sock.on('error', () => undefined);
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        onConn(sock, () => buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe('minecraftPing against a local fake server', () => {
  it('performs handshake + status request and decodes the response', async () => {
    let seenHost = '';
    const { server, port } = await fakeMinecraft((sock, received) => {
      const buf = received();
      const hsLen = decodeVarInt(buf);
      if (!hsLen || buf.length < hsLen.size + hsLen.value + 2) return; // wait for handshake + request
      const body = buf.subarray(hsLen.size, hsLen.size + hsLen.value);
      const proto = decodeVarInt(body, 1)!;
      const hostLen = decodeVarInt(body, 1 + proto.size)!;
      seenHost = body.subarray(1 + proto.size + hostLen.size, 1 + proto.size + hostLen.size + hostLen.value).toString();
      const json = JSON.stringify({ version: { name: '1.20.4', protocol: 765 }, players: { online: 3, max: 20 }, description: '§eHello' });
      const packet = Buffer.concat([encodeVarInt(0), encodeString(json)]);
      // Send in two chunks to exercise reassembly.
      const framed = Buffer.concat([encodeVarInt(packet.length), packet]);
      sock.write(framed.subarray(0, 7));
      setTimeout(() => sock.write(framed.subarray(7)), 20);
    });
    servers.push(server);
    const res = await minecraftPing('127.0.0.1', port, { hostname: 'play.example.gg', timeoutMs: 2000 });
    expect(seenHost).toBe('play.example.gg');
    expect(res).toMatchObject({ versionName: '1.20.4', protocol: 765, playersOnline: 3, playersMax: 20, motd: 'Hello' });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('aborts when the server streams more than 64 KB', async () => {
    const { server, port } = await fakeMinecraft((sock) => {
      sock.write(Buffer.concat([encodeVarInt(60_000), Buffer.alloc(80_000, 0x61)]));
    });
    servers.push(server);
    await expect(minecraftPing('127.0.0.1', port, { hostname: 'x.example.gg', timeoutMs: 2000 })).rejects.toThrow();
  });

  it('times out on a silent server', async () => {
    const { server, port } = await fakeMinecraft(() => undefined);
    servers.push(server);
    const started = Date.now();
    await expect(minecraftPing('127.0.0.1', port, { hostname: 'x.example.gg', timeoutMs: 300 })).rejects.toThrow(/did not respond/);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
