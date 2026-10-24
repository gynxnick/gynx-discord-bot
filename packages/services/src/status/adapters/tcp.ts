import { isValidPort } from '@gynx/shared';
import { CheckError, classifyError, nodeTransport, pinTarget } from './transport';
import type { CheckAdapter } from '../types';

export const tcpAdapter: CheckAdapter = {
  kind: 'TCP',
  async check(service, opts = {}) {
    const transport = opts.transport ?? nodeTransport;
    try {
      if (!service.target || !service.port || !isValidPort(service.port)) throw new CheckError('BLOCKED_TARGET');
      const pinned = await pinTarget(service.target, service.allowPrivate, opts);
      const latencyMs = await transport.tcp({ address: pinned.address, family: pinned.family, port: service.port, timeoutMs: service.timeoutMs });
      const degraded = typeof service.degradedLatencyMs === 'number' && latencyMs > service.degradedLatencyMs;
      return { ok: true, degraded, latencyMs };
    } catch (err) {
      return { ok: false, degraded: false, latencyMs: null, errorClass: classifyError(err) };
    }
  },
};
