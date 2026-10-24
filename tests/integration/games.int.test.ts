import { randomInt } from 'node:crypto';
import { ensureGuild } from '@gynx/database';
import { createServer, type Server } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { games } from '@gynx/services';
import { ctxAs, testDb } from './helpers';

/** helpers.snowflake() is only unique per worker; a random guild id keeps parallel test files from colliding. */
async function freshGuild(): Promise<string> {
  const id = `9${String(randomInt(1e9)).padStart(9, '0')}${String(randomInt(1e9)).padStart(9, '0')}`;
  await ensureGuild(testDb(), id, `Test Guild ${id}`);
  return id;
}

// Tests only: resolve the authorized test hostname to loopback and allow it.
const loopback = {
  allowedSuffixes: ['gynx.test'],
  resolver: async () => [{ address: '127.0.0.1', family: 4 }],
  allowPrivate: true,
};

function listen(server: Server): Promise<number> {
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)),
  );
}

describe('games: live checks', () => {
  const servers: Server[] = [];
  afterAll(async () => {
    for (const s of servers) s.close();
    await testDb().$disconnect();
  });

  it('portcheck: open result, audited with hostname only (no IP), rate limited 3 per 5 minutes', async () => {
    const guildId = await freshGuild();
    const server = createServer((s) => {
      s.on('error', () => undefined);
      s.end();
    });
    servers.push(server);
    const port = await listen(server);
    const member = ctxAs(guildId);

    const r = await games.portCheck(member, { host: 'node1.gynx.test', port }, loopback);
    expect(r).toMatchObject({ hostname: 'node1.gynx.test', port, result: 'open' });
    expect(JSON.stringify(r)).not.toContain('127.0.0.1');

    const row = await testDb().securityAuditEvent.findFirstOrThrow({
      where: { guildId, action: 'games.portcheck', result: 'SUCCESS' },
    });
    expect(row.targetId).toBe('node1.gynx.test');
    expect(JSON.stringify(row)).not.toContain('127.0.0.1');

    await games.portCheck(member, { host: 'node1.gynx.test', port }, loopback);
    await games.portCheck(member, { host: 'node1.gynx.test', port }, loopback);
    await expect(games.portCheck(member, { host: 'node1.gynx.test', port }, loopback)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('portcheck: blocks private targets and unauthorized hosts, auditing the denial without the IP', async () => {
    const guildId = await freshGuild();
    const prod = {
      allowedSuffixes: ['gynx.test'],
      resolver: async () => [{ address: '10.0.0.8', family: 4 }],
    };
    await expect(
      games.portCheck(ctxAs(guildId), { host: 'internal.gynx.test', port: 22 }, prod),
    ).rejects.toThrow(/not allowed/);
    await expect(
      games.portCheck(ctxAs(guildId), { host: 'example.com', port: 80 }, prod),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      games.portCheck(ctxAs(guildId), { host: '169.254.169.254', port: 80 }, prod),
    ).rejects.toThrow();
    const denials = await testDb().securityAuditEvent.findMany({
      where: { guildId, action: 'games.portcheck', result: 'DENIED' },
    });
    expect(denials).toHaveLength(3);
    expect(JSON.stringify(denials)).not.toMatch(/10\.0\.0\.8|169\.254/);

    await expect(
      games.portCheck(ctxAs(guildId), { host: 'node.gynx.test', port: 80 }, { allowedSuffixes: [] }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: games.LIVE_DISABLED_MESSAGE,
    });
  });

  it('respects the games module toggle', async () => {
    const guildId = await freshGuild();
    await testDb().guildConfig.update({ where: { guildId }, data: { enabledModules: ['status'] } });
    await expect(
      games.portCheck(ctxAs(guildId), { host: 'node.gynx.test', port: 80 }, loopback),
    ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });

  it('queryServer: Minecraft SLP via pinned address, honest "unavailable" when the server does not answer', async () => {
    const guildId = await freshGuild();
    const server = createServer((sock) => {
      sock.on('error', () => undefined);
      sock.once('data', () => {
        const json = JSON.stringify({
          version: { name: 'Paper 1.21.1', protocol: 767 },
          players: { online: 7, max: 50 },
          description: { text: '§aWelcome!' },
        });
        const packet = Buffer.concat([games.encodeVarInt(0), games.encodeString(json)]);
        sock.write(Buffer.concat([games.encodeVarInt(packet.length), packet]));
      });
    });
    servers.push(server);
    const port = await listen(server);
    const member = ctxAs(guildId);
    const r = await games.queryServer(member, { game: 'minecraft', host: 'mc.gynx.test', port }, loopback);
    expect(r).toMatchObject({
      gameId: 'minecraft',
      hostname: 'mc.gynx.test',
      info: { available: true, version: 'Paper 1.21.1', playersOnline: 7, playersMax: 50, motd: 'Welcome!' },
    });

    const silent = createServer((s) => s.on('error', () => undefined));
    servers.push(silent);
    const silentPort = await listen(silent);
    const down = await games.queryServer(
      member,
      { game: 'minecraft', host: 'mc.gynx.test', port: silentPort },
      { ...loopback, timeoutMs: 1000 },
    );
    expect(down.info.available).toBe(false);
    expect(down.info.unavailableReason).toMatch(/did not answer/);
  });
});
