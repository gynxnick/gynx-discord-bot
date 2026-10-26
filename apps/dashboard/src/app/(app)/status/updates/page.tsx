import type { Metadata } from 'next';
import { getGuildConfig, isModuleEnabled, updates } from '@gynx/services';
import { listGuildChannels, type ChannelOption } from '@/app/api/discord/channels/channels';
import { UpdateFeedManager } from '@/components/status/UpdateFeedManager';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { getEnv } from '@/server/env';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Update feed' };

export default async function UpdateFeedPage() {
  const page = await requirePagePermission('updates.manage', 'updates.feed');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, timezone } = page;
  const env = getEnv();

  const [repos, events, cfg, moduleOn, channels] = await Promise.all([
    updates.listRepos(ctx),
    updates.listRecentEvents(ctx, 20),
    getGuildConfig(ctx.db, ctx.guildId),
    isModuleEnabled(ctx.db, ctx.guildId, 'updates'),
    listGuildChannels(ctx.discord, ctx.guildId).catch((): ChannelOption[] | null => null),
  ]);
  const channel = (id: string | null) =>
    id ? { id, name: channels?.find((c) => c.id === id)?.name ?? null } : null;

  return (
    <>
      <PageHeader
        title="Update feed"
        description="Post GitHub pushes and releases to Discord. Every push goes to the private staff channel; only releases and commits tagged [public] go to the public updates channel."
        breadcrumbs={[{ label: 'Status & incidents', href: '/status' }, { label: 'Update feed' }]}
      />
      <UpdateFeedManager
        timeZone={timezone}
        payloadUrl={`${env.DASHBOARD_URL.replace(/\/+$/, '')}/api/webhooks/github`}
        secretConfigured={!!env.GITHUB_WEBHOOK_SECRET}
        moduleEnabled={moduleOn}
        publicChannel={channel(cfg.updatesChannelId)}
        staffChannel={channel(cfg.updatesStaffChannelId)}
        repos={repos}
        events={events}
      />
    </>
  );
}
