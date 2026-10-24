import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '@gynx/config';
import { Prisma } from '@gynx/database';
import { AppError, MemoryRateLimiter, rateLimited } from '@gynx/shared';
import { executeApi, mapError, type ApiRuntime } from './api-core';

const log = createLogger('test', 'silent');

async function body(res: Response) {
  return JSON.parse(await res.text()) as { error: { code: string; message: string; issues?: unknown[] } };
}

describe('mapError', () => {
  it('maps AppError codes to HTTP status with the safe message', async () => {
    const cases: Array<[AppError, number]> = [
      [new AppError('VALIDATION', 'Bad input'), 400],
      [new AppError('FORBIDDEN', 'Nope'), 403],
      [new AppError('NOT_FOUND', 'Report was not found.'), 404],
      [new AppError('CONFLICT', 'Taken'), 409],
      [new AppError('INVALID_STATE', 'Closed'), 409],
      [new AppError('MODULE_DISABLED', 'Disabled'), 403],
      [new AppError('INTEGRATION', 'Discord down'), 502],
    ];
    for (const [err, status] of cases) {
      const res = mapError(err, 'cid', log);
      expect(res.status).toBe(status);
      expect((await body(res)).error).toEqual({ code: err.code, message: err.message });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('adds Retry-After for rate limits', () => {
    const res = mapError(rateLimited(42), 'cid', log);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
  });

  it('maps Zod errors to 400 with field issues', async () => {
    const parsed = z.object({ status: z.enum(['A']) }).safeParse({ status: 'B' });
    const res = mapError(parsed.error, 'cid', log);
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.error.code).toBe('VALIDATION');
    expect(b.error.issues).toEqual([expect.objectContaining({ path: 'status' })]);
  });

  it('maps Prisma unique violations to 409', () => {
    const e = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
    });
    expect(mapError(e, 'cid', log).status).toBe(409);
  });

  it('hides unknown errors behind a generic 500 and logs them with the correlation id', async () => {
    const spy = vi.fn();
    const fakeLog = { ...log, error: spy } as unknown as typeof log;
    const res = mapError(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
      'cid-123',
      fakeLog,
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await body(res));
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('at ');
    expect(text).toContain('cid-123');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'cid-123' }),
      expect.any(String),
    );
  });
});

describe('executeApi without a session', () => {
  const rt = {
    deps: {
      db: {} as never,
      discord: {} as never,
      log,
      now: () => new Date(),
      rateLimiter: new MemoryRateLimiter(),
    },
    guildId: '123456789012345678',
    dashboardOrigin: 'https://dash.gynx.gg',
  } as unknown as ApiRuntime;

  it('returns 401 JSON and never calls the handler', async () => {
    const handler = vi.fn();
    const res = await executeApi(
      { permission: 'audit.view' },
      handler,
      new Request('https://dash.gynx.gg/api/security/audit'),
      {},
      rt,
    );
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe('UNAUTHENTICATED');
    expect(handler).not.toHaveBeenCalled();
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });
});
