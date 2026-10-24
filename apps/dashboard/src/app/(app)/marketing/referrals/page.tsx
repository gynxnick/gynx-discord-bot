import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing, type Ctx } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { AttributionsTable, type AttributionRow } from '@/components/marketing/referrals/AttributionsTable';
import { LinkTabs } from '@/components/marketing/referrals/LinkTabs';
import {
  ATTRIBUTION_STATUSES,
  CONFIDENCES,
  CONFIDENCE_LABELS,
  PERIODS,
  STATUS_LABELS,
  aggregateAttributionCounts,
  isAttributionStatus,
  isConfidence,
  parsePeriod,
} from '@/components/marketing/referrals/referral-utils';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import { Alert, EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { isSnowflake } from '@/lib/discord';
import { formatDateTime, formatNumber } from '@/lib/format';
import { firstParam, hrefWith, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Referrals' };

const BASE = '/marketing/referrals';

interface InviteRow {
  id: string;
  code: string;
  ownerId: string;
  campaign: string | null;
  partnerCampaign: string | null;
  partnerCampaignId: string | null;
  lastKnownUses: number;
  active: boolean;
  createdAtLabel: string;
}

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission(['referrals.view', 'referrals.manage'], 'marketing.referrals');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone, session } = page;
  const canManage = session.permissions.has('referrals.manage');
  const canPartners = session.permissions.has('partners.review');

  const view = firstParam(sp, 'view') === 'invites' ? 'invites' : 'attributions';
  const period = parsePeriod(firstParam(sp, 'period'));
  const { cursor } = readCursor(sp);

  // Explicit totals, including joins nobody was credited for (no service exposes these counts).
  const groups = await ctx.db.referralAttribution.groupBy({
    by: ['confidence', 'status'],
    where: { guildId: ctx.guildId },
    _count: { _all: true },
  });
  const counts = aggregateAttributionCounts(groups);
  const leaderboard = await load(() => marketing.referralLeaderboard(ctx, period));

  return (
    <>
      <PageHeader
        title="Referrals"
        description="Who brought new members in, measured from Discord invite use counts. Only confirmed joins through a tracked invite credit anyone."
        breadcrumbs={[{ label: 'Events & marketing', href: '/marketing' }, { label: 'Referrals' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Counted referrals"
          value={formatNumber(counts.counted)}
          hint="Confirmed + valid, all time"
          tone="success"
        />
        <StatCard
          label="Under review"
          value={formatNumber(counts.underReview)}
          hint={`${formatNumber(counts.byStatus.FLAGGED)} flagged · ${formatNumber(counts.byStatus.DISPUTED)} disputed`}
          tone={counts.underReview ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Ambiguous joins"
          value={formatNumber(counts.byConfidence.AMBIGUOUS)}
          hint="Nobody credited"
          href={hrefWith(BASE, sp, { view: undefined, confidence: 'AMBIGUOUS', status: undefined })}
        />
        <StatCard
          label="Unknown joins"
          value={formatNumber(counts.byConfidence.UNKNOWN)}
          hint="Nobody credited"
          href={hrefWith(BASE, sp, { view: undefined, confidence: 'UNKNOWN', status: undefined })}
        />
      </div>

      <Alert tone="info" title="How joins are attributed" className="mb-6">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Confirmed</strong>: exactly one invite’s use count went up when the member joined. The
            invite’s owner is credited only if it is an active tracked invite.
          </li>
          <li>
            <strong>Ambiguous</strong>: several invites went up at the same time (simultaneous joins), so we
            can’t tell which one was used. Nobody is credited.
          </li>
          <li>
            <strong>Unknown</strong>: no tracked use count changed — e.g. the vanity URL, an expired or
            one-time invite, server discovery, or missing data. Nobody is credited.
          </li>
          <li>
            Leaderboards and totals count <strong>confirmed + valid</strong> joins only. Suspicious joins (new
            accounts, rejoins, self-referrals, bursts) are flagged and excluded until a referral manager
            reviews them.
          </li>
        </ul>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <LinkTabs
              label="Referral data"
              items={[
                {
                  href: hrefWith(BASE, sp, { view: undefined }),
                  label: 'Attributions',
                  active: view === 'attributions',
                  count: counts.total,
                },
                {
                  href: hrefWith(BASE, sp, { view: 'invites' }),
                  label: 'Invites',
                  active: view === 'invites',
                },
              ]}
            />
            {view === 'attributions' ? (
              <AttributionsSection
                sp={sp}
                cursor={cursor}
                canManage={canManage}
                counts={counts}
                timezone={timezone}
                ctx={ctx}
                period={period}
              />
            ) : (
              <InvitesSection
                sp={sp}
                cursor={cursor}
                timezone={timezone}
                ctx={ctx}
                period={period}
                canPartners={canPartners}
              />
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader
            title="Leaderboard"
            description="Top 10 referrers. Counted = confirmed + valid joins only."
          />
          <nav
            aria-label="Leaderboard period"
            className="flex flex-wrap gap-1 border-b border-border px-4 py-2"
          >
            {PERIODS.map((p) => (
              <Link
                key={p.value}
                href={hrefWith(BASE, sp, {
                  period: p.value === '30' ? undefined : p.value,
                  view: view === 'invites' ? 'invites' : undefined,
                })}
                aria-current={period === p.value ? 'page' : undefined}
                className={cn(
                  'rounded px-2 py-1 text-xs no-underline hover:no-underline',
                  period === p.value
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {p.label}
              </Link>
            ))}
          </nav>
          {!leaderboard.ok ? (
            <div className="p-4">
              <ModuleNotice title="Leaderboard" message={leaderboard.message} inline />
            </div>
          ) : leaderboard.data.length === 0 ? (
            <EmptyState
              title="No counted referrals in this period"
              description="Flagged, disputed and uncredited joins never appear here."
            />
          ) : (
            <ol className="divide-y divide-border">
              {leaderboard.data.map((r) => (
                <li
                  key={r.referrerId}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-right tabular-nums text-fg-muted">{r.rank}.</span>
                    <Link
                      href={hrefWith(BASE, sp, { view: undefined, referrerId: r.referrerId })}
                      className="truncate font-mono text-xs"
                      title="Show this referrer’s attributions"
                    >
                      {r.referrerId}
                    </Link>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium">{formatNumber(r.referrals)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

function FilterLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-fg-muted">
      {children}
    </label>
  );
}

async function AttributionsSection({
  sp,
  cursor,
  canManage,
  counts,
  timezone,
  ctx,
  period,
}: {
  sp: SearchParams;
  cursor: string | undefined;
  canManage: boolean;
  counts: ReturnType<typeof aggregateAttributionCounts>;
  timezone: string;
  ctx: Ctx;
  period: string;
}) {
  const confidenceRaw = firstParam(sp, 'confidence');
  const statusRaw = firstParam(sp, 'status');
  const referrerRaw = firstParam(sp, 'referrerId');
  const confidence = isConfidence(confidenceRaw) ? confidenceRaw : undefined;
  const status = isAttributionStatus(statusRaw) ? statusRaw : undefined;
  const referrerId = isSnowflake(referrerRaw) ? referrerRaw : undefined;
  const filtered = Boolean(confidence || status || referrerId);

  const list = await load(() =>
    marketing.listAttributions(ctx, { confidence, status, referrerId, cursor, limit: 50 }),
  );
  if (!list.ok)
    return (
      <div className="p-4">
        <ModuleNotice title="Attributions" message={list.message} inline />
      </div>
    );
  const rows: AttributionRow[] = list.data.items.map((a) => ({
    id: a.id,
    joinedUserId: a.joinedUserId,
    referrerId: a.referrerId,
    inviteCode: a.inviteCode,
    campaign: a.campaign,
    confidence: a.confidence,
    status: a.status,
    flagReason: a.flagReason,
    reviewNote: a.reviewNote,
    reviewedById: a.reviewedById,
    joinedAtLabel: formatDateTime(a.joinedAt, timezone),
  }));
  const links = pageLinks(BASE, sp, list.data.nextCursor);

  return (
    <>
      <form
        method="get"
        action={BASE}
        className="flex flex-wrap items-end gap-3 border-b border-border p-4"
        role="search"
        aria-label="Filter attributions"
      >
        {period !== '30' && <input type="hidden" name="period" value={period} />}
        <div className="w-full sm:w-48">
          <FilterLabel htmlFor="f-confidence">Confidence</FilterLabel>
          <Select
            id="f-confidence"
            name="confidence"
            defaultValue={confidence ?? ''}
            placeholder={`Any confidence (${formatNumber(counts.total)})`}
            options={CONFIDENCES.map((c) => ({
              value: c,
              label: `${CONFIDENCE_LABELS[c]} (${formatNumber(counts.byConfidence[c])})`,
            }))}
          />
        </div>
        <div className="w-full sm:w-48">
          <FilterLabel htmlFor="f-status">Status</FilterLabel>
          <Select
            id="f-status"
            name="status"
            defaultValue={status ?? ''}
            placeholder="Any status"
            options={ATTRIBUTION_STATUSES.map((s) => ({
              value: s,
              label: `${STATUS_LABELS[s]} (${formatNumber(counts.byStatus[s])})`,
            }))}
          />
        </div>
        <div className="w-full sm:w-52">
          <FilterLabel htmlFor="f-referrer">Referrer ID</FilterLabel>
          <Input
            id="f-referrer"
            name="referrerId"
            defaultValue={referrerRaw ?? ''}
            inputMode="numeric"
            pattern="\d{17,20}"
            placeholder="Discord user ID"
            maxLength={20}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered && (
            <ButtonLink
              href={hrefWith(BASE, sp, { confidence: undefined, status: undefined, referrerId: undefined })}
              variant="ghost"
            >
              Clear
            </ButtonLink>
          )}
        </div>
        {referrerRaw && !referrerId && (
          <p className="w-full text-xs text-danger">
            “{referrerRaw.slice(0, 30)}” is not a Discord user ID; the referrer filter was ignored.
          </p>
        )}
      </form>
      {canManage && counts.underReview > 0 && status !== 'FLAGGED' && status !== 'DISPUTED' && (
        <p className="border-b border-border px-4 py-2 text-xs text-fg-muted">
          <Badge tone="warning">{formatNumber(counts.underReview)}</Badge> attributions wait for review —{' '}
          <Link href={hrefWith(BASE, sp, { status: 'FLAGGED', confidence: undefined })}>show flagged</Link> or{' '}
          <Link href={hrefWith(BASE, sp, { status: 'DISPUTED', confidence: undefined })}>disputed</Link>.
        </p>
      )}
      <AttributionsTable rows={rows} canManage={canManage} filtered={filtered} />
      <Pagination prevHref={links.prev} nextHref={links.next} label="Attribution pages" />
    </>
  );
}

async function InvitesSection({
  sp,
  cursor,
  timezone,
  ctx,
  period,
  canPartners,
}: {
  sp: SearchParams;
  cursor: string | undefined;
  timezone: string;
  ctx: Ctx;
  period: string;
  canPartners: boolean;
}) {
  const ownerRaw = firstParam(sp, 'ownerId');
  const ownerId = isSnowflake(ownerRaw) ? ownerRaw : undefined;
  const campaign = firstParam(sp, 'campaign')?.trim().slice(0, 64) || undefined;
  const filtered = Boolean(ownerId || campaign);

  const list = await load(() => marketing.listReferralInvites(ctx, { ownerId, campaign, cursor, limit: 50 }));
  if (!list.ok)
    return (
      <div className="p-4">
        <ModuleNotice title="Invites" message={list.message} inline />
      </div>
    );

  // Partner campaign names (partner reviewers only; others see the campaign ID).
  const names = new Map<string, string>();
  if (canPartners && list.data.items.some((i) => i.partnerCampaignId)) {
    const pcs = await load(() => marketing.listPartnerCampaigns(ctx, { limit: 100 }));
    if (pcs.ok) for (const c of pcs.data.items) names.set(c.id, c.name);
  }
  const rows: InviteRow[] = list.data.items.map((i) => ({
    id: i.id,
    code: i.code,
    ownerId: i.ownerId,
    campaign: i.campaign,
    partnerCampaignId: i.partnerCampaignId,
    partnerCampaign: i.partnerCampaignId ? (names.get(i.partnerCampaignId) ?? null) : null,
    lastKnownUses: i.lastKnownUses,
    active: i.active,
    createdAtLabel: formatDateTime(i.createdAt, timezone),
  }));
  const links = pageLinks(BASE, sp, list.data.nextCursor);

  const columns: Column<InviteRow>[] = [
    { key: 'code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'owner', header: 'Owner', cell: (r) => <span className="font-mono text-xs">{r.ownerId}</span> },
    {
      key: 'campaign',
      header: 'Campaign',
      cell: (r) => r.campaign ?? <span className="text-fg-muted">Personal</span>,
    },
    {
      key: 'partner',
      header: 'Partner campaign',
      hideOnMobile: true,
      cell: (r) =>
        !r.partnerCampaignId ? (
          <span className="text-fg-muted">—</span>
        ) : canPartners ? (
          <Link href={`/marketing/partners/campaigns/${encodeURIComponent(r.partnerCampaignId)}`}>
            {r.partnerCampaign ?? r.partnerCampaignId}
          </Link>
        ) : (
          <span className="font-mono text-xs">{r.partnerCampaignId}</span>
        ),
    },
    {
      key: 'uses',
      header: 'Last known uses',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{formatNumber(r.lastKnownUses)}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      cell: (r) => (r.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
    },
    {
      key: 'created',
      header: 'Created',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.createdAtLabel}</span>,
    },
  ];

  return (
    <>
      <form
        method="get"
        action={BASE}
        className="flex flex-wrap items-end gap-3 border-b border-border p-4"
        role="search"
        aria-label="Filter invites"
      >
        <input type="hidden" name="view" value="invites" />
        {period !== '30' && <input type="hidden" name="period" value={period} />}
        <div className="w-full sm:w-52">
          <FilterLabel htmlFor="f-owner">Owner ID</FilterLabel>
          <Input
            id="f-owner"
            name="ownerId"
            defaultValue={ownerRaw ?? ''}
            inputMode="numeric"
            pattern="\d{17,20}"
            placeholder="Discord user ID"
            maxLength={20}
          />
        </div>
        <div className="w-full sm:w-52">
          <FilterLabel htmlFor="f-campaign">Campaign</FilterLabel>
          <Input
            id="f-campaign"
            name="campaign"
            defaultValue={campaign ?? ''}
            placeholder="Exact campaign name"
            maxLength={64}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered && (
            <ButtonLink
              href={hrefWith(BASE, sp, { ownerId: undefined, campaign: undefined })}
              variant="ghost"
            >
              Clear
            </ButtonLink>
          )}
        </div>
        {ownerRaw && !ownerId && (
          <p className="w-full text-xs text-danger">
            “{ownerRaw.slice(0, 30)}” is not a Discord user ID; the owner filter was ignored.
          </p>
        )}
      </form>
      <p className="border-b border-border px-4 py-2 text-xs text-fg-muted">
        Use counts are the last values the bot saw on Discord. Inactive invites no longer credit anyone; the
        Discord invite itself may still exist.
      </p>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Tracked referral invites"
        empty={
          <EmptyState
            title={filtered ? 'No invites match these filters' : 'No tracked invites yet'}
            description={
              filtered
                ? 'Campaign filters match the exact name.'
                : 'Members create personal invites with the bot’s referral command; staff create campaign invites.'
            }
          />
        }
      />
      <Pagination prevHref={links.prev} nextHref={links.next} label="Invite pages" />
    </>
  );
}
