import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@gynx/database';
import { isModuleEnabled, updates, type ServiceDeps } from '@gynx/services';
import { clientIp } from './request';

/**
 * POST /api/webhooks/github — GitHub → update feed.
 *
 * Framework-free (no `server-only`, no session) so integration tests call it
 * with a real `Request`. Authenticated ONLY by the HMAC signature
 * (X-Hub-Signature-256); there is no session or CSRF check by design.
 * The body and the secret are never logged.
 *
 * Status codes: 503 not configured · 429 rate limited · 413 too large ·
 * 401 bad/missing signature · 400 malformed · 415 not JSON · 200 ping/queued/duplicate ·
 * 202 accepted but ignored (with a reason).
 */

export const MAX_WEBHOOK_BYTES = 1024 * 1024;
/** Per source IP. GitHub sends from a small pool of addresses; bursts of pushes stay well under this. */
export const WEBHOOK_RATE_LIMIT = { limit: 120, windowSeconds: 60 };

export interface WebhookRuntime {
  deps: Pick<ServiceDeps, 'log' | 'now' | 'rateLimiter'> & { db: PrismaClient };
  guildId: string;
  secret: string | undefined;
}

const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const fail = (status: number, message: string, extra?: Record<string, string>) =>
  json(status, { ok: false, error: message }, extra);
const ignored = (reason: string) => json(202, { ok: true, ignored: true, reason });

/** Read at most `max` bytes; null when the body is larger. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const DELIVERY_ID = /^[A-Za-z0-9-]{8,100}$/;
const EVENT_NAME = /^[a-z_]{1,50}$/;

export async function handleGithubWebhook(req: Request, rt: WebhookRuntime): Promise<Response> {
  const { deps } = rt;
  const correlationId = randomUUID();
  if (!rt.secret) return fail(503, 'GitHub webhooks are not configured (GITHUB_WEBHOOK_SECRET is unset).');

  const ip = clientIp(req.headers);
  const rl = await deps.rateLimiter.consume(
    `webhook:github:${ip}`,
    WEBHOOK_RATE_LIMIT.limit,
    WEBHOOK_RATE_LIMIT.windowSeconds,
  );
  if (!rl.allowed) return fail(429, 'Too many requests.', { 'retry-after': String(rl.retryAfterSeconds) });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return fail(413, 'Payload too large.');
  const raw = await readCapped(req, MAX_WEBHOOK_BYTES);
  if (!raw) return fail(413, 'Payload too large.');

  if (!updates.verifyGithubSignature(rt.secret, raw, req.headers.get('x-hub-signature-256'))) {
    deps.log.warn({ correlationId, ip }, 'github webhook: missing or invalid signature');
    return fail(401, 'Invalid signature.');
  }

  const event = (req.headers.get('x-github-event') ?? '').trim();
  const deliveryId = (req.headers.get('x-github-delivery') ?? '').trim();
  if (!EVENT_NAME.test(event)) return fail(400, 'Missing X-GitHub-Event header.');
  if (event === 'ping') return json(200, { ok: true });
  if (!DELIVERY_ID.test(deliveryId)) return fail(400, 'Missing X-GitHub-Delivery header.');
  if (event !== 'push' && event !== 'release') return ignored(`event ${event} is not used`);

  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/json'))
    return fail(415, 'Set the webhook content type to application/json.');

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return fail(400, 'Malformed JSON.');
  }

  const meta = { correlationId, deliveryId, event };
  try {
    const ref = updates.repoRefSchema.safeParse(body);
    if (!ref.success) return fail(400, 'Payload has no repository.');
    const fullName = updates.normaliseRepoName(ref.data.repository.full_name);
    if (!(await isModuleEnabled(deps.db, rt.guildId, 'updates')))
      return ignored('update feed module disabled');
    const repo = await updates.findTrackedRepo(deps.db, rt.guildId, fullName);
    if (!repo) {
      deps.log.info({ ...meta, repo: fullName }, 'github webhook: repository not tracked');
      return ignored('repository not tracked or disabled');
    }

    let classified: { kind: 'push' | 'release'; ref: string; data: updates.UpdateEventData };
    if (event === 'push') {
      const p = updates.pushPayloadSchema.safeParse(body);
      if (!p.success) return fail(400, 'Unexpected push payload.');
      const c = updates.classifyPush(p.data, repo.branch);
      if (!c.ok) return ignored(c.reason);
      classified = { kind: 'push', ref: c.value.branch, data: c.value.data };
    } else {
      const p = updates.releasePayloadSchema.safeParse(body);
      if (!p.success) return fail(400, 'Unexpected release payload.');
      const c = updates.classifyRelease(p.data);
      if (!c.ok) return ignored(c.reason);
      classified = { kind: 'release', ref: c.value.tag, data: c.value.data };
    }

    const r = await updates.recordDelivery(deps, {
      guildId: rt.guildId,
      repoId: repo.id,
      deliveryId,
      ...classified,
    });
    if (r.status === 'duplicate') return json(200, { ok: true, duplicate: true });
    deps.log.info({ ...meta, repo: fullName, eventId: r.eventId }, 'github webhook: delivery queued');
    return json(200, { ok: true, queued: true, eventId: r.eventId });
  } catch (err) {
    deps.log.error({ ...meta, err: { message: (err as Error).message } }, 'github webhook failed');
    return fail(500, `Internal error. Reference: ${correlationId}`);
  }
}
