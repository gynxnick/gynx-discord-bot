import { randomUUID } from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';
import { isNotFoundError, isUniqueViolation } from '@gynx/database';
import type { PermissionKey } from '@gynx/permissions';
import { audit, makeCtx, type Actor, type Ctx, type ServiceDeps } from '@gynx/services';
import { isAppError, type AppErrorCode } from '@gynx/shared';
import { checkCsrf, isSafeMethod } from './auth/csrf';
import { readCookie, SESSION_COOKIE } from './auth/cookies';
import { loadSession, type SessionInfo, type SessionStoreDeps } from './session-store';

/**
 * Framework-free core of the dashboard API wrapper. `apiRoute` (api.ts) binds
 * it to Next.js route handlers; tests call `executeApi` directly with a real
 * `Request`.
 */

export interface ApiErrorBody {
  error: {
    code: AppErrorCode | 'UNAUTHENTICATED' | 'CSRF' | 'BAD_REQUEST';
    message: string;
    issues?: ApiIssue[];
  };
}
export interface ApiIssue {
  path: string;
  message: string;
}

export interface ApiOptions<S extends ZodTypeAny | undefined> {
  /**
   * Required permission, checked before the handler (services re-check).
   * An array means "any of these" (for read routes shared by several roles).
   */
  permission?: PermissionKey | readonly PermissionKey[];
  /** Zod schema for the query string (GET) or JSON body (mutations). */
  schema?: S;
  /** Per-session limit. Defaults: 120/min for reads, 30/min for mutations. `false` disables. */
  rateLimit?: { limit: number; windowSeconds: number; key?: string } | false;
  /** Defaults to true for non-GET/HEAD methods. Mutations require CSRF + same origin. */
  mutation?: boolean;
  /** Allow requests without a session (health, auth). Default false. */
  public?: boolean;
}

export interface ApiHandlerArgs<I> {
  ctx: Ctx;
  session: SessionInfo;
  input: I;
  params: Record<string, string>;
  req: Request;
}

export type ApiHandler<I> = (args: ApiHandlerArgs<I>) => Promise<unknown>;

export interface ApiRuntime {
  deps: ServiceDeps & SessionStoreDeps;
  guildId: string;
  dashboardOrigin: string;
}

export const MAX_BODY_BYTES = 64 * 1024;

const jsonHeaders = (correlationId: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-correlation-id': correlationId,
  ...extra,
});

export function jsonResponse(
  status: number,
  body: unknown,
  correlationId: string,
  extra?: Record<string, string>,
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: jsonHeaders(correlationId, extra),
  });
}

export function errorResponse(
  status: number,
  code: ApiErrorBody['error']['code'],
  message: string,
  correlationId: string,
  extra?: { issues?: ApiIssue[]; headers?: Record<string, string> },
): Response {
  const body: ApiErrorBody = { error: { code, message, ...(extra?.issues ? { issues: extra.issues } : {}) } };
  return jsonResponse(status, body, correlationId, extra?.headers);
}

interface ZodLike {
  issues: Array<{ path: Array<string | number>; message: string }>;
}
const isZodError = (e: unknown): e is ZodLike =>
  e instanceof z.ZodError ||
  (typeof e === 'object' &&
    e !== null &&
    (e as Error).name === 'ZodError' &&
    Array.isArray((e as ZodLike).issues));

export const zodIssues = (e: ZodLike): ApiIssue[] =>
  e.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));

/**
 * Map any thrown value to a safe response. AppErrors keep their user-safe
 * message; everything else becomes a generic 500 (details only in logs).
 */
export function mapError(e: unknown, correlationId: string, log: ServiceDeps['log']): Response {
  if (isAppError(e)) {
    const headers: Record<string, string> = {};
    if (e.code === 'RATE_LIMITED') {
      const retry = Number(
        (e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60,
      );
      headers['retry-after'] = String(Math.max(1, Math.ceil(retry)));
    }
    if (e.httpStatus >= 500) log.error({ err: e, correlationId }, 'api app error');
    return errorResponse(e.httpStatus, e.code, e.message, correlationId, { headers });
  }
  if (isZodError(e)) {
    return errorResponse(400, 'VALIDATION', 'Some fields are invalid.', correlationId, {
      issues: zodIssues(e),
    });
  }
  if (isUniqueViolation(e)) return errorResponse(409, 'CONFLICT', 'That already exists.', correlationId);
  if (isNotFoundError(e)) return errorResponse(404, 'NOT_FOUND', 'Not found.', correlationId);
  log.error({ err: e, correlationId }, 'unhandled dashboard api error');
  return errorResponse(
    500,
    'INTERNAL',
    'Something went wrong on our side. Reference: ' + correlationId,
    correlationId,
  );
}

export function actorFromSession(s: SessionInfo): Actor {
  return {
    userId: s.userId,
    roleIds: s.roleIds,
    permissions: s.permissions,
    isSystem: false,
    source: 'dashboard',
    displayName: s.username,
  };
}

export function ctxFromSession(deps: ServiceDeps, s: SessionInfo, correlationId: string): Ctx {
  return makeCtx(deps, s.guildId, actorFromSession(s), correlationId);
}

async function readInput(
  req: Request,
  mutation: boolean,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const query: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams) if (v !== '') query[k] = v;
  if (!mutation) return { ok: true, value: query };

  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY_BYTES) return { ok: false, message: 'Request body is too large.' };
  const text = await req.text();
  if (text.length === 0) return { ok: true, value: query };
  if (text.length > MAX_BODY_BYTES) return { ok: false, message: 'Request body is too large.' };
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('application/json'))
    return { ok: false, message: 'Expected application/json.' };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: 'Malformed JSON body.' };
  }
}

export async function executeApi<S extends ZodTypeAny | undefined>(
  opts: ApiOptions<S>,
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>,
  req: Request,
  params: Record<string, string>,
  rt: ApiRuntime,
): Promise<Response> {
  const correlationId = randomUUID();
  const { deps } = rt;
  const mutation = opts.mutation ?? !isSafeMethod(req.method);
  try {
    const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
    const lookup = await loadSession(deps, rt.guildId, token);
    if (!lookup.ok) return errorResponse(401, 'UNAUTHENTICATED', 'Please sign in again.', correlationId);
    const session = lookup.session;
    const ctx = ctxFromSession(deps, session, correlationId);

    if (mutation) {
      const csrf = checkCsrf({
        headers: req.headers,
        sessionCsrfToken: session.csrfToken,
        allowedOrigin: rt.dashboardOrigin,
      });
      if (!csrf.ok) {
        await audit(ctx, {
          action: 'dashboard.csrf.rejected',
          result: 'DENIED',
          metadata: { reason: csrf.reason, method: req.method, path: new URL(req.url).pathname },
        });
        return errorResponse(
          403,
          'CSRF',
          'Request could not be verified. Reload the page and try again.',
          correlationId,
        );
      }
    }

    const required =
      opts.permission === undefined
        ? []
        : Array.isArray(opts.permission)
          ? opts.permission
          : [opts.permission];
    if (required.length > 0 && !required.some((k) => session.permissions.has(k))) {
      await audit(ctx, {
        action: 'dashboard.permission.denied',
        result: 'DENIED',
        metadata: { required: opts.permission, method: req.method, path: new URL(req.url).pathname },
      });
      return errorResponse(403, 'FORBIDDEN', 'You do not have permission to do that.', correlationId);
    }

    if (opts.rateLimit !== false) {
      const rl =
        opts.rateLimit ?? (mutation ? { limit: 30, windowSeconds: 60 } : { limit: 120, windowSeconds: 60 });
      const key = `dashboard:${session.id}:${rl.key ?? (mutation ? 'write' : 'read')}`;
      const r = await deps.rateLimiter.consume(key, rl.limit, rl.windowSeconds);
      if (!r.allowed) {
        return errorResponse(
          429,
          'RATE_LIMITED',
          `You're doing that too often. Try again in ${r.retryAfterSeconds}s.`,
          correlationId,
          {
            headers: { 'retry-after': String(r.retryAfterSeconds) },
          },
        );
      }
    }

    const raw = await readInput(req, mutation);
    if (!raw.ok) return errorResponse(400, 'BAD_REQUEST', raw.message, correlationId);
    let input: unknown = raw.value;
    if (opts.schema) {
      const parsed = opts.schema.safeParse(raw.value);
      if (!parsed.success) {
        return errorResponse(400, 'VALIDATION', 'Some fields are invalid.', correlationId, {
          issues: zodIssues(parsed.error),
        });
      }
      input = parsed.data;
    }

    const result = await handler({ ctx, session, input: input as never, params, req });
    if (result instanceof Response) {
      result.headers.set('x-correlation-id', correlationId);
      result.headers.set('cache-control', 'no-store');
      return result;
    }
    return jsonResponse(200, result === undefined ? { ok: true } : result, correlationId);
  } catch (e) {
    return mapError(e, correlationId, deps.log);
  }
}
