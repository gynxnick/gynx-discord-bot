import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckTarget, CheckTransport, HttpTransportRequest } from '../types';
import { httpAdapter } from './http';
import { mapIndicator, statuspageAdapter } from './statuspage';
import { tcpAdapter } from './tcp';
import { classifyError } from './transport';

const base = (over: Partial<CheckTarget> = {}): CheckTarget => ({
  id: 's',
  kind: 'HTTP',
  target: 'https://status.example.com/health',
  port: null,
  expectedStatus: null,
  timeoutMs: 2000,
  degradedLatencyMs: null,
  allowPrivate: false,
  ...over,
});

/** Public resolver stub so tests never hit DNS. */
const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

function fakeTransport(handler: (req: HttpTransportRequest) => { statusCode: number; location?: string; body?: string; latencyMs?: number }): CheckTransport & { calls: HttpTransportRequest[] } {
  const calls: HttpTransportRequest[] = [];
  return {
    calls,
    async http(req) {
      calls.push(req);
      const r = handler(req);
      return { statusCode: r.statusCode, location: r.location, body: Buffer.from(r.body ?? ''), latencyMs: r.latencyMs ?? 10 };
    },
    async tcp() {
      return 5;
    },
  };
}

describe('HTTP adapter against a real local server', () => {
  let server: http.Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits++;
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('fine');
      } else if (req.url === '/big') {
        res.writeHead(200);
        res.end(Buffer.alloc(512 * 1024, 'a')); // larger than the 64KB cap
      } else if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200);
          res.end('late');
        }, 1500);
      } else if (req.url === '/redirect-same') {
        res.writeHead(302, { location: '/ok' });
        res.end();
      } else if (req.url === '/redirect-loop') {
        res.writeHead(302, { location: '/redirect-loop' });
        res.end();
      } else if (req.url === '/redirect-away') {
        res.writeHead(302, { location: 'http://evil.example.com/' });
        res.end();
      } else if (req.url === '/statuspage/api/v2/status.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: { indicator: 'minor', description: 'Minor Service Outage' } }));
      } else {
        res.writeHead(503);
        res.end('down');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const local = (path: string, over: Partial<CheckTarget> = {}) => base({ target: `http://127.0.0.1:${port}${path}`, allowPrivate: true, ...over });

  it('reports ok with latency and status code', async () => {
    const r = await httpAdapter.check(local('/ok'));
    expect(r).toMatchObject({ ok: true, degraded: false, statusCode: 200 });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('classifies 5xx and unexpected status codes', async () => {
    expect(await httpAdapter.check(local('/nope'))).toMatchObject({ ok: false, statusCode: 503, errorClass: 'HTTP_5XX' });
    expect(await httpAdapter.check(local('/ok', { expectedStatus: 204 }))).toMatchObject({ ok: false, statusCode: 200, errorClass: 'UNEXPECTED_STATUS' });
  });

  it('enforces the timeout', async () => {
    expect(await httpAdapter.check(local('/slow', { timeoutMs: 300 }))).toMatchObject({ ok: false, errorClass: 'TIMEOUT', latencyMs: null });
  });

  it('marks slow-but-ok responses as degraded', async () => {
    expect(await httpAdapter.check(local('/slow', { timeoutMs: 3000, degradedLatencyMs: 500 }))).toMatchObject({ ok: true, degraded: true });
  });

  it('caps the body read at 64KB without failing', async () => {
    expect(await httpAdapter.check(local('/big'))).toMatchObject({ ok: true, statusCode: 200 });
  });

  it('follows at most one same-host redirect and never a cross-host one', async () => {
    expect(await httpAdapter.check(local('/redirect-same'))).toMatchObject({ ok: true, statusCode: 200 });
    expect(await httpAdapter.check(local('/redirect-loop'))).toMatchObject({ ok: false, statusCode: 302, errorClass: 'UNEXPECTED_STATUS' });
    const before = hits;
    expect(await httpAdapter.check(local('/redirect-away'))).toMatchObject({ ok: false, statusCode: 302 });
    expect(hits - before).toBe(1);
  });

  it('SSRF: the same local server is blocked when allowPrivate=false (no request is made)', async () => {
    const before = hits;
    const r = await httpAdapter.check(local('/ok', { allowPrivate: false }));
    expect(r).toEqual({ ok: false, degraded: false, latencyMs: null, errorClass: 'BLOCKED_TARGET' });
    expect(hits).toBe(before);
  });

  it('Statuspage adapter maps the indicator', async () => {
    const r = await statuspageAdapter.check(local('/statuspage', { kind: 'STATUSPAGE' }));
    expect(r).toMatchObject({ ok: true, degraded: true, statusCode: 200 });
  });

  it('TCP adapter connects to a real local port and reports refused connections', async () => {
    const tcp = net.createServer((s) => s.end());
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', () => r()));
    const tcpPort = (tcp.address() as AddressInfo).port;
    expect(await tcpAdapter.check(base({ kind: 'TCP', target: '127.0.0.1', port: tcpPort, allowPrivate: true }))).toMatchObject({ ok: true });
    expect(await tcpAdapter.check(base({ kind: 'TCP', target: '127.0.0.1', port: tcpPort, allowPrivate: false }))).toMatchObject({ ok: false, errorClass: 'BLOCKED_TARGET' });
    await new Promise<void>((r) => tcp.close(() => r()));
    expect(await tcpAdapter.check(base({ kind: 'TCP', target: '127.0.0.1', port: tcpPort, allowPrivate: true }))).toMatchObject({ ok: false, errorClass: 'CONN_REFUSED' });
  });
});

describe('HTTP adapter with an injected transport', () => {
  it('connects to the pinned, validated address while keeping the hostname', async () => {
    const t = fakeTransport(() => ({ statusCode: 200 }));
    const r = await httpAdapter.check(base(), { transport: t, resolver: publicResolver });
    expect(r.ok).toBe(true);
    expect(t.calls[0]!.address).toBe('93.184.216.34');
    expect(t.calls[0]!.url.hostname).toBe('status.example.com');
  });

  it('blocks hostnames that resolve to private / metadata addresses (DNS rebinding)', async () => {
    const t = fakeTransport(() => ({ statusCode: 200 }));
    for (const address of ['10.1.2.3', '169.254.169.254', '127.0.0.1', '::1']) {
      const r = await httpAdapter.check(base(), { transport: t, resolver: async () => [{ address, family: address.includes(':') ? 6 : 4 }] });
      expect(r.errorClass).toBe('BLOCKED_TARGET');
    }
    expect(t.calls).toHaveLength(0);
  });

  it('re-validates the redirect target', async () => {
    let n = 0;
    const t = fakeTransport(() => (n++ === 0 ? { statusCode: 301, location: 'https://status.example.com/next' } : { statusCode: 200 }));
    const resolver = async () => (n === 0 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.1', family: 4 }]);
    const r = await httpAdapter.check(base(), { transport: t, resolver });
    expect(r.errorClass).toBe('BLOCKED_TARGET');
  });

  it('rejects non-http schemes and credentials in URLs', async () => {
    const t = fakeTransport(() => ({ statusCode: 200 }));
    for (const target of ['ftp://status.example.com', 'file:///etc/passwd', 'gopher://x', 'https://u:p@status.example.com', 'not a url']) {
      expect((await httpAdapter.check(base({ target }), { transport: t, resolver: publicResolver })).errorClass).toBe('BLOCKED_TARGET');
    }
    expect(t.calls).toHaveLength(0);
  });

  it('reports DNS failures as a sanitised class', async () => {
    const r = await httpAdapter.check(base(), { resolver: async () => { throw new Error('getaddrinfo ENOTFOUND status.example.com'); } });
    expect(r).toEqual({ ok: false, degraded: false, latencyMs: null, errorClass: 'DNS' });
  });

  it('classifies 4xx and maps statuspage outages', async () => {
    const t = fakeTransport(() => ({ statusCode: 404 }));
    expect((await httpAdapter.check(base(), { transport: t, resolver: publicResolver })).errorClass).toBe('HTTP_4XX');
    const sp = fakeTransport(() => ({ statusCode: 200, body: '{"status":{"indicator":"major"}}' }));
    expect(await statuspageAdapter.check(base({ kind: 'STATUSPAGE', target: 'https://status.example.com/' }), { transport: sp, resolver: publicResolver })).toMatchObject({ ok: false });
    expect(sp.calls[0]!.url.pathname).toBe('/api/v2/status.json');
    const junk = fakeTransport(() => ({ statusCode: 200, body: '<html>' }));
    expect((await statuspageAdapter.check(base({ kind: 'STATUSPAGE' }), { transport: junk, resolver: publicResolver })).errorClass).toBe('INVALID_RESPONSE');
  });

  it('maps indicators and error codes without leaking messages', () => {
    expect(mapIndicator('none')).toEqual({ ok: true, degraded: false });
    expect(mapIndicator('critical').ok).toBe(false);
    expect(classifyError(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED', syscall: 'connect' }))).toBe('CONN_REFUSED');
    expect(classifyError(Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }))).toBe('TLS');
    expect(classifyError(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }))).toBe('TLS');
    expect(classifyError(Object.assign(new Error('x'), { code: 'HPE_INVALID_CONSTANT' }))).toBe('INVALID_RESPONSE');
  });
});
