import type { Metadata } from 'next';
import { MODULES, MODULE_LABELS, analytics, getGuildConfig } from '@gynx/services';
import { listGuildChannels } from '@/app/api/discord/channels/channels';
import type { PickerChannel, PickerRole } from '@/components/settings/DiscordPickers';
import { GeneralSettingsForm, type KindOption } from '@/components/settings/GeneralSettingsForm';
import type { SettingsView } from '@/components/settings/general-settings';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { listGuildRoles } from '@/server/queries/roles';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Settings' };

const PRIVATE_CHANNELS = new Set(['log', 'modLog', 'security', 'report', 'partnerReview']);

export default async function SettingsPage() {
  const page = await requirePagePermission('settings.manage', 'settings.general');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx } = page;

  const [settings, cfg, channels, roles] = await Promise.all([
    analytics.getSettings(ctx),
    getGuildConfig(ctx.db, ctx.guildId),
    listGuildChannels(ctx.discord, ctx.guildId).catch((): PickerChannel[] | null => null),
    listGuildRoles(ctx.discord, ctx.guildId).catch((): PickerRole[] | null => null),
  ]);

  const initial: SettingsView = {
    timezone: settings.timezone,
    enabledModules: settings.enabledModules,
    channels: settings.channels,
    roles: settings.roles,
    supportUrl: settings.supportUrl,
    status: settings.status,
    retention: settings.retention,
    activeMemberMinMessages: settings.activeMemberMinMessages,
    reportNotifyReporter: settings.reportNotifyReporter,
    embedFooter: settings.embedFooter,
  };
  const modules: KindOption[] = MODULES.map((m) => ({ key: m, label: MODULE_LABELS[m] }));
  const channelKinds: KindOption[] = (Object.keys(analytics.CHANNEL_KINDS) as analytics.ChannelKind[]).map(
    (k) => ({
      key: k,
      label: analytics.CHANNEL_KIND_LABELS[k],
      private: PRIVATE_CHANNELS.has(k),
    }),
  );
  const roleKinds: KindOption[] = (Object.keys(analytics.ROLE_KINDS) as analytics.RoleKind[]).map((k) => ({
    key: k,
    label: analytics.ROLE_KIND_LABELS[k],
  }));

  let timeZones: string[] = [];
  try {
    timeZones = Intl.supportedValuesOf('timeZone');
  } catch {
    timeZones = [];
  }
  if (!timeZones.includes('UTC')) timeZones = ['UTC', ...timeZones];
  if (!timeZones.includes(settings.timezone)) timeZones = [settings.timezone, ...timeZones];

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Server-wide configuration used by the bot, worker and dashboard. Every change is written to the audit log. Last updated ${formatDateTime(cfg.updatedAt, page.timezone)}.`}
        breadcrumbs={[{ label: 'Settings' }, { label: 'General' }]}
      />
      <GeneralSettingsForm
        initial={initial}
        modules={modules}
        channelKinds={channelKinds}
        roleKinds={roleKinds}
        channels={channels}
        roles={roles}
        timeZones={timeZones}
      />
    </>
  );
}
