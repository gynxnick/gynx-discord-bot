import { CheckError, classifyError, nodeTransport, pinTarget } from './transport';
import { MAX_BODY_BYTES, type CheckAdapter, type CheckOptions, type CheckResult, type CheckTarget, type HttpTransportResponse } from '../types';

/** Parse an http(s) URL; anything else is a blocked target. */
export function parseHttpUrl(raw: string | null | undefined): URL {
  if (!raw) throw new CheckError('BLOCKED_TARGET');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CheckError('BLOCKED_TARGET');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new CheckError('BLOCKED_TARGET');
  if (url.username || url.password) throw new CheckError('BLOCKED_TARGET');
  return url;
}

/**
 * SSRF-safe GET: resolve + validate the host, connect to the pinned address,
 * follow at most ONE redirect and only to the same hostname (re-validated).
 */
export async function safeGet(
  rawUrl: string,
  service: Pick<CheckTarget, 'timeoutMs' | 'allowPrivate'>,
  opts: CheckOptions = {},
): Promise<HttpTransportResponse> {
  const transport = opts.transport ?? nodeTransport;
  let url = parseHttpUrl(rawUrl);
  const originalHost = url.hostname.toLowerCase();
  const deadlineAt = Date.now() + service.timeoutMs;
  let totalLatency = 0;

  for (let hop = 0; hop < 2; hop++) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new CheckError('TIMEOUT');
    const pinned = await pinTarget(url.hostname, service.allowPrivate, opts);
    const res = await transport.http({ url, address: pinned.address, family: pinned.family, timeoutMs: remaining, maxBodyBytes: MAX_BODY_BYTES });
    totalLatency += res.latencyMs;
    const isRedirect = res.statusCode >= 300 && res.statusCode < 400 && res.location;
    if (!isRedirect || hop === 1) return { ...res, latencyMs: totalLatency };
    let next: URL;
    try {
      next = parseHttpUrl(new URL(res.location!, url).toString());
    } catch {
      return { ...res, latencyMs: totalLatency };
    }
    if (next.hostname.toLowerCase() !== originalHost) return { ...res, latencyMs: totalLatency }; // never follow cross-host
    url = next;
  }
  /* c8 ignore next */
  throw new CheckError('INVALID_RESPONSE');
}

export function statusMatches(statusCode: number, expected: number | null | undefined): boolean {
  return expected ? statusCode === expected : statusCode >= 200 && statusCode < 300;
}

export function classifyStatus(statusCode: number): CheckResult['errorClass'] {
  if (statusCode >= 500 && statusCode < 600) return 'HTTP_5XX';
  if (statusCode >= 400 && statusCode < 500) return 'HTTP_4XX';
  return 'UNEXPECTED_STATUS';
}

export const httpAdapter: CheckAdapter = {
  kind: 'HTTP',
  async check(service, opts = {}) {
    try {
      const res = await safeGet(service.target ?? '', service, opts);
      const ok = statusMatches(res.statusCode, service.expectedStatus);
      if (!ok) return { ok: false, degraded: false, latencyMs: res.latencyMs, statusCode: res.statusCode, errorClass: classifyStatus(res.statusCode) };
      const degraded = typeof service.degradedLatencyMs === 'number' && res.latencyMs > service.degradedLatencyMs;
      return { ok: true, degraded, latencyMs: res.latencyMs, statusCode: res.statusCode };
    } catch (err) {
      return { ok: false, degraded: false, latencyMs: null, errorClass: classifyError(err) };
    }
  },
};
