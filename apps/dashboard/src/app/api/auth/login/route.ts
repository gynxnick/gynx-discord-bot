import { getDeps, getLogger } from '@/server/deps';
import { getEnv, isProduction } from '@/server/env';
import { oauthCookieOptions, serializeCookie } from '@/server/auth/cookies';
import {
  OAUTH_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  buildAuthorizeUrl,
  callbackUrl,
  createPkcePair,
  randomUrlToken,
  safeReturnTo,
  signOAuthState,
} from '@/server/auth/oauth';
import { clientIp, redirectResponse } from '@/server/request';

export const dynamic = 'force-dynamic';

/** Start Discord OAuth2 (scope `identify`) with state + PKCE (S256). */
export async function GET(req: Request): Promise<Response> {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    getLogger().error({ err: { message: (err as Error).message } }, 'dashboard misconfigured');
    return redirectResponse('/login?error=unavailable');
  }
  const deps = getDeps();
  const rl = await deps.rateLimiter.consume(`dashboard:login:${clientIp(req.headers)}`, 20, 60);
  if (!rl.allowed) return redirectResponse('/login?error=rate_limited');

  const url = new URL(req.url);
  const { verifier, challenge } = createPkcePair();
  const state = randomUrlToken(24);
  const cookie = signOAuthState(env.SESSION_SECRET, {
    state,
    verifier,
    exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
    returnTo: safeReturnTo(url.searchParams.get('next')),
  });
  const authorize = buildAuthorizeUrl({
    clientId: env.DISCORD_OAUTH_CLIENT_ID,
    redirectUri: callbackUrl(env.DASHBOARD_URL),
    state,
    challenge,
  });
  return redirectResponse(authorize, [
    serializeCookie(OAUTH_COOKIE, cookie, oauthCookieOptions(isProduction(), OAUTH_STATE_TTL_SECONDS)),
  ]);
}
