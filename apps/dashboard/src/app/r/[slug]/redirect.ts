import { createHash } from 'node:crypto';
import type { Db } from '@gynx/database';
import { marketing } from '@gynx/services';
import type { RateLimiter } from '@gynx/shared';

/** Base62, 4–32 characters (the service additionally enforces its exact slug shape). */
export const REDIRECT_SLUG_RE = /^[0-9A-Za-z]{4,32}$/;
export const REDIRECT_LIMIT = { limit: 30, windowSeconds: 60 } as const;

const baseHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
};

const page = (status: number, title: string, message: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
      `<body style="background:#05060a;color:#e6e8ee;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">` +
      `<main style="text-align:center;padding:16px"><h1 style="font-size:20px">${title}</h1><p style="color:#9aa3b2">${message}</p></main></body></html>`,
    { status, headers: { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' } },
  );

/**
 * Client address for rate limiting only. It is hashed before use as a limiter
 * key and is never logged or stored.
 */
export function clientKey(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || headers.get('x-real-ip')?.trim() || 'unknown';
  return createHash('sha256').update(ip).digest('base64url').slice(0, 22);
}

/**
 * Public tracked-link redirect: validate the slug, rate limit per client
 * (prevents click inflation), count the click and 302 to the target. Unknown or
 * inactive links get a 404 page. Nothing about the visitor is recorded.
 */
export async function handleRedirect(
  req: Request,
  slug: string,
  deps: { db: Db; rateLimiter: RateLimiter },
): Promise<Response> {
  if (!REDIRECT_SLUG_RE.test(slug))
    return page(404, 'Link not found', 'This link does not exist or is no longer active.');
  const rl = await deps.rateLimiter.consume(
    `redirect:${clientKey(req.headers)}`,
    REDIRECT_LIMIT.limit,
    REDIRECT_LIMIT.windowSeconds,
  );
  if (!rl.allowed) {
    const res = page(429, 'Too many requests', 'Please wait a moment and try the link again.');
    res.headers.set('retry-after', String(rl.retryAfterSeconds));
    return res;
  }
  const target = await marketing.resolveTrackedLink(deps.db, slug);
  if (!target) return page(404, 'Link not found', 'This link does not exist or is no longer active.');
  return new Response(null, { status: 302, headers: { ...baseHeaders, location: target } });
}
