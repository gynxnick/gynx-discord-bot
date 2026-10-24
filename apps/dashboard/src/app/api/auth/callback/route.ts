import { randomUUID } from 'node:crypto';
import { ensureGuild } from '@gynx/database';
import { audit, makeCtx, memberActor } from '@gynx/services';
import { getDeps, getLogger } from '@/server/deps';
import { getEnv, isProduction } from '@/server/env';
import {
  clearedCookieOptions,
  readCookie,
  serializeCookie,
  sessionCookieOptions,
  SESSION_COOKIE,
} from '@/server/auth/cookies';
import { fetchDiscordIdentity } from '@/server/auth/discord-oauth';
import { OAUTH_COOKIE, callbackUrl, verifyOAuthState, type LoginErrorCode } from '@/server/auth/oauth';
import { authorizeMember, createSession, purgeOldSessions } from '@/server/session-store';
import { clientIp, redirectResponse } from '@/server/request';

export const dynamic = 'force-dynamic';

/**
 * OAuth2 callback: verify state/PKCE, exchange the code, check guild
 * membership + `dashboard.access`, then create a server-side session.
 * Codes and tokens are never logged, stored or put in audit metadata.
 */
export async function GET(req: Request): Promise<Response> {
  const log = getLogger();
  const prod = isProduction();
  const clearOauth = serializeCookie(OAUTH_COOKIE, '', clearedCookieOptions(prod, '/api/auth'));
  const fail = (code: LoginErrorCode) => redirectResponse(`/login?error=${code}`, [clearOauth]);

  let env;
  try {
    env = getEnv();
  } catch (err) {
    log.error({ err: { message: (err as Error).message } }, 'dashboard misconfigured');
    return fail('unavailable');
  }
  const deps = getDeps();
  const rl = await deps.rateLimiter.consume(`dashboard:callback:${clientIp(req.headers)}`, 20, 60);
  if (!rl.allowed) return fail('rate_limited');

  const url = new URL(req.url);
  if (url.searchParams.get('error')) return fail('cancelled');
  const code = url.searchParams.get('code');
  const verified = verifyOAuthState(
    env.SESSION_SECRET,
    readCookie(req.headers.get('cookie'), OAUTH_COOKIE),
    url.searchParams.get('state'),
    new Date(),
  );
  if (!verified.ok) {
    log.warn({ reason: verified.reason }, 'oauth state verification failed');
    return fail('state');
  }
  if (!code || code.length > 512) return fail('state');

  let identity;
  try {
    identity = await fetchDiscordIdentity(
      {
        clientId: env.DISCORD_OAUTH_CLIENT_ID,
        clientSecret: env.DISCORD_OAUTH_CLIENT_SECRET,
        redirectUri: callbackUrl(env.DASHBOARD_URL),
      },
      code,
      verified.payload.verifier,
    );
  } catch (err) {
    log.warn({ err: { message: (err as Error).message } }, 'discord oauth exchange failed');
    return fail('oauth');
  }

  const guildId = env.DISCORD_GUILD_ID;
  const correlationId = randomUUID();
  const auth = await authorizeMember(deps, guildId, identity.id, identity.globalName ?? identity.username);
  if (!auth.ok) {
    if (auth.reason !== 'unavailable') {
      await ensureGuild(deps.db, guildId).catch(() => undefined);
      await audit(makeCtx(deps, guildId, memberActor(identity.id, [], 'dashboard'), correlationId), {
        action: 'auth.login',
        result: 'DENIED',
        metadata: { reason: auth.reason },
      });
    }
    return fail(auth.reason);
  }

  await ensureGuild(deps.db, guildId, auth.guildName);
  const { token, session } = await createSession(
    deps.db,
    {
      userId: identity.id,
      guildId,
      username: auth.username,
      avatar: auth.avatar ?? identity.avatar,
      roleIds: auth.roleIds,
      permissions: auth.actor.permissions,
      ttlHours: env.SESSION_TTL_HOURS,
      userAgent: req.headers.get('user-agent'),
    },
    new Date(),
  );
  await audit(makeCtx(deps, guildId, auth.actor, correlationId), {
    action: 'auth.login',
    targetType: 'DashboardSession',
    targetId: session.id,
    metadata: { permissionCount: auth.actor.permissions.size },
  });
  void purgeOldSessions(deps.db, new Date()).catch(() => undefined);

  return redirectResponse(verified.payload.returnTo, [
    clearOauth,
    serializeCookie(SESSION_COOKIE, token, sessionCookieOptions(prod, env.SESSION_TTL_HOURS)),
  ]);
}
