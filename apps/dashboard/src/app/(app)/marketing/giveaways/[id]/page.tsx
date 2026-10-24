import type { Metadata } from 'next';
import { engagement, requireModule } from '@gynx/services';
import { roleName } from '@/components/community/picker-utils';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load, loadRoles } from '@/components/community/server/data';
import { GiveawayActions } from '@/components/marketing/giveaways/GiveawayActions';
import {
  failedChecks,
  GIVEAWAY_STATUS_TONE,
  truncateHash,
} from '@/components/marketing/giveaways/giveaway-form';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Card, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Alert, EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime, formatNumber } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Giveaway' };

type DrawRow = Awaited<ReturnType<typeof engagement.getGiveawayAudit>>['draws'][number];

const mention = (id: string) => <span className="font-mono text-xs">{`<@${id}>`}</span>;

export default async function GiveawayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission('giveaways.manage', 'marketing.giveaways.detail');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  const { ctx, timezone } = page;

  const res = await load(async () => {
    await requireModule(ctx, 'engagement');
    return engagement.getGiveawayAudit(ctx, id);
  });
  if (!res.ok) return <ModuleNotice title="Giveaway" message={res.message} />;
  const { giveaway: g, entrantCount, draws } = res.data;
  const roles = g.requiredRoleIds.length > 0 ? await loadRoles(ctx) : { roles: [], error: false };
  const link = engagement.messageLink(ctx.guildId, g.channelId, g.messageId);
  const allValid = draws.every((d) => d.verification.valid);

  const columns: Column<DrawRow>[] = [
    { key: 'seq', header: '#', cell: (d) => <span className="tabular-nums">{d.seq}</span> },
    {
      key: 'kind',
      header: 'Kind',
      cell: (d) => <Badge tone={d.kind === 'INITIAL' ? 'accent' : 'warning'}>{d.kind}</Badge>,
    },
    {
      key: 'winners',
      header: 'Winners',
      cell: (d) =>
        d.winnerIds.length === 0 ? (
          <span className="text-fg-muted">No entrants</span>
        ) : (
          <ul className="min-w-[10rem] space-y-0.5">
            {d.winnerIds.map((w) => (
              <li key={w}>{mention(w)}</li>
            ))}
          </ul>
        ),
    },
    {
      key: 'pool',
      header: 'Entrants',
      align: 'right',
      cell: (d) => <span className="tabular-nums">{formatNumber(d.entrantCount)}</span>,
    },
    {
      key: 'hash',
      header: 'Entrants hash',
      hideOnMobile: true,
      cell: (d) => (
        <span className="font-mono text-xs" title={d.entrantsHash}>
          {truncateHash(d.entrantsHash)}
        </span>
      ),
    },
    {
      key: 'algo',
      header: 'Algorithm',
      hideOnMobile: true,
      cell: (d) => <span className="font-mono text-xs text-fg-muted">{d.algorithm}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      hideOnMobile: true,
      cell: (d) => <span className="text-fg-muted">{d.reason ?? '—'}</span>,
    },
    { key: 'by', header: 'Drawn by', hideOnMobile: true, cell: (d) => mention(d.drawnById) },
    {
      key: 'time',
      header: 'Time',
      cell: (d) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(d.createdAt, timezone)}</span>
      ),
    },
    {
      key: 'verify',
      header: 'Verification',
      cell: (d) => {
        if (d.verification.valid) {
          return (
            <Badge tone="success">
              <span aria-hidden="true">✓</span> Valid
            </Badge>
          );
        }
        return (
          <div className="min-w-[12rem] space-y-1">
            <Badge tone="danger">Failed</Badge>
            <ul className="text-xs text-danger">
              {failedChecks(d.verification).map((c) => (
                <li key={c} className="font-mono">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={g.prize}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={g.status} tone={GIVEAWAY_STATUS_TONE[g.status]} />
            <span>
              {g.status === 'ACTIVE' || g.status === 'SCHEDULED' ? 'Ends' : 'Ended'}{' '}
              {formatDateTime(g.endedAt ?? g.endsAt, timezone)}
            </span>
          </span>
        }
        breadcrumbs={[
          { label: 'Events & marketing', href: '/marketing' },
          { label: 'Giveaways', href: '/marketing/giveaways' },
          { label: g.prize },
        ]}
        actions={<GiveawayActions giveaway={{ id: g.id, prize: g.prize, status: g.status, entrantCount }} />}
      />

      <Alert tone="info" title="Free community prizes only" className="mb-6">
        No purchase, payment or paid entry is ever involved. Rerolls require a reason and are recorded
        permanently below.
      </Alert>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Entrants" value={formatNumber(entrantCount)} />
        <StatCard label="Winners per draw" value={formatNumber(g.winnerCount)} />
        <StatCard
          label="Draws"
          value={formatNumber(draws.length)}
          hint={draws.length === 0 ? 'Not drawn yet' : allValid ? 'All verified' : 'Verification failed'}
          tone={draws.length > 0 && !allValid ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title="Details" />
          <DescriptionList
            items={[
              { label: 'Started', value: formatDateTime(g.startsAt, timezone) },
              { label: 'Scheduled end', value: formatDateTime(g.endsAt, timezone) },
              {
                label: 'Description',
                value: g.description ? <span className="whitespace-pre-wrap">{g.description}</span> : '—',
              },
              {
                label: 'Required roles',
                value:
                  g.requiredRoleIds.length === 0 ? (
                    'Anyone'
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {g.requiredRoleIds.map((r) => (
                        <Badge key={r}>@{roleName(roles.roles, r)}</Badge>
                      ))}
                    </span>
                  ),
              },
              {
                label: 'Min account age',
                value: g.minAccountAgeDays > 0 ? `${g.minAccountAgeDays} day(s)` : 'None',
              },
              {
                label: 'Min time in server',
                value: g.minMemberDays > 0 ? `${g.minMemberDays} day(s)` : 'None',
              },
              {
                label: 'Channel',
                value: g.channelId ? <span className="font-mono text-xs">{`<#${g.channelId}>`}</span> : '—',
              },
              {
                label: 'Message',
                value: link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Open in Discord
                  </a>
                ) : (
                  'Not posted yet'
                ),
              },
            ]}
          />
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Draw audit"
            description="Each draw is re-verified against the stored entries: the entrant hash and count must match the pool, winners must be distinct entrants and the algorithm must be known."
          />
          <Table
            columns={columns}
            rows={draws}
            rowKey={(d) => d.id}
            caption="Giveaway draws"
            empty={
              <EmptyState
                title="No draws yet"
                description="The initial draw happens when the giveaway ends (or when you end it now)."
              />
            }
          />
        </Card>
      </div>
    </>
  );
}
