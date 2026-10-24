/** Pure mapping between the monitored-service dialog and the API payload (client-safe). */

export const SERVICE_KINDS = ['HTTP', 'TCP', 'STATUSPAGE', 'MANUAL'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export interface ServiceFormValues {
  name: string;
  slug: string;
  region: string;
  description: string;
  kind: ServiceKind;
  target: string;
  port: string;
  expectedStatus: string;
  timeoutMs: string;
  degradedLatencyMs: string;
  failureThreshold: string;
  recoveryThreshold: string;
  allowPrivate: boolean;
  enabled: boolean;
  public: boolean;
  sortOrder: string;
}

/** Fields of a service as the dashboard API returns them (subset of ServiceView). */
export interface ServiceLike {
  name: string;
  slug: string;
  region: string | null;
  description: string | null;
  kind: ServiceKind;
  target: string | null;
  port: number | null;
  expectedStatus: number | null;
  timeoutMs: number;
  degradedLatencyMs: number | null;
  failureThreshold: number | null;
  recoveryThreshold: number | null;
  allowPrivate: boolean;
  enabled: boolean;
  public: boolean;
  sortOrder: number;
}

export type ServicePayload = Partial<{
  name: string;
  slug: string;
  region: string | null;
  description: string | null;
  kind: ServiceKind;
  target: string | null;
  port: number | null;
  expectedStatus: number | null;
  timeoutMs: number;
  degradedLatencyMs: number | null;
  failureThreshold: number | null;
  recoveryThreshold: number | null;
  allowPrivate: boolean;
  enabled: boolean;
  public: boolean;
  sortOrder: number;
}>;

export const emptyServiceForm = (): ServiceFormValues => ({
  name: '',
  slug: '',
  region: '',
  description: '',
  kind: 'HTTP',
  target: '',
  port: '',
  expectedStatus: '',
  timeoutMs: '5000',
  degradedLatencyMs: '',
  failureThreshold: '',
  recoveryThreshold: '',
  allowPrivate: false,
  enabled: true,
  public: true,
  sortOrder: '0',
});

const s = (n: number | null) => (n === null ? '' : String(n));

export function serviceToForm(v: ServiceLike): ServiceFormValues {
  return {
    name: v.name,
    slug: v.slug,
    region: v.region ?? '',
    description: v.description ?? '',
    kind: v.kind,
    target: v.target ?? '',
    port: s(v.port),
    expectedStatus: s(v.expectedStatus),
    timeoutMs: String(v.timeoutMs),
    degradedLatencyMs: s(v.degradedLatencyMs),
    failureThreshold: s(v.failureThreshold),
    recoveryThreshold: s(v.recoveryThreshold),
    allowPrivate: v.allowPrivate,
    enabled: v.enabled,
    public: v.public,
    sortOrder: String(v.sortOrder),
  };
}

/** "my Service!" → "my-service". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const NULLABLE_INTS = [
  'port',
  'expectedStatus',
  'degradedLatencyMs',
  'failureThreshold',
  'recoveryThreshold',
] as const;

/**
 * Build the create (all fields) or update (changed fields only) payload.
 * Returns field errors for obviously malformed numbers; range checks are the API's job.
 */
export function servicePayload(
  form: ServiceFormValues,
  initial?: ServiceLike,
): { payload: ServicePayload; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const full: Required<ServicePayload> = {
    name: form.name.trim(),
    slug: form.slug.trim().toLowerCase(),
    region: form.region.trim() || null,
    description: form.description.trim() || null,
    kind: form.kind,
    target: form.kind === 'MANUAL' ? null : form.target.trim() || null,
    port: null,
    expectedStatus: null,
    timeoutMs: 5000,
    degradedLatencyMs: null,
    failureThreshold: null,
    recoveryThreshold: null,
    allowPrivate: form.allowPrivate,
    enabled: form.enabled,
    public: form.public,
    sortOrder: 0,
  };
  if (!full.name) errors.name = 'Name is required.';
  if (!full.slug) errors.slug = 'Slug is required.';
  if (form.kind !== 'MANUAL' && !full.target)
    errors.target = form.kind === 'TCP' ? 'A host is required.' : 'A URL is required.';

  const int = (key: string, raw: string): number | null | undefined => {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isInteger(n)) {
      errors[key] = 'Enter a whole number.';
      return undefined;
    }
    return n;
  };
  for (const k of NULLABLE_INTS) {
    const v = int(k, form[k]);
    if (v !== undefined) full[k] = v;
  }
  if (form.kind !== 'TCP') full.port = null;
  else if (full.port === null && !errors.port) errors.port = 'A port is required for TCP checks.';
  if (form.kind === 'MANUAL' || form.kind === 'TCP') full.expectedStatus = null;
  for (const k of ['timeoutMs', 'sortOrder'] as const) {
    const v = int(k, form[k]);
    if (v === null) errors[k] = 'Required.';
    else if (v !== undefined) full[k] = v;
  }

  if (!initial) return { payload: full, errors };
  const payload: ServicePayload = {};
  for (const [k, v] of Object.entries(full) as Array<[keyof ServicePayload, unknown]>) {
    if ((initial as unknown as Record<string, unknown>)[k] !== v) (payload as Record<string, unknown>)[k] = v;
  }
  return { payload, errors };
}
