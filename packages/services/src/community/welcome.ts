import { z } from 'zod';
import type { Db, WelcomeConfig } from '@gynx/database';
import { neutraliseMentions, validation } from '@gynx/shared';
import { audit } from '../core/audit';
import { requirePermission } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { assessRoleSafety, type RoleMeta } from './role-safety';
import { httpsUrlSchema, snowflakeSchema } from './schemas';

const ALLOWED_PLACEHOLDERS = new Set(['user', 'server']);

const welcomeMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .superRefine((msg, c) => {
    const unknown = [...msg.matchAll(/\{([^{}\s]{1,32})\}/g)]
      .map((m) => m[1]!)
      .filter((p) => !ALLOWED_PLACEHOLDERS.has(p));
    if (unknown.length)
      c.addIssue({
        code: 'custom',
        message: `Unknown placeholder(s): ${unknown.map((p) => `{${p}}`).join(', ')}. Use {user} and {server}.`,
      });
  });

export const welcomeConfigUpdateSchema = z
  .object({
    enabled: z.boolean(),
    channelId: snowflakeSchema.nullable(),
    title: z.string().trim().min(1).max(256),
    message: welcomeMessageSchema,
    rulesText: z.string().trim().min(1).max(4000),
    requireRulesAck: z.boolean(),
    verificationEnabled: z.boolean(),
    verifiedRoleId: snowflakeSchema.nullable(),
    minAccountAgeDays: z.number().int().min(0).max(365),
    raidJoinThreshold: z.number().int().min(3).max(1000),
    raidWindowSeconds: z.number().int().min(10).max(3600),
    raidAction: z.enum(['ALERT', 'REQUIRE_VERIFICATION']),
    docsUrl: httpsUrlSchema.nullable(),
    supportUrl: httpsUrlSchema.nullable(),
    dmOnJoin: z.boolean(),
  })
  .partial()
  .strict();
export type WelcomeConfigUpdate = z.input<typeof welcomeConfigUpdateSchema>;

export async function loadWelcomeConfig(db: Db, guildId: string): Promise<WelcomeConfig> {
  await getGuildConfig(db, guildId); // ensures the guild rows exist
  return db.welcomeConfig.upsert({ where: { guildId }, create: { guildId }, update: {} });
}

/** Read the welcome/onboarding config (dashboard). */
export async function getWelcomeConfig(ctx: Ctx): Promise<WelcomeConfig> {
  await requirePermission(ctx, 'community.manage');
  return loadWelcomeConfig(ctx.db, ctx.guildId);
}

/**
 * Update the welcome config. When a verified role is (re)configured, pass the
 * live role metadata so it can be checked: a "verified" role must never carry
 * privileged permissions or sit above the bot.
 */
export async function updateWelcomeConfig(
  ctx: Ctx,
  raw: WelcomeConfigUpdate,
  verifiedRole?: { role: RoleMeta; botHighestPosition: number },
): Promise<WelcomeConfig> {
  await requirePermission(ctx, 'community.manage', 'community.welcome.update');
  await requireModule(ctx, 'community');
  const input = welcomeConfigUpdateSchema.parse(raw);
  const current = await loadWelcomeConfig(ctx.db, ctx.guildId);

  const nextVerification = input.verificationEnabled ?? current.verificationEnabled;
  const nextRole = input.verifiedRoleId !== undefined ? input.verifiedRoleId : current.verifiedRoleId;
  if (nextVerification && !nextRole) throw validation('Choose a verified role before enabling verification.');
  if (input.verifiedRoleId && input.verifiedRoleId !== current.verifiedRoleId) {
    if (!verifiedRole || verifiedRole.role.id !== input.verifiedRoleId) {
      throw validation('Role details are required to validate the verified role.');
    }
    const safety = assessRoleSafety({ guildId: ctx.guildId, ...verifiedRole });
    if (!safety.ok) throw validation(safety.message);
  }

  return ctx.db.$transaction(async (tx) => {
    const updated = await tx.welcomeConfig.update({ where: { guildId: ctx.guildId }, data: input });
    await audit(
      ctx,
      {
        action: 'community.welcome.update',
        targetType: 'WelcomeConfig',
        targetId: ctx.guildId,
        metadata: { fields: Object.keys(input) },
      },
      tx,
    );
    return updated;
  });
}

/** Fill `{user}`/`{server}` placeholders. Mass mentions in the template are neutralised. */
export function renderWelcomeMessage(template: string, vars: { userId: string; serverName: string }): string {
  return neutraliseMentions(template)
    .replaceAll('{user}', `<@${vars.userId}>`)
    .replaceAll('{server}', neutraliseMentions(vars.serverName));
}

/** Support link: onboarding-specific override, else the guild-wide external support URL. */
export async function resolveSupportUrl(db: Db, guildId: string): Promise<string | null> {
  const [w, cfg] = await Promise.all([
    db.welcomeConfig.findUnique({ where: { guildId } }),
    getGuildConfig(db, guildId),
  ]);
  return w?.supportUrl ?? cfg.supportUrl ?? null;
}
