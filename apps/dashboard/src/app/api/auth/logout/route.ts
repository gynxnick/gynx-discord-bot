import { audit } from '@gynx/services';
import { apiRoute } from '@/server/api';
import { isProduction } from '@/server/env';
import { clearedCookieOptions, serializeCookie, SESSION_COOKIE } from '@/server/auth/cookies';
import { revokeSession } from '@/server/session-store';

export const dynamic = 'force-dynamic';

/** Revoke the current session server-side (POST + CSRF). */
export const POST = apiRoute({ mutation: true, rateLimit: false }, async ({ ctx, session }) => {
  await revokeSession(ctx.db, session.id, ctx.now());
  await audit(ctx, { action: 'auth.logout', targetType: 'DashboardSession', targetId: session.id });
  const res = Response.json({ ok: true });
  res.headers.append('set-cookie', serializeCookie(SESSION_COOKIE, '', clearedCookieOptions(isProduction())));
  return res;
});
