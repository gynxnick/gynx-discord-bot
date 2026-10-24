/**
 * Content-Security-Policy for the dashboard. Scripts are allowed only with the
 * per-request nonce (Next.js applies it to its own scripts automatically when
 * it finds the nonce in the request's CSP header). Styles allow inline because
 * React/Next inject style attributes; no third-party origins are allowed apart
 * from Discord's avatar CDN (images) and Discord OAuth (form/redirect target).
 */
export function buildCsp(nonce: string, opts: { dev: boolean }): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'https://cdn.discordapp.com', 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(opts.dev ? ['ws:'] : [])],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https://discord.com'],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!opts.dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/** 128-bit random nonce, base64 encoded (works in the Edge runtime). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
