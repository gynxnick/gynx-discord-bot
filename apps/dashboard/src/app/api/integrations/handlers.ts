import { z, type ZodTypeAny } from 'zod';
import {
  deleteIntegration,
  INTEGRATION_KINDS,
  listIntegrations,
  upsertIntegration,
  upsertIntegrationSchema,
} from '@gynx/services';
import type { ApiHandler, ApiOptions } from '../../../server/api-core';

/**
 * Integration API handlers (settings.manage), framework-free so integration
 * tests can drive them through `executeApi`. Route files bind them with apiRoute.
 * Secrets are write-only: every response is the service's IntegrationView
 * (`hasSecret` only, never the secret or its ciphertext).
 */

const define = <S extends ZodTypeAny | undefined = undefined>(
  opts: ApiOptions<S>,
  handler: ApiHandler<S extends ZodTypeAny ? z.output<S> : Record<string, unknown>>,
) => ({ opts, handler });

/** Setting names that look like credentials ("maxTokens" is fine; "apiKey", "token", "password" are not). */
const SECRETISH_KEY =
  /(secret|password|passwd|credential|api[-_]?key|bearer|^key$|^token$|access[-_]?token|auth[-_]?token|^authorization$)/i;

/** Extra rules for AI provider settings: non-secret keys only, https base URL, sane limits. */
export const integrationUpsertSchema = upsertIntegrationSchema.superRefine((v, ctx) => {
  for (const key of Object.keys(v.settings ?? {})) {
    if (SECRETISH_KEY.test(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings', key],
        message: 'Secrets belong in the write-only key field, not in settings.',
      });
    }
  }
  if (v.kind !== 'AI_PROVIDER') return;
  const s = v.settings ?? {};
  const allowed = new Set(['model', 'baseUrl', 'maxTokens']);
  for (const key of Object.keys(s)) {
    if (!allowed.has(key))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', key], message: 'Unknown setting.' });
  }
  if (s.model !== undefined && (typeof s.model !== 'string' || !/^[\w.:/-]{1,100}$/.test(s.model))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settings', 'model'],
      message: 'Use a model id of up to 100 letters, digits, . : / _ or -.',
    });
  }
  if (s.baseUrl !== undefined) {
    let ok = false;
    if (typeof s.baseUrl === 'string') {
      try {
        const u = new URL(s.baseUrl);
        ok = u.protocol === 'https:' && !u.username && !u.password;
      } catch {
        ok = false;
      }
    }
    if (!ok)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings', 'baseUrl'],
        message: 'The base URL must be an https:// URL without credentials.',
      });
  }
  if (
    s.maxTokens !== undefined &&
    !(
      typeof s.maxTokens === 'number' &&
      Number.isInteger(s.maxTokens) &&
      s.maxTokens >= 1 &&
      s.maxTokens <= 32_000
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settings', 'maxTokens'],
      message: 'Max tokens must be a whole number between 1 and 32000.',
    });
  }
});

export const listIntegrationsQuery = z.object({ kind: z.enum(INTEGRATION_KINDS).optional() });

export const integrationHandlers = {
  /** GET /api/integrations?kind= */
  list: define({ permission: 'settings.manage', schema: listIntegrationsQuery }, async ({ ctx, input }) => ({
    items: await listIntegrations(ctx, input.kind),
  })),
  /** POST /api/integrations — create or update by (kind, name). */
  upsert: define(
    { permission: 'settings.manage', schema: integrationUpsertSchema, mutation: true },
    async ({ ctx, input }) => upsertIntegration(ctx, input),
  ),
  /** DELETE /api/integrations/:id */
  remove: define({ permission: 'settings.manage', mutation: true }, async ({ ctx, params }) => {
    await deleteIntegration(ctx, params.id ?? '');
    return { ok: true };
  }),
};
