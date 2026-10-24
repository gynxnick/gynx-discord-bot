import type { MonitoredService, ServiceCheckKind } from '@gynx/database';

/**
 * Sanitised failure categories. These are the ONLY failure details ever
 * persisted (HealthCheck.errorClass) — raw error messages, hostnames and IP
 * addresses never leave the adapter.
 */
export const ERROR_CLASSES = [
  'TIMEOUT',
  'DNS',
  'CONN_REFUSED',
  'TLS',
  'HTTP_4XX',
  'HTTP_5XX',
  'UNEXPECTED_STATUS',
  'BLOCKED_TARGET',
  'INVALID_RESPONSE',
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export interface CheckResult {
  ok: boolean;
  /** Reachable but slow / partially impaired. Only meaningful when ok=true. */
  degraded: boolean;
  latencyMs: number | null;
  statusCode?: number;
  errorClass?: ErrorClass;
}

/** The subset of a MonitoredService an adapter needs. */
export type CheckTarget = Pick<
  MonitoredService,
  'id' | 'kind' | 'target' | 'port' | 'expectedStatus' | 'timeoutMs' | 'degradedLatencyMs' | 'allowPrivate'
>;

export interface HttpTransportRequest {
  url: URL;
  /** Pinned, SSRF-validated address. The transport must connect to this address only. */
  address: string;
  family: 4 | 6;
  timeoutMs: number;
  maxBodyBytes: number;
}

export interface HttpTransportResponse {
  statusCode: number;
  location?: string;
  body: Buffer;
  /** ms from request start until response headers were received. */
  latencyMs: number;
}

export interface TcpTransportRequest {
  address: string;
  family: 4 | 6;
  port: number;
  timeoutMs: number;
}

/** Network transport, injectable so tests never touch the real network. */
export interface CheckTransport {
  http(req: HttpTransportRequest): Promise<HttpTransportResponse>;
  /** Resolves with the connect latency (ms). */
  tcp(req: TcpTransportRequest): Promise<number>;
}

export interface CheckOptions {
  transport?: CheckTransport;
  /** Injectable DNS resolver (passed to resolveSafeTarget). */
  resolver?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface CheckAdapter {
  kind: ServiceCheckKind;
  check(service: CheckTarget, opts?: CheckOptions): Promise<CheckResult>;
}

export type AdapterRegistry = Partial<Record<ServiceCheckKind, CheckAdapter>>;

/** Max response body read by any adapter. */
export const MAX_BODY_BYTES = 64 * 1024;
