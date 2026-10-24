import type { AdapterRegistry } from '../types';
import { httpAdapter } from './http';
import { statuspageAdapter } from './statuspage';
import { tcpAdapter } from './tcp';

export { httpAdapter, parseHttpUrl, safeGet, statusMatches, classifyStatus } from './http';
export { tcpAdapter } from './tcp';
export { statuspageAdapter, statuspageUrl, mapIndicator } from './statuspage';
export { CheckError, classifyError, nodeTransport, pinTarget } from './transport';

/** Default adapters. MANUAL services have no adapter: their state is set by staff/incidents. */
export const defaultAdapters: AdapterRegistry = {
  HTTP: httpAdapter,
  TCP: tcpAdapter,
  STATUSPAGE: statuspageAdapter,
};
