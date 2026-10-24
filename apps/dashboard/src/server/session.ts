import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { PermissionKey } from '@gynx/permissions';
import { audit, getGuildConfig, type Ctx } from '@gynx/services';
import { randomUUID } from 'node:crypto';
import { SESSION_COOKIE } from './auth/cookies';
import { ctxFromSession } from './api-core';
import { getDeps } from './deps';
import { getEnv } from './env';
import { loadSession, type SessionInfo } from './session-store';

/** Current dashboard session for this request (memoised per render), or null. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const env = getEnv();
  const lookup = await loadSession(getDeps(), env.DISCORD_GUILD_ID, token);
  return lookup.ok ? lookup.session : null;
});

export interface PageContext {
  session: SessionInfo;
  ctx: Ctx;
  timezone: string;
}

/** Require a signed-in staff session for a server component; redirects to /login otherwise. */
export const requireSession = cache(async (): Promise<PageContext> => {
  const session = await getSession();
  if (!session) {
    const hadCookie = (await cookies()).has(SESSION_COOKIE);
    redirect(hadCookie ? '/login?error=expired' : '/login');
  }
  const deps = getDeps();
  const ctx = ctxFromSession(deps, session, randomUUID());
  const cfg = await getGuildConfig(deps.db, session.guildId);
  return { session, ctx, timezone: cfg.timezone };
});

export type PagePermissionResult =
  ({ ok: true } & PageContext) | ({ ok: false; permission: PermissionKey } & PageContext);

/**
 * Page-level permission gate. Usage in a server component:
 *   const page = await requirePagePermission('audit.view');
 *   if (!page.ok) return <PermissionDenied permission={page.permission} />;
 * Denials are written to the security audit log.
 */
export async function requirePagePermission(
  permission: PermissionKey | readonly PermissionKey[],
  pageName?: string,
): Promise<PagePermissionResult> {
  const pc = await requireSession();
  const keys = (Array.isArray(permission) ? permission : [permission]) as PermissionKey[];
  if (keys.some((k) => pc.session.permissions.has(k))) return { ok: true, ...pc };
  await audit(pc.ctx, {
    action: 'dashboard.page.denied',
    result: 'DENIED',
    metadata: { required: keys, page: pageName },
  });
  return { ok: false, permission: keys[0]!, ...pc };
}
