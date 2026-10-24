import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors';

/**
 * SSRF / network-scanning protection for any outbound connection whose target
 * is influenced by a user or staff member (port checks, health checks, game
 * queries). Callers must connect to the returned `address` (pinning) instead of
 * re-resolving the hostname, which defeats DNS rebinding.
 */

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /\.lan$/i, /\.home\.arpa$/i, /^metadata(\.|$)/i];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

export function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address into 8 16-bit groups. */
function expandIPv6(ip: string): number[] {
  let addr = ip.toLowerCase();
  const zoneIdx = addr.indexOf('%');
  if (zoneIdx >= 0) addr = addr.slice(0, zoneIdx);
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4)
  const v4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const n = ipv4ToInt(v4Match[1]!);
    addr = addr.replace(v4Match[1]!, `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = addr.includes('::') ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array(fill).fill('0'), ...t].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 ? groups : Array(8).fill(0);
}

export function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  const allZeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (allZeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (allZeroPrefix(5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
    return isBlockedIPv4(v4);
  }
  // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
    return isBlockedIPv4(v4);
  }
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (first === 0x2002) return true; // 6to4 can embed private v4
  if (first === 0x0100 && allZeroPrefix(0) && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true;
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.?$/i;

export function isValidHostname(host: string): boolean {
  return HOSTNAME_RE.test(host) || isIP(host) !== 0;
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export interface SafeTargetOptions {
  /** If set, hostname must equal or end with one of these suffixes (authorization). */
  allowedSuffixes?: string[];
  /** Explicit opt-in for monitoring private infrastructure (staff-only, audited). */
  allowPrivate?: boolean;
  /** Injectable resolver for tests. */
  resolver?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface SafeTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

function blockedErr(reason: string): AppError {
  return new AppError('VALIDATION', 'That destination is not allowed.', { reason });
}

/**
 * Validate a user-supplied host, resolve it, and verify EVERY resolved address
 * is publicly routable. Returns one pinned address to connect to.
 */
export async function resolveSafeTarget(rawHost: string, opts: SafeTargetOptions = {}): Promise<SafeTarget> {
  const hostname = rawHost.trim().replace(/\.$/, '').toLowerCase();
  if (!hostname || !isValidHostname(hostname)) throw new AppError('VALIDATION', 'That hostname is not valid.');

  const literal = isIP(hostname);
  if (!literal && BLOCKED_HOSTNAMES.some((re) => re.test(hostname))) throw blockedErr('blocked-hostname');

  if (opts.allowedSuffixes && opts.allowedSuffixes.length > 0) {
    const ok = opts.allowedSuffixes.some((s) => {
      const suffix = s.trim().toLowerCase().replace(/^\./, '');
      return suffix.length > 0 && (hostname === suffix || hostname.endsWith(`.${suffix}`));
    });
    if (!ok) throw new AppError('FORBIDDEN', 'That destination is not an authorized GYNX endpoint.');
  }

  let addresses: Array<{ address: string; family: number }>;
  if (literal) {
    addresses = [{ address: hostname, family: literal }];
  } else {
    const resolver = opts.resolver ?? ((h: string) => lookup(h, { all: true, verbatim: true }));
    try {
      addresses = await resolver(hostname);
    } catch {
      throw new AppError('VALIDATION', 'That hostname could not be resolved.');
    }
  }
  if (addresses.length === 0) throw new AppError('VALIDATION', 'That hostname could not be resolved.');

  if (!opts.allowPrivate) {
    for (const a of addresses) {
      if (isBlockedAddress(a.address)) throw blockedErr('blocked-address');
    }
  }
  const first = addresses[0]!;
  return { hostname, address: first.address, family: first.family === 6 ? 6 : 4 };
}
