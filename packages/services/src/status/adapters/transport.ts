import http from 'node:http';
import https from 'node:https';
import net, { isIP, type LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';
import { isAppError, resolveSafeTarget } from '@gynx/shared';
import type { CheckOptions, CheckTransport, ErrorClass, HttpTransportRequest, HttpTransportResponse, TcpTransportRequest } from '../types';

/** Error carrying a sanitised class; its message is never persisted or shown. */
export class CheckError extends Error {
  constructor(public readonly errorClass: ErrorClass) {
    super(errorClass);
    this.name = 'CheckError';
  }
}

const TLS_CODES = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL|HOSTNAME_MISMATCH)/;

/** Map any thrown network error to a sanitised category. */
export function classifyError(err: unknown): ErrorClass {
  if (err instanceof CheckError) return err.errorClass;
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (code === 'TIMEOUT' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'TIMEOUT';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NODATA' || code === 'EAI_FAIL') return 'DNS';
  if (TLS_CODES.test(code)) return 'TLS';
  if (code.startsWith('HPE_')) return 'INVALID_RESPONSE';
  if (typeof err === 'object' && err && 'syscall' in err) return 'CONN_REFUSED'; // ECONNREFUSED/RESET/HOSTUNREACH…
  if (/^E[A-Z]+$/.test(code)) return 'CONN_REFUSED';
  return 'INVALID_RESPONSE';
}

/** Resolve + SSRF-validate a host. Blocked/invalid targets become BLOCKED_TARGET, resolution failures DNS. */
export async function pinTarget(host: string, allowPrivate: boolean, opts: CheckOptions = {}) {
  const bare = host.replace(/^\[|\]$/g, '');
  try {
    return await resolveSafeTarget(bare, { allowPrivate, resolver: opts.resolver });
  } catch (e) {
    if (isAppError(e) && /could not be resolved/.test(e.message)) throw new CheckError('DNS');
    throw new CheckError('BLOCKED_TARGET');
  }
}

/** A `lookup` that always answers with the pinned address (defeats DNS rebinding). */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  }) as unknown as LookupFunction;
}

function httpRequest(req: HttpTransportRequest): Promise<HttpTransportResponse> {
  const { url } = req;
  const isHttps = url.protocol === 'https:';
  const mod = isHttps ? https : http;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const started = performance.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };

    const r = mod.request({
      protocol: url.protocol,
      hostname, // Host header + TLS identity check use the real hostname
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { 'user-agent': 'GYNX-Status-Monitor/1.0', accept: '*/*', connection: 'close' },
      lookup: pinnedLookup(req.address, req.family),
      ...(isHttps && !isIP(hostname) ? { servername: hostname } : {}),
      agent: false,
    });

    const deadline = setTimeout(() => {
      const e = Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
      r.destroy(e);
      finish(() => reject(e));
    }, req.timeoutMs);

    r.on('error', (err) => finish(() => reject(err)));
    r.on('response', (res) => {
      const latencyMs = Math.round(performance.now() - started);
      const chunks: Buffer[] = [];
      let size = 0;
      const done = () =>
        finish(() =>
          resolve({
            statusCode: res.statusCode ?? 0,
            location: typeof res.headers.location === 'string' ? res.headers.location : undefined,
            body: Buffer.concat(chunks),
            latencyMs,
          }),
        );
      res.on('data', (chunk: Buffer) => {
        if (size >= req.maxBodyBytes) return;
        const take = chunk.subarray(0, req.maxBodyBytes - size);
        chunks.push(take);
        size += take.length;
        if (size >= req.maxBodyBytes) {
          done(); // stop reading — never buffer more than the cap
          res.destroy();
        }
      });
      res.on('end', done);
      res.on('error', () => done());
      res.on('close', done);
    });
    r.end();
  });
}

function tcpConnect(req: TcpTransportRequest): Promise<number> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: req.address, port: req.port, family: req.family });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      fn();
    };
    const deadline = setTimeout(() => finish(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }))), req.timeoutMs);
    socket.once('connect', () => finish(() => resolve(Math.round(performance.now() - started))));
    socket.once('error', (err) => finish(() => reject(err)));
  });
}

/** Real network transport (node:http/https/net with pinned addresses). */
export const nodeTransport: CheckTransport = { http: httpRequest, tcp: tcpConnect };
