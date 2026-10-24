import { DISCORD_ME_URL, DISCORD_REVOKE_URL, DISCORD_TOKEN_URL } from './oauth';

export interface DiscordIdentity {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const TIMEOUT_MS = 10_000;

/**
 * Exchange the authorization code for an access token, read the identity and
 * immediately revoke/discard the token. The token is never returned, stored or logged.
 */
export async function fetchDiscordIdentity(
  cfg: OAuthClientConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordIdentity> {
  const tokenRes = await fetchImpl(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed with HTTP ${tokenRes.status}`);
  const tokenJson = (await tokenRes.json()) as {
    access_token?: unknown;
    token_type?: unknown;
    scope?: unknown;
  };
  let accessToken = typeof tokenJson.access_token === 'string' ? tokenJson.access_token : null;
  if (!accessToken) throw new Error('token exchange returned no access token');

  try {
    const meRes = await fetchImpl(DISCORD_ME_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!meRes.ok) throw new Error(`users/@me failed with HTTP ${meRes.status}`);
    const me = (await meRes.json()) as {
      id?: unknown;
      username?: unknown;
      global_name?: unknown;
      avatar?: unknown;
    };
    if (typeof me.id !== 'string' || !/^\d{17,20}$/.test(me.id))
      throw new Error('users/@me returned an invalid id');
    return {
      id: me.id,
      username: typeof me.username === 'string' ? me.username : 'unknown',
      globalName: typeof me.global_name === 'string' ? me.global_name : null,
      avatar: typeof me.avatar === 'string' ? me.avatar : null,
    };
  } finally {
    // Best-effort revoke: we only needed the token once.
    const t = accessToken;
    accessToken = null;
    void fetchImpl(DISCORD_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: t,
        token_type_hint: 'access_token',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  }
}
