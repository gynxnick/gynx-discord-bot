/**
 * Free-text secret scrubbing for transcripts, diagnostic logs, abuse reports
 * and log lines. Patterns target well-known credential shapes and
 * `key=value` assignments of sensitive names.
 */
export const REDACTED = '[REDACTED]';

type Replacer = string | ((match: string, ...groups: string[]) => string);
interface Rule {
  name: string;
  pattern: RegExp;
  replace: Replacer;
}

const RULES: Rule[] = [
  // Discord bot/user tokens: base64(id).timestamp.hmac
  {
    name: 'discord-token',
    pattern: /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g,
    replace: REDACTED,
  },
  {
    name: 'discord-webhook',
    pattern: /https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/gi,
    replace: `https://discord.com/api/webhooks/${REDACTED}`,
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: REDACTED,
  },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: REDACTED },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, replace: REDACTED },
  { name: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },
  { name: 'stripe-key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replace: REDACTED },
  { name: 'api-key-sk', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replace: REDACTED },
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: `-----BEGIN PRIVATE KEY-----${REDACTED}-----END PRIVATE KEY-----`,
  },
  {
    name: 'bearer',
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, scheme) => `${scheme} ${REDACTED}`,
  },
  // URL credentials: scheme://user:pass@host
  {
    name: 'url-credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi,
    replace: (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`,
  },
  // key = value / key: value for sensitive names (covers e.g. rcon.password in server.properties)
  {
    name: 'assignment',
    pattern:
      /\b([\w.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|license[_-]?key)[\w.-]*)(\s*[:=]\s*)(["']?)([^\s"',;]{3,})\3/gi,
    replace: (_m, key, sep, quote) => `${key}${sep}${quote}${REDACTED}${quote}`,
  },
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: '[EMAIL]' },
];

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

export interface RedactOptions {
  /** Mask IPv4 addresses (default true; customer-facing output should never leak IPs). */
  maskIps?: boolean;
  /** Keep email addresses (default false). */
  keepEmails?: boolean;
}

export function redactSecrets(input: string, opts: RedactOptions = {}): string {
  let out = input;
  for (const rule of RULES) {
    if (rule.name === 'email' && opts.keepEmails) continue;
    out = out.replace(rule.pattern, rule.replace as (substring: string, ...args: string[]) => string);
  }
  if (opts.maskIps ?? true) out = out.replace(IPV4, '[IP]');
  return out;
}

/** True if the text appears to contain a credential. */
export function containsSecret(input: string): boolean {
  return redactSecrets(input, { maskIps: false, keepEmails: true }) !== input;
}

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|apikey|api_key|session/i;

/** Recursively redact values in a plain object (audit metadata, log context). */
export function redactObject<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value, { maskIps: false }) as T;
  if (Array.isArray(value)) return value.map((v) => redactObject(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactObject(v);
    }
    return out as T;
  }
  return value;
}
