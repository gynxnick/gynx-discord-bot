import { errorResponse } from '@/server/api-core';
import { getDeps, getLogger } from '@/server/deps';
import { getEnv } from '@/server/env';
import { handleGithubWebhook } from '@/server/github-webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GitHub webhook receiver for the update feed. Deliberately NOT wrapped in
 * `apiRoute`: GitHub has no session or CSRF token; requests are authenticated
 * by the HMAC signature (GITHUB_WEBHOOK_SECRET) inside the handler.
 */
export async function POST(req: Request): Promise<Response> {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    getLogger().error({ err: { message: (err as Error).message } }, 'dashboard misconfigured');
    return errorResponse(500, 'CONFIG', 'The dashboard is not configured correctly.', 'config');
  }
  return handleGithubWebhook(req, {
    deps: getDeps(),
    guildId: env.DISCORD_GUILD_ID,
    secret: env.GITHUB_WEBHOOK_SECRET,
  });
}
