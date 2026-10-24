import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { channelName } from '@/components/community/picker-utils';
import { load, loadChannels } from '@/components/community/server/data';
import {
  ANNOUNCEMENT_STATUSES,
  STATUS_LABELS,
  STATUS_TONES,
  type AnnouncementStatus,
} from '@/components/marketing/announcements/announcement-utils';
import { announcementTypeOptions } from '@/components/marketing/announcements/server';
import { TemplatesManager } from '@/components/marketing/announcements/TemplatesManager';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { formatDateTime } from '@/lib/format';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Announcements' };

const MENTION_LABELS: Record<string, string> = {
  NONE: '—',
  HERE: '@here',
  EVERYONE: '@everyone',
  ROLE: 'Role',
};

interface Row {
  id: string;
  title: string;
  typeLabel: string;
  status: AnnouncementStatus;
  channel: string;
  mention: string;
  whenLabel: string;
  createdLabel: string;
}

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission(
    ['announcements.create', 'announcements.publish'],
    'marketing.announcements',
  );
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone, session } = page;
  const canCreate = session.permissions.has('announcements.create');

  const statusRaw = firstParam(sp, 'status');
  const typeRaw = firstParam(sp, 'type');
  const status = ANNOUNCEMENT_STATUSES.find((s) => s === statusRaw);
  const type = marketing.ANNOUNCEMENT_TYPES.find((t) => t === typeRaw);
  const typeOptions = announcementTypeOptions();

  // Templates check the module; a disabled module shows one notice for the whole page.
  const templates = await load(() => marketing.listTemplates(ctx));
  if (!templates.ok) return <ModuleNotice title="Announcements" message={templates.message} />;
  const list = await load(() =>
    marketing.listAnnouncements(ctx, { status, type, cursor: readCursor(sp).cursor, limit: 25 }),
  );
  const { channels } = await loadChannels(ctx);

  const typeLabel = (t: string) => typeOptions.find((o) => o.value === t)?.label ?? t;
  const rows: Row[] = list.ok
    ? list.data.items.map((a) => ({
        id: a.id,
        title: a.title,
        typeLabel: typeLabel(a.type),
        status: a.status,
        channel: channelName(channels, a.channelId),
        mention: MENTION_LABELS[a.mention] ?? a.mention,
        whenLabel: a.publishedAt
          ? `Published ${formatDateTime(a.publishedAt, timezone)}`
          : a.scheduledFor && (a.status === 'SCHEDULED' || a.status === 'PUBLISHING')
            ? `Scheduled ${formatDateTime(a.scheduledFor, timezone)}`
            : '—',
        createdLabel: formatDateTime(a.createdAt, timezone),
      }))
    : [];
  const links = pageLinks('/marketing/announcements', sp, list.ok ? list.data.nextCursor : null);
  const filtered = Boolean(status || type);

  const columns: Column<Row>[] = [
    {
      key: 'title',
      header: 'Title',
      cell: (r) => (
        <div className="min-w-[14rem]">
          <Link
            href={`/marketing/announcements/${encodeURIComponent(r.id)}`}
            className="font-medium text-fg hover:text-accent"
          >
            {r.title}
          </Link>
          <p className="mt-0.5 text-xs text-fg-muted">{r.typeLabel}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <Badge tone={STATUS_TONES[r.status]} dot>
          {STATUS_LABELS[r.status]}
        </Badge>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.channel}</span>,
    },
    {
      key: 'mention',
      header: 'Mention',
      hideOnMobile: true,
      cell: (r) => <span className="text-fg-muted">{r.mention}</span>,
    },
    {
      key: 'when',
      header: 'Scheduled / published',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.whenLabel}</span>,
    },
    {
      key: 'created',
      header: 'Created',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.createdLabel}</span>,
    },
  ];

  const announcementsTab = (
    <div className="space-y-4">
      <Card>
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 p-4"
          role="search"
          aria-label="Filter announcements"
        >
          <div className="w-full sm:w-48">
            <label htmlFor="f-status" className="mb-1 block text-xs text-fg-muted">
              Status
            </label>
            <Select
              id="f-status"
              name="status"
              defaultValue={status ?? ''}
              placeholder="Any status"
              options={ANNOUNCEMENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
            />
          </div>
          <div className="w-full sm:w-48">
            <label htmlFor="f-type" className="mb-1 block text-xs text-fg-muted">
              Type
            </label>
            <Select
              id="f-type"
              name="type"
              defaultValue={type ?? ''}
              placeholder="Any type"
              options={typeOptions}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {filtered && (
              <ButtonLink href="/marketing/announcements" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
      </Card>
      {!list.ok ? (
        <ModuleNotice title="Announcements" message={list.message} inline />
      ) : (
        <Card>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            caption="Announcements"
            empty={
              <EmptyState
                title={filtered ? 'No announcements match these filters' : 'No announcements yet'}
                description={
                  filtered
                    ? 'Try another status or type.'
                    : 'Create a draft, preview it and publish or schedule it to a channel.'
                }
                action={
                  !filtered && canCreate ? (
                    <ButtonLink href="/marketing/announcements/new" variant="primary">
                      New announcement
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
          />
          <Pagination
            prevHref={links.prev}
            nextHref={links.next}
            label="Announcement pages"
            className="border-t border-border"
          />
        </Card>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Branded posts to your announcement channels. Pings (@everyone, @here, roles) always need a second confirmation and the mass-mention permission."
        breadcrumbs={[{ label: 'Events & marketing', href: '/marketing' }, { label: 'Announcements' }]}
        actions={
          canCreate ? (
            <ButtonLink href="/marketing/announcements/new" variant="primary">
              New announcement
            </ButtonLink>
          ) : undefined
        }
      />
      <Tabs
        label="Announcements sections"
        defaultTab={firstParam(sp, 'tab') === 'templates' ? 'templates' : 'announcements'}
        items={[
          { id: 'announcements', label: 'Announcements', content: announcementsTab },
          {
            id: 'templates',
            label: `Templates (${templates.data.length})`,
            content: (
              <TemplatesManager
                templates={templates.data.map((t) => ({
                  id: t.id,
                  name: t.name,
                  type: t.type,
                  title: t.title,
                  body: t.body,
                }))}
                typeOptions={typeOptions}
              />
            ),
          },
        ]}
      />
    </>
  );
}
