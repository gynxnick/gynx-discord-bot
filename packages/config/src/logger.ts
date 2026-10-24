import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Paths whose values must never reach logs. Pino censors these structurally;
 * free-text secrets are additionally scrubbed by `redactSecrets` in @gynx/shared.
 */
export const REDACT_PATHS = [
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'password',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
  'code',
  'sessionId',
  'apiKey',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.access_token',
  '*.refresh_token',
  '*.password',
  '*.secret',
  '*.clientSecret',
  '*.authorization',
  '*.cookie',
  '*.code',
  '*.sessionId',
  '*.apiKey',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

export function createLogger(component: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  const options: LoggerOptions = {
    level,
    base: { component },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
  };
  return pino(options);
}

export type { Logger };
