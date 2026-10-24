import { describe, expect, it } from 'vitest';
import { isBlockedAddress, resolveSafeTarget } from './net-safety';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1234',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::a00:1', // NAT64 → 10.0.0.1
    'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows public %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe('resolveSafeTarget', () => {
  const resolver = (map: Record<string, string[]>) => async (h: string) =>
    (map[h] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('rejects localhost-style names before resolving', async () => {
    await expect(resolveSafeTarget('localhost')).rejects.toThrow();
    await expect(resolveSafeTarget('metadata.google.internal')).rejects.toThrow();
  });

  it('rejects a public name that resolves to a private address (DNS rebinding)', async () => {
    const r = resolver({ 'evil.example.com': ['93.184.216.34', '127.0.0.1'] });
    await expect(resolveSafeTarget('evil.example.com', { resolver: r })).rejects.toThrow(/not allowed/);
  });

  it('enforces the authorised suffix allowlist', async () => {
    const r = resolver({ 'mc.gynx.gg': ['93.184.216.34'], 'gynx.gg.attacker.com': ['93.184.216.34'] });
    await expect(resolveSafeTarget('mc.gynx.gg', { resolver: r, allowedSuffixes: ['gynx.gg'] })).resolves.toMatchObject({
      address: '93.184.216.34',
    });
    await expect(resolveSafeTarget('gynx.gg.attacker.com', { resolver: r, allowedSuffixes: ['gynx.gg'] })).rejects.toThrow(
      /authorized/,
    );
  });

  it('rejects malformed hostnames', async () => {
    await expect(resolveSafeTarget('bad host!')).rejects.toThrow(/not valid/);
    await expect(resolveSafeTarget('http://x.com')).rejects.toThrow();
  });
});
