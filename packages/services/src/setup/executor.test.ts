import { describe, expect, it } from 'vitest';
import { classifyError } from './executor';

describe('setup error classification', () => {
  it('retries rate limits (respecting retry_after), 5xx and network errors', () => {
    expect(classifyError({ status: 429, rawError: { retry_after: 1.5 } })).toMatchObject({
      retryable: true,
      retryAfterMs: 1500,
    });
    expect(classifyError({ status: 503 }).retryable).toBe(true);
    expect(classifyError({ code: 'ECONNRESET', message: 'socket hang up' }).retryable).toBe(true);
    expect(classifyError({ name: 'AbortError' }).retryable).toBe(true);
  });

  it('treats permission, access and validation errors as permanent', () => {
    expect(classifyError({ status: 403, code: 50013, message: 'Missing Permissions' })).toMatchObject({
      retryable: false,
      message: expect.stringContaining('50013'),
    });
    expect(classifyError({ status: 403, code: 50001 }).retryable).toBe(false);
    expect(classifyError({ status: 400, code: 50035 }).retryable).toBe(false);
    expect(classifyError(new TypeError('bug')).retryable).toBe(false);
  });
});
