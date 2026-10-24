import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { LIVE_DISABLED_MESSAGE, parseAllowedSuffixes, resolveGameTarget, tcpProbe } from './live';
import { findGame, gameChoices, getGame, listGames } from './registry';

const SUFFIXES = ['gynx.gg', 'gynx-nodes.net'];
const publicResolver = async () => [{ address: '203.0.114.10', family: 4 }];

describe('PORTCHECK_ALLOWED_SUFFIXES parsing', () => {
  it('splits, trims, lowercases and drops empties / leading dots', () => {
    expect(parseAllowedSuffixes(' gynx.gg, .Nodes.GYNX.gg ,,')).toEqual(['gynx.gg', 'nodes.gynx.gg']);
    expect(parseAllowedSuffixes('')).toEqual([]);
    expect(parseAllowedSuffixes(undefined)).toEqual([]);
  });
});

describe('resolveGameTarget (SSRF guard for live queries and /portcheck)', () => {
  it('is disabled entirely when no suffixes are configured', async () => {
    await expect(
      resolveGameTarget('mc.gynx.gg', { allowedSuffixes: [], resolver: publicResolver }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: LIVE_DISABLED_MESSAGE,
    });
  });

  it('rejects hosts outside the authorized suffixes, including look-alikes', async () => {
    for (const host of ['example.com', 'gynx.gg.evil.com', 'evilgynx.gg', 'mc.gynx.gg@evil.com']) {
      await expect(
        resolveGameTarget(host, { allowedSuffixes: SUFFIXES, resolver: publicResolver }),
      ).rejects.toThrow();
    }
  });

  it('rejects IP literals, even private ones, because they cannot match a suffix', async () => {
    for (const host of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1']) {
      await expect(resolveGameTarget(host, { allowedSuffixes: SUFFIXES })).rejects.toThrow();
    }
  });

  it('rejects an authorized hostname that resolves to a private / metadata address (DNS rebinding)', async () => {
    for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.1.10', 'fd00::1']) {
      const resolver = async () => [{ address, family: address.includes(':') ? 6 : 4 }];
      await expect(resolveGameTarget('mc.gynx.gg', { allowedSuffixes: SUFFIXES, resolver })).rejects.toThrow(
        /not allowed/,
      );
    }
    // One bad address among good ones is still rejected.
    const mixed = async () => [
      { address: '203.0.114.10', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];
    await expect(
      resolveGameTarget('mc.gynx.gg', { allowedSuffixes: SUFFIXES, resolver: mixed }),
    ).rejects.toThrow(/not allowed/);
  });

  it('returns a pinned public address for an authorized host', async () => {
    const t = await resolveGameTarget('Play.GYNX.gg', {
      allowedSuffixes: SUFFIXES,
      resolver: publicResolver,
    });
    expect(t).toEqual({ hostname: 'play.gynx.gg', address: '203.0.114.10', family: 4 });
  });
});

describe('tcpProbe', () => {
  it('reports open with latency, and closed when refused', async () => {
    const server = createServer((s) => {
      s.on('error', () => undefined);
      s.end();
    });
    const port = await new Promise<number>((r) =>
      server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port)),
    );
    const open = await tcpProbe('127.0.0.1', port, 1000);
    expect(open.result).toBe('open');
    expect(open.latencyMs).not.toBeNull();
    await new Promise<void>((r) => server.close(() => r()));
    const closed = await tcpProbe('127.0.0.1', port, 1000);
    expect(closed).toEqual({ result: 'closed', latencyMs: null });
  });
});

describe('game registry', () => {
  it('exposes the supported games and resolves aliases', () => {
    expect(listGames().map((g) => g.id)).toEqual(['minecraft', 'rust', 'palworld', 'valheim', 'gmod']);
    expect(gameChoices()).toHaveLength(5);
    expect(findGame('MC')?.id).toBe('minecraft');
    expect(findGame("garry's mod")?.id).toBe('gmod');
    expect(() => getGame('fortnite')).toThrow();
  });

  it('maps Valheim queries to game port + 1', () => {
    expect(getGame('valheim').queryPorts()).toEqual([2457]);
    expect(getGame('valheim').queryPorts(2600)).toEqual([2601]);
    expect(getGame('minecraft').queryPorts()).toEqual([25565]);
  });
});
