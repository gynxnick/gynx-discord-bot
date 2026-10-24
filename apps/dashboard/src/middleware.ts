import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, createNonce } from './lib/csp';

/**
 * Edge middleware: attaches a nonce-based CSP to every document/API response.
 * Authentication is NOT decided here — every page and API route re-validates
 * the session server-side against the database.
 */
export function middleware(req: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== 'production' });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
