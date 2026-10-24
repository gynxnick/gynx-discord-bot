import { classifyStatus, safeGet } from './http';
import { classifyError } from './transport';
import type { CheckAdapter, CheckResult } from '../types';

/** Build `<base>/api/v2/status.json` from a Statuspage base URL. */
export function statuspageUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/api/v2/status.json`;
}

/** Map an Atlassian Statuspage indicator to a check result (without latency). */
export function mapIndicator(indicator: unknown): Pick<CheckResult, 'ok' | 'degraded' | 'errorClass'> {
  switch (indicator) {
    case 'none':
      return { ok: true, degraded: false };
    case 'minor':
    case 'maintenance':
      return { ok: true, degraded: true };
    case 'major':
    case 'critical':
      return { ok: false, degraded: false, errorClass: 'UNEXPECTED_STATUS' };
    default:
      return { ok: false, degraded: false, errorClass: 'INVALID_RESPONSE' };
  }
}

export const statuspageAdapter: CheckAdapter = {
  kind: 'STATUSPAGE',
  async check(service, opts = {}) {
    try {
      const res = await safeGet(statuspageUrl(service.target ?? ''), service, opts);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return { ok: false, degraded: false, latencyMs: res.latencyMs, statusCode: res.statusCode, errorClass: classifyStatus(res.statusCode) };
      }
      let indicator: unknown;
      try {
        const json = JSON.parse(res.body.toString('utf8')) as { status?: { indicator?: unknown } };
        indicator = json?.status?.indicator;
      } catch {
        indicator = undefined;
      }
      return { ...mapIndicator(indicator), latencyMs: res.latencyMs, statusCode: res.statusCode };
    } catch (err) {
      return { ok: false, degraded: false, latencyMs: null, errorClass: classifyError(err) };
    }
  },
};
