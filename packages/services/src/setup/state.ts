import type { Db, GuildConfig, SetupResource, WelcomeConfig } from '@gynx/database';
import { getGuildConfig } from '../core/config';
import { loadWelcomeConfig } from '../community/welcome';
import type { BindingKey, PlanState } from './planner';
import { TEMPLATE_NAME } from './planner';
import type { DiscordAdminPort } from './port';

export type GuildConfigBinding = Exclude<BindingKey, 'welcome.channelId' | 'welcome.verifiedRoleId'>;

export function readBinding(b: BindingKey, cfg: GuildConfig, welcome: WelcomeConfig): string | null {
  if (b === 'welcome.channelId') return welcome.channelId;
  if (b === 'welcome.verifiedRoleId') return welcome.verifiedRoleId;
  return (cfg[b as GuildConfigBinding] as string | null | undefined) ?? null;
}

const ALL_BINDINGS: BindingKey[] = [
  'welcome.channelId',
  'welcome.verifiedRoleId',
  'announcementChannelId',
  'incidentChannelId',
  'statusBoardChannelId',
  'statusChannelId',
  'supportStatusChannelId',
  'suggestionChannelId',
  'eventChannelId',
  'dutyPanelChannelId',
  'reportChannelId',
  'partnerReviewChannelId',
  'modLogChannelId',
  'securityChannelId',
  'logChannelId',
  'setupLogChannelId',
  'partnerRoleId',
  'staffPingRoleId',
  'escalationRoleId',
];

/** Messages from the manifest that still exist on Discord. */
export async function liveMessageKeys(
  port: DiscordAdminPort,
  manifest: readonly SetupResource[],
): Promise<Set<string>> {
  const live = new Set<string>();
  for (const m of manifest) {
    if (m.resourceType !== 'MESSAGE' || !m.channelId) continue;
    try {
      if (await port.messageExists(m.channelId, m.discordResourceId)) live.add(m.blueprintKey);
    } catch {
      /* treat as missing */
    }
  }
  return live;
}

/** Current bot configuration the planner compares against. */
export async function loadPlanState(
  db: Db,
  port: DiscordAdminPort,
  guildId: string,
  manifest: readonly SetupResource[],
): Promise<PlanState> {
  const [cfg, welcome] = [await getGuildConfig(db, guildId), await loadWelcomeConfig(db, guildId)];
  const [grants, template, liveMessages] = await Promise.all([
    db.staffPermission.findMany({
      where: { guildId, subjectType: 'ROLE', effect: 'ALLOW' },
      select: { subjectId: true, permission: true },
    }),
    db.announcementTemplate.findUnique({ where: { guildId_name: { guildId, name: TEMPLATE_NAME } } }),
    liveMessageKeys(port, manifest),
  ]);
  return {
    bindings: Object.fromEntries(ALL_BINDINGS.map((b) => [b, readBinding(b, cfg, welcome)])),
    verificationEnabled: welcome.verificationEnabled,
    grants,
    liveMessages,
    templateExists: Boolean(template),
  };
}
