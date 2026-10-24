/**
 * Typed application errors. Every layer (bot, dashboard API, worker) maps these
 * to safe user-facing messages; `cause` and `details` are for internal logs only.
 */
export type AppErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_STATE'
  | 'MODULE_DISABLED'
  | 'INTEGRATION'
  | 'CONFIG'
  | 'INTERNAL';

const HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_STATE: 409,
  MODULE_DISABLED: 403,
  INTEGRATION: 502,
  CONFIG: 500,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    /** Safe to show to end users. */
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  /** Permanent failures (validation, permissions, state) are never retried by job runners. */
  get retryable(): boolean {
    return this.code === 'INTEGRATION' || this.code === 'INTERNAL' || this.code === 'RATE_LIMITED';
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} was not found.`);
export const forbidden = (msg = 'You do not have permission to do that.') => new AppError('FORBIDDEN', msg);
export const invalidState = (msg: string) => new AppError('INVALID_STATE', msg);
export const conflict = (msg: string) => new AppError('CONFLICT', msg);
export const validation = (msg: string, details?: Record<string, unknown>) =>
  new AppError('VALIDATION', msg, details);
export const moduleDisabled = (module: string) =>
  new AppError('MODULE_DISABLED', `The ${module} module is disabled on this server.`);
export const rateLimited = (retryAfterSeconds: number) =>
  new AppError('RATE_LIMITED', `You're doing that too often. Try again in ${retryAfterSeconds}s.`, {
    retryAfterSeconds,
  });

/** Convert anything thrown into a user-safe message (never a stack trace). */
export function toSafeMessage(e: unknown): string {
  if (isAppError(e)) return e.message;
  return 'Something went wrong on our side. The team has been notified.';
}
