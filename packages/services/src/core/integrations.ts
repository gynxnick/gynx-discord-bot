import { z } from 'zod';
import type { IntegrationConfig, Prisma } from '@gynx/database';
import { AppError, decryptSecret, encryptSecret } from '@gynx/shared';
import { audit } from './audit';
import { requirePermission } from './authz';
import type { Ctx } from './context';

export const INTEGRATION_KINDS = ['AI_PROVIDER', 'STATUS_PROVIDER', 'STEAM'] as const;

/** What the dashboard may see: never the secret, only whether one is stored. */
export type IntegrationView = Omit<IntegrationConfig, 'secretEnc'> & { hasSecret: boolean };

const toView = ({ secretEnc, ...rest }: IntegrationConfig): IntegrationView => ({
  ...rest,
  hasSecret: !!secretEnc,
});

export const upsertIntegrationSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits and dashes.'),
  enabled: z.boolean(),
  /** Non-secret settings only (model name, base URL, …). */
  settings: z.record(z.union([z.string().max(500), z.number(), z.boolean()])).default({}),
  /** Write-only. Omit to keep the stored secret; empty string clears it. */
  secret: z.string().max(4096).optional(),
});

export async function listIntegrations(
  ctx: Ctx,
  kind?: (typeof INTEGRATION_KINDS)[number],
): Promise<IntegrationView[]> {
  await requirePermission(ctx, 'settings.manage');
  const rows = await ctx.db.integrationConfig.findMany({
    where: { guildId: ctx.guildId, kind },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
  return rows.map(toView);
}

export async function upsertIntegration(
  ctx: Ctx,
  raw: z.input<typeof upsertIntegrationSchema>,
): Promise<IntegrationView> {
  await requirePermission(ctx, 'settings.manage', 'integrations.update');
  const input = upsertIntegrationSchema.parse(raw);
  if (input.secret && !ctx.encryptionKey)
    throw new AppError('CONFIG', 'Secret storage is not configured (ENCRYPTION_KEY).');
  const secretEnc =
    input.secret === undefined
      ? undefined
      : input.secret === ''
        ? null
        : encryptSecret(input.secret, ctx.encryptionKey!);

  return ctx.db.$transaction(async (tx) => {
    const row = await tx.integrationConfig.upsert({
      where: { guildId_kind_name: { guildId: ctx.guildId, kind: input.kind, name: input.name } },
      create: {
        guildId: ctx.guildId,
        kind: input.kind,
        name: input.name,
        enabled: input.enabled,
        settings: input.settings as Prisma.InputJsonValue,
        secretEnc: secretEnc ?? null,
        updatedById: ctx.actor.userId,
      },
      update: {
        enabled: input.enabled,
        settings: input.settings as Prisma.InputJsonValue,
        ...(secretEnc !== undefined ? { secretEnc } : {}),
        updatedById: ctx.actor.userId,
      },
    });
    await audit(
      ctx,
      {
        action: 'integrations.update',
        targetType: 'IntegrationConfig',
        targetId: row.id,
        metadata: {
          kind: input.kind,
          name: input.name,
          enabled: input.enabled,
          secretChanged: secretEnc !== undefined,
        },
      },
      tx,
    );
    return toView(row);
  });
}

export async function deleteIntegration(ctx: Ctx, id: string): Promise<void> {
  await requirePermission(ctx, 'settings.manage', 'integrations.delete');
  const row = await ctx.db.integrationConfig.findFirst({ where: { id, guildId: ctx.guildId } });
  if (!row) throw new AppError('NOT_FOUND', 'Integration not found.');
  await ctx.db.$transaction(async (tx) => {
    await tx.integrationConfig.delete({ where: { id } });
    await audit(
      ctx,
      {
        action: 'integrations.delete',
        targetType: 'IntegrationConfig',
        targetId: id,
        metadata: { kind: row.kind, name: row.name },
      },
      tx,
    );
  });
}

/** Server-side only (worker/bot adapters): returns the decrypted secret of an enabled integration. */
export async function loadIntegrationSecret(
  db: Ctx['db'],
  encryptionKey: string,
  guildId: string,
  kind: (typeof INTEGRATION_KINDS)[number],
  name: string,
): Promise<{ settings: Prisma.JsonValue; secret: string | null } | null> {
  const row = await db.integrationConfig.findUnique({
    where: { guildId_kind_name: { guildId, kind, name } },
  });
  if (!row || !row.enabled) return null;
  return {
    settings: row.settings,
    secret: row.secretEnc ? decryptSecret(row.secretEnc, encryptionKey) : null,
  };
}
