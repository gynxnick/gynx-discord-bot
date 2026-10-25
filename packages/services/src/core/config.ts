import { ensureGuild, type Db, type GuildConfig } from '@gynx/database';
import { moduleDisabled } from '@gynx/shared';
import type { Ctx } from './context';

export const MODULES = [
  'status',
  'community',
  'moderation',
  'troubleshooting',
  'games',
  'security',
  'engagement',
  'referrals',
  'announcements',
  'analytics',
  'support',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  status: 'Status & incidents',
  community: 'Onboarding, roles & FAQ',
  moderation: 'Moderation & automod',
  troubleshooting: 'Troubleshooting assistant',
  games: 'Game utilities',
  security: 'Security & abuse reports',
  engagement: 'Events, polls, suggestions & giveaways',
  referrals: 'Referrals & partners',
  announcements: 'Announcements',
  analytics: 'Analytics & reports',
  support: 'Support status panel',
};

export async function getGuildConfig(db: Db, guildId: string): Promise<GuildConfig> {
  const cfg = await db.guildConfig.findUnique({ where: { guildId } });
  if (cfg) return cfg;
  await ensureGuild(db, guildId);
  return db.guildConfig.findUniqueOrThrow({ where: { guildId } });
}

export async function isModuleEnabled(db: Db, guildId: string, module: ModuleKey): Promise<boolean> {
  const cfg = await getGuildConfig(db, guildId);
  return cfg.enabledModules.includes(module);
}

export async function requireModule(ctx: Ctx, module: ModuleKey): Promise<GuildConfig> {
  const cfg = await getGuildConfig(ctx.db, ctx.guildId);
  if (!cfg.enabledModules.includes(module)) throw moduleDisabled(MODULE_LABELS[module]);
  return cfg;
}
