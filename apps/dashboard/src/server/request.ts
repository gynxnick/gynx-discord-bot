/** Best-effort client IP for rate limiting only (never for authorization). */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  const ip = first || headers.get('x-real-ip')?.trim() || 'unknown';
  return ip.slice(0, 64);
}

export function redirectResponse(location: string, setCookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(null, { status: 303, headers });
}
