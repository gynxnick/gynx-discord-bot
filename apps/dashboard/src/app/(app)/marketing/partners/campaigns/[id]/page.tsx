import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { marketing } from '@gynx/services';
import { toZonedInput } from '@/components/community/datetime';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { CampaignEditForm } from '@/components/marketing/partners/CampaignEditForm';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime, formatNumber } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Partner campaign' };

interface LinkRow {
  slug: string;
  targetUrl: string;
  clicks: number;
  active: boolean;
}
interface InviteRow {
  code: string;
  active: boolean;
}

export default async function PartnerCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission('partners.review', 'marketing.partners.campaign');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  const { ctx, timezone, session } = page;

  const res = await load(() => marketing.partnerCampaignAnalytics(ctx, id));
  if (!res.ok) {
    if (res.code === 'NOT_FOUND') notFound();
    return <ModuleNotice title="Partner campaign" message={res.message} />;
  }
  const a = res.data;
  const c = a.campaign;

  const linkColumns: Column<LinkRow>[] = [
    { key: 'slug', header: 'Slug', cell: (l) => <span className="font-mono text-xs">{l.slug}</span> },
    // Target shown as plain text: it is partner-supplied, so it is never rendered as a clickable link here.
    {
      key: 'target',
      header: 'Target',
      cell: (l) => <span className="block max-w-xs break-all text-xs text-fg-muted">{l.targetUrl}</span>,
    },
    {
      key: 'clicks',
      header: 'Clicks',
      align: 'right',
      cell: (l) => <span className="tabular-nums">{formatNumber(l.clicks)}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      cell: (l) => (l.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
    },
  ];
  const inviteColumns: Column<InviteRow>[] = [
    { key: 'code', header: 'Invite code', cell: (i) => <span className="font-mono text-xs">{i.code}</span> },
    {
      key: 'active',
      header: 'Status',
      cell: (i) => (i.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <>
            Partner <span className="font-mono text-xs">{c.partnerId}</span> · started{' '}
            {formatDateTime(c.startsAt, timezone)} ·{' '}
            {c.endsAt ? `ends ${formatDateTime(c.endsAt, timezone)}` : 'no end date'}
          </>
        }
        breadcrumbs={[
          { label: 'Events & marketing', href: '/marketing' },
          { label: 'Partners', href: '/marketing/partners?view=campaigns' },
          { label: c.name },
        ]}
        actions={
          <>
            {c.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
            {c.canAnnounce && <Badge tone="warning">May announce</Badge>}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Valid joins"
          value={formatNumber(a.validJoins)}
          hint="Confirmed + valid via campaign invites"
          tone="success"
        />
        <StatCard
          label="Joins under review"
          value={formatNumber(a.joinsUnderReview)}
          hint="Flagged or disputed — not counted"
          tone={a.joinsUnderReview ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Link clicks"
          value={formatNumber(a.linkClicks)}
          hint={`${formatNumber(a.links.length)} tracked links`}
        />
        <StatCard
          label="Invites"
          value={formatNumber(a.invites.length)}
          hint={`${formatNumber(a.invites.filter((i) => i.active).length)} active`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Tracked links"
              description="Click counts for links tied to this campaign. Measured outcomes only."
            />
            <Table
              columns={linkColumns}
              rows={a.links}
              rowKey={(l) => l.slug}
              caption="Campaign tracked links"
              empty={
                <EmptyState
                  title="No tracked links"
                  description="Create one under Tracked links and attach it to this campaign."
                />
              }
            />
          </Card>
          <Card>
            <CardHeader
              title="Invites"
              description="Joins via these invites count for the campaign once confirmed and valid."
            />
            <Table
              columns={inviteColumns}
              rows={a.invites}
              rowKey={(i) => i.code}
              caption="Campaign invites"
              empty={
                <EmptyState
                  title="No campaign invites"
                  description="Referral managers or partner reviewers can create partner-campaign invites."
                />
              }
            />
          </Card>
        </div>
        <CampaignEditForm
          campaignId={c.id}
          timezone={timezone}
          canSettings={session.permissions.has('settings.manage')}
          initial={{
            name: c.name,
            active: c.active,
            endsAt: toZonedInput(c.endsAt, timezone),
            canAnnounce: c.canAnnounce,
          }}
        />
      </div>
    </>
  );
}
