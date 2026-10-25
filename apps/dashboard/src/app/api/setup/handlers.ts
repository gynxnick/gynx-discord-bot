import { z } from 'zod';
import { setup } from '@gynx/services';
import { notFound } from '@gynx/shared';
import { toJsonSafe } from '../../../components/setup/json-safe';
import { defineRoute } from '../settings/define-route';

/**
 * Setup wizard API (all routes: `setup.manage`; the services re-check and
 * audit). Mutations need the session CSRF token + same origin (apiRoute).
 * Previews read the whole Discord server, so they share a tight rate limit.
 */

const PERMISSION = 'setup.manage' as const;
const PREVIEW_LIMIT = { limit: 10, windowSeconds: 60, key: 'setup-preview' };
const OP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const componentKey = z.enum(setup.COMPONENT_KEYS as [setup.ComponentKey, ...setup.ComponentKey[]]);

function operationId(params: Record<string, string>): string {
  const id = params.id ?? '';
  if (!OP_ID_RE.test(id)) throw notFound('Setup operation');
  return id;
}

/** GET /api/setup/overview */
export const overviewRoute = defineRoute({ permission: PERMISSION }, async ({ ctx }) =>
  toJsonSafe(await setup.getSetupOverview(ctx)),
);

/** GET /api/setup/config */
export const getConfigRoute = defineRoute({ permission: PERMISSION }, async ({ ctx }) =>
  toJsonSafe(await setup.getSetupConfig(ctx)),
);

/**
 * PATCH body: any subset of SetupConfig's top-level keys; each key sent
 * replaces the stored value for that key. Unknown keys are rejected.
 */
export const configPatchSchema = setup.setupConfigSchema.partial();

/** PATCH /api/setup/config (audited by the service as `setup.config`). */
export const updateConfigRoute = defineRoute(
  {
    permission: PERMISSION,
    schema: configPatchSchema,
    rateLimit: { limit: 20, windowSeconds: 60, key: 'setup-config' },
  },
  async ({ ctx, input }) => toJsonSafe(await setup.updateSetupConfig(ctx, input)),
);

export const previewSchema = z
  .object({
    type: z.enum(['START', 'REPAIR', 'UPDATE']),
    selection: z.array(componentKey).max(setup.COMPONENT_KEYS.length).optional(),
  })
  .strict();

/** POST /api/setup/preview → OperationPreview (stored as a PREVIEWED operation). */
export const previewRoute = defineRoute(
  { permission: PERMISSION, schema: previewSchema, rateLimit: PREVIEW_LIMIT },
  async ({ ctx, input }) =>
    toJsonSafe(
      await setup.previewOperation(ctx, {
        type: input.type,
        ...(input.selection?.length ? { selection: input.selection } : {}),
      }),
    ),
);

export const rollbackPreviewSchema = z
  .object({ operationId: z.string().regex(OP_ID_RE, 'Unknown operation.').optional() })
  .strict();

/** POST /api/setup/rollback/preview → OperationPreview of reverting an operation (default: latest applied). */
export const rollbackPreviewRoute = defineRoute(
  { permission: PERMISSION, schema: rollbackPreviewSchema, rateLimit: PREVIEW_LIMIT },
  async ({ ctx, input }) => toJsonSafe(await setup.previewRollback(ctx, input.operationId)),
);

export const confirmSchema = z.object({ acceptDisruptive: z.boolean() }).strict();

/** POST /api/setup/operations/[id]/confirm → { status: 'QUEUED' } or { status: 'STALE', preview }. */
export const confirmRoute = defineRoute(
  {
    permission: PERMISSION,
    schema: confirmSchema,
    // Confirm re-plans against the live server, like a preview.
    rateLimit: { limit: 10, windowSeconds: 60, key: 'setup-confirm' },
  },
  async ({ ctx, input, params }) =>
    toJsonSafe(
      await setup.confirmOperation(ctx, operationId(params), { acceptDisruptive: input.acceptDisruptive }),
    ),
);

/** POST /api/setup/operations/[id]/cancel */
export const cancelRoute = defineRoute({ permission: PERMISSION }, async ({ ctx, params }) => {
  await setup.cancelOperation(ctx, operationId(params));
  return { ok: true };
});

export const listSchema = z.object({
  cursor: z.string().regex(OP_ID_RE, 'Invalid cursor.').optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** GET /api/setup/operations?cursor=&limit= */
export const listOperationsRoute = defineRoute(
  { permission: PERMISSION, schema: listSchema },
  async ({ ctx, input }) =>
    toJsonSafe(await setup.listOperations(ctx, { cursor: input.cursor, limit: input.limit ?? 20 })),
);

/** GET /api/setup/operations/[id] → OperationDetail (polled every few seconds while running). */
export const getOperationRoute = defineRoute(
  // Polling: 3s interval → 20/min per open page; allow a few tabs.
  { permission: PERMISSION, rateLimit: { limit: 90, windowSeconds: 60, key: 'setup-operation' } },
  async ({ ctx, params }) => toJsonSafe(await setup.getOperation(ctx, operationId(params))),
);
