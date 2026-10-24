import type { Metadata } from 'next';
import { getGuildConfig, marketing } from '@gynx/services';
import { toZonedInput } from '@/components/community/datetime';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { channelName } from '@/components/community/picker-utils';
import { load, loadChannels, loadRoles } from '@/components/community/server/data';
import { AnnouncementEditor } from '@/components/marketing/announcements/AnnouncementEditor';
import { discordMessageUrl } from '@/components/marketing/announcements/announcement-utils';
import { RefreshButton } from '@/components/marketing/announcements/RefreshButton';
import {
  announcementTypeColors,
  announcementTypeOptions,
  toDraft,
} from '@/components/marketing/announcements/server';
import { trackedLinkUrl } from '@/components/marketing/links/link-utils';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime, formatNumber, truncateText } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Announcement' };

interface DeliveryRow {
  id: string;
  success: boolean;
  error: string | null;
  attempt: number;
  channel: string;
  messageId: string | null;
  messageUrl: string | null;
  reactions: number;
  createdLabel: string;
}

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission(
    ['announcements.create', 'announcements.publish'],
    'marketing.announcements.detail',
  );
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  const { ctx, timezone } = page;

  const res = await load(() => marketing.getAnnouncement(ctx, id));
  if (!res.ok) return <ModuleNotice title="Announcement" message={res.message} />;
  const a = res.data;
  const [cfg, channels, roles, templates, analytics] = await Promise.all([
    getGuildConfig(ctx.db, ctx.guildId),
    loadChannels(ctx),
    loadRoles(ctx),
    load(() => marketing.listTemplates(ctx)),
    load(() => marketing.getAnnouncementAnalytics(ctx, id)),
  ]);

  const deliveries: DeliveryRow[] = a.deliveries.map((d) => ({
    id: d.id,
    success: d.success,
    error: d.error,
    attempt: d.attempt,
    channel: channelName(channels.channels, d.channelId),
    messageId: d.messageId,
    messageUrl: discordMessageUrl(ctx.guildId, d.channelId, d.messageId),
    reactions: d.reactionCount,
    createdLabel: formatDateTime(d.createdAt, timezone),
  }));

  const deliveryColumns: Column<DeliveryRow>[] = [
    {
      key: 'result',
      header: 'Result',
      cell: (d) =>
        d.success ? (
          <Badge tone="success" dot>
            Delivered
          </Badge>
        ) : d.error ? (
          <Badge tone="danger" dot>
            Failed
          </Badge>
        ) : (
          <Badge tone="accent" dot>
            Sending
          </Badge>
        ),
    },
    {
      key: 'detail',
      header: 'Details',
      cell: (d) => (
        <div className="min-w-[14rem] text-xs">
          {d.messageUrl ? (
            <a
              href={d.messageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Open message in Discord
            </a>
          ) : d.messageId ? (
            <span className="font-mono text-fg-muted">{d.messageId}</span>
          ) : null}
          {d.error && <p className="mt-0.5 break-words text-danger">{d.error}</p>}
        </div>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      hideOnMobile: true,
      cell: (d) => <span className="whitespace-nowrap text-fg-muted">{d.channel}</span>,
    },
    {
      key: 'attempt',
      header: 'Attempt',
      align: 'right',
      hideOnMobile: true,
      cell: (d) => <span className="tabular-nums">{d.attempt}</span>,
    },
    {
      key: 'reactions',
      header: 'Reactions',
      align: 'right',
      cell: (d) => <span className="tabular-nums">{formatNumber(d.reactions)}</span>,
    },
    {
      key: 'created',
      header: 'Time',
      hideOnMobile: true,
      cell: (d) => <span className="whitespace-nowrap text-fg-muted">{d.createdLabel}</span>,
    },
  ];

  const links = a.trackedLinks.map((l) => ({ ...l, url: trackedLinkUrl(ctx.dashboardUrl, l.slug) }));

  return (
    <>
      <PageHeader
        title={truncateText(a.title, 80)}
        breadcrumbs={[
          { label: 'Events & marketing', href: '/marketing' },
          { label: 'Announcements', href: '/marketing/announcements' },
          { label: truncateText(a.title, 40) },
        ]}
        actions={<RefreshButton />}
      />

      <AnnouncementEditor
        key={`${a.id}:${a.version}:${a.status}`}
        announcement={{
          id: a.id,
          status: a.status,
          version: a.version,
          draft: toDraft(a),
          scheduledForInput: toZonedInput(a.scheduledFor, timezone),
          scheduledForLabel: a.scheduledFor ? formatDateTime(a.scheduledFor, timezone) : null,
          publishedAtLabel: a.publishedAt ? formatDateTime(a.publishedAt, timezone) : null,
        }}
        initialDraft={toDraft(a)}
        timezone={timezone}
        channels={channels.error ? null : channels.channels}
        roles={roles.roles}
        templates={
          templates.ok
            ? templates.data.map((t) => ({
                id: t.id,
                name: t.name,
                type: t.type,
                title: t.title,
                body: t.body,
              }))
            : []
        }
        typeOptions={announcementTypeOptions()}
        typeColors={announcementTypeColors()}
        footer={cfg.embedFooter}
        minScheduleInput={toZonedInput(new Date(ctx.now().getTime() + 2 * 60_000), timezone)}
      />

      <div className="mt-8 space-y-6">
        <section aria-labelledby="engagement-heading" className="space-y-3">
          <h2 id="engagement-heading" className="text-base font-semibold text-fg">
            Engagement
          </h2>
          {analytics.ok ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Reactions"
                  value={formatNumber(analytics.data.reactions)}
                  hint={analytics.data.reactionsNote}
                />
                <StatCard
                  label="Tracked-link clicks"
                  value={formatNumber(analytics.data.linkClicks)}
                  hint={`${analytics.data.links.length} tracked link${analytics.data.links.length === 1 ? '' : 's'}`}
                />
                <StatCard label="Views" value="Not available" hint={analytics.data.impressionsNote} />
              </div>
            </>
          ) : (
            <ModuleNotice title="Engagement" message={analytics.message} inline />
          )}
        </section>

        <Card>
          <CardHeader
            title="Deliveries"
            description="One row per publish attempt. A message is never re-sent automatically after an interrupted attempt."
          />
          <Table
            columns={deliveryColumns}
            rows={deliveries}
            rowKey={(d) => d.id}
            caption="Deliveries"
            empty={
              <EmptyState
                title="Not delivered yet"
                description="Deliveries appear here once the bot posts the announcement."
              />
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="Tracked links"
            description="Short links attached to this announcement. Only a click counter is stored."
            actions={
              <ButtonLink href="/marketing/links" variant="secondary" size="sm">
                Manage links
              </ButtonLink>
            }
          />
          {links.length === 0 ? (
            <EmptyState
              title="No tracked links"
              description="Create one on the Tracked links page and attach it to this announcement to count clicks."
            />
          ) : (
            <ul className="divide-y divide-border">
              {links.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="break-all font-mono text-xs text-fg">{l.url}</p>
                    <p className="break-all text-xs text-fg-muted">→ {l.targetUrl}</p>
                  </div>
                  <span className="shrink-0 tabular-nums text-fg-muted">
                    {formatNumber(l.clicks)} click{l.clicks === 1 ? '' : 's'}
                    {!l.active && ' · inactive'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
