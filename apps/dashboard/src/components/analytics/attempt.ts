import { isAppError } from '@gynx/shared';

/**
 * Run a service call for a server component. AppErrors (module disabled, rate
 * limited, not found …) carry user-safe messages and are returned for inline
 * display; anything else propagates to the route's error boundary.
 */
export async function attempt<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isAppError(e)) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}
