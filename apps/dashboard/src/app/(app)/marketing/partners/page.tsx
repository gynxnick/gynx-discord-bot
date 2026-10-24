import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing, type Ctx } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { LinkTabs } from '@/components/marketing/referrals/LinkTabs';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  isApplicationStatus,
} from '@/components/marketing/partners/partner-utils';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Table, type Column } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';
import { firstParam, hrefWith, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Partners' };

const BASE = '/marketing/partners';

type Category = (typeof marketing.PARTNER_CATEGORIES)[number];
const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (marketing.PARTNER_CATEGORIES as readonly string[]).includes(v);

export default async function PartnersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('partners.review', 'marketing.partners');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;
  const view = firstParam(sp, 'view') === 'campaigns' ? 'campaigns' : 'applications';

  return (
    <>
      <PageHeader
        title="Partners"
        description="Partner applications submitted through the bot, and the campaigns created when one is approved."
        breadcrumbs={[{ label: 'Events & marketing', href: '/marketing' }, { label: 'Partners' }]}
      />
      <Card>
        <LinkTabs
          label="Partner data"
          items={[
            { href: BASE, label: 'Applications', active: view === 'applications' },
            { href: `${BASE}?view=campaigns`, label: 'Campaigns', active: view === 'campaigns' },
          ]}
        />
        {view === 'applications' ? (
          <ApplicationsSection sp={sp} ctx={ctx} timezone={timezone} />
        ) : (
          <CampaignsSection sp={sp} ctx={ctx} timezone={timezone} />
        )}
      </Card>
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

interface ApplicationRow {
  id: string;
  ref: string;
  applicantId: string;
  category: string;
  status: string;
  reviewerId: string | null;
  createdAtLabel: string;
  reviewedAtLabel: string | null;
}

async function ApplicationsSection({ sp, ctx, timezone }: { sp: SearchParams; ctx: Ctx; timezone: string }) {
  const statusRaw = firstParam(sp, 'status');
  const categoryRaw = firstParam(sp, 'category');
  const status = isApplicationStatus(statusRaw) ? statusRaw : undefined;
  const category = isCategory(categoryRaw) ? categoryRaw : undefined;
  const filtered = Boolean(status || category);

  const list = await load(() =>
    marketing.listPartnerApplications(ctx, { status, category, cursor: readCursor(sp).cursor, limit: 50 }),
  );
  if (!list.ok)
    return (
      <div className="p-4">
        <ModuleNotice title="Applications" message={list.message} inline />
      </div>
    );
  const rows: ApplicationRow[] = list.data.items.map((a) => ({
    id: a.id,
    ref: a.ref,
    applicantId: a.applicantId,
    category: marketing.PARTNER_CATEGORY_LABELS[a.category],
    status: a.status,
    reviewerId: a.reviewerId,
    createdAtLabel: formatDateTime(a.createdAt, timezone),
    reviewedAtLabel: a.reviewedAt ? formatDateTime(a.reviewedAt, timezone) : null,
  }));
  const links = pageLinks(BASE, sp, list.data.nextCursor);
  const href = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

  const columns: Column<ApplicationRow>[] = [
    {
      key: 'ref',
      header: 'Application',
      cell: (r) => (
        <Link href={href(r.id)} className="font-medium">
          {r.ref}
        </Link>
      ),
    },
    { key: 'category', header: 'Category', cell: (r) => r.category },
    {
      key: 'status',
      header: 'Status',
      cell: (r) =>
        isApplicationStatus(r.status) ? (
          <Badge tone={APPLICATION_STATUS_TONES[r.status]} dot>
            {APPLICATION_STATUS_LABELS[r.status]}
          </Badge>
        ) : (
          <Badge>{r.status}</Badge>
        ),
    },
    {
      key: 'applicant',
      header: 'Applicant',
      hideOnMobile: true,
      cell: (r) => <span className="font-mono text-xs">{r.applicantId}</span>,
    },
    {
      key: 'reviewer',
      header: 'Reviewer',
      hideOnMobile: true,
      cell: (r) =>
        r.reviewerId ? (
          <span className="font-mono text-xs">{r.reviewerId}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
    {
      key: 'created',
      header: 'Submitted',
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.createdAtLabel}</span>,
    },
    {
      key: 'decided',
      header: 'Decided',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.reviewedAtLabel ?? '—'}</span>,
    },
    {
      key: 'open',
      header: <span className="sr-only">Open</span>,
      align: 'right',
      cell: (r) => (
        <ButtonLink href={href(r.id)} size="sm" variant="ghost" aria-label={`Open ${r.ref}`}>
          Open
        </ButtonLink>
      ),
    },
  ];

  return (
    <>
      <form
        method="get"
        action={BASE}
        className="flex flex-wrap items-end gap-3 border-b border-border p-4"
        role="search"
        aria-label="Filter applications"
      >
        <div className="w-full sm:w-48">
          <FilterLabel htmlFor="f-status">Status</FilterLabel>
          <Select
            id="f-status"
            name="status"
            defaultValue={status ?? ''}
            placeholder="Any status"
            options={APPLICATION_STATUSES.map((s) => ({ value: s, label: APPLICATION_STATUS_LABELS[s] }))}
          />
        </div>
        <div className="w-full sm:w-52">
          <FilterLabel htmlFor="f-category">Category</FilterLabel>
          <Select
            id="f-category"
            name="category"
            defaultValue={category ?? ''}
            placeholder="Any category"
            options={marketing.PARTNER_CATEGORIES.map((c) => ({
              value: c,
              label: marketing.PARTNER_CATEGORY_LABELS[c],
            }))}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered && (
            <ButtonLink href={BASE} variant="ghost">
              Clear
            </ButtonLink>
          )}
        </div>
        <p className="w-full text-xs text-fg-muted">
          Oldest first, so the longest-waiting applications are at the top.
        </p>
      </form>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Partner applications"
        empty={
          <EmptyState
            title={filtered ? 'No applications match these filters' : 'No partner applications yet'}
            description={
              filtered
                ? 'Try another status or category.'
                : 'Members apply through the bot’s partner command.'
            }
          />
        }
      />
      <Pagination prevHref={links.prev} nextHref={links.next} label="Application pages" />
    </>
  );
}

interface CampaignRow {
  id: string;
  name: string;
  partnerId: string;
  active: boolean;
  canAnnounce: boolean;
  startsAtLabel: string;
  endsAtLabel: string;
  applicationId: string;
}

async function CampaignsSection({ sp, ctx, timezone }: { sp: SearchParams; ctx: Ctx; timezone: string }) {
  const activeRaw = firstParam(sp, 'active');
  const active = activeRaw === 'true' ? true : activeRaw === 'false' ? false : undefined;

  const list = await load(() =>
    marketing.listPartnerCampaigns(ctx, { active, cursor: readCursor(sp).cursor, limit: 50 }),
  );
  if (!list.ok)
    return (
      <div className="p-4">
        <ModuleNotice title="Campaigns" message={list.message} inline />
      </div>
    );
  const rows: CampaignRow[] = list.data.items.map((c) => ({
    id: c.id,
    name: c.name,
    partnerId: c.partnerId,
    active: c.active,
    canAnnounce: c.canAnnounce,
    startsAtLabel: formatDateTime(c.startsAt, timezone),
    endsAtLabel: c.endsAt ? formatDateTime(c.endsAt, timezone) : 'No end date',
    applicationId: c.applicationId,
  }));
  const links = pageLinks(BASE, sp, list.data.nextCursor);
  const href = (id: string) => `${BASE}/campaigns/${encodeURIComponent(id)}`;

  const columns: Column<CampaignRow>[] = [
    {
      key: 'name',
      header: 'Campaign',
      cell: (r) => (
        <Link href={href(r.id)} className="font-medium">
          {r.name}
        </Link>
      ),
    },
    {
      key: 'partner',
      header: 'Partner',
      cell: (r) => <span className="font-mono text-xs">{r.partnerId}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      cell: (r) => (r.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
    },
    {
      key: 'announce',
      header: 'May announce',
      hideOnMobile: true,
      cell: (r) =>
        r.canAnnounce ? <Badge tone="warning">Yes</Badge> : <span className="text-fg-muted">No</span>,
    },
    {
      key: 'starts',
      header: 'Started',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.startsAtLabel}</span>,
    },
    {
      key: 'ends',
      header: 'Ends',
      hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-fg-muted">{r.endsAtLabel}</span>,
    },
    {
      key: 'application',
      header: <span className="sr-only">Links</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <ButtonLink
            href={`${BASE}/${encodeURIComponent(r.applicationId)}`}
            size="sm"
            variant="ghost"
            aria-label={`Application for ${r.name}`}
          >
            Application
          </ButtonLink>
          <ButtonLink
            href={href(r.id)}
            size="sm"
            variant="ghost"
            aria-label={`Analytics and settings for ${r.name}`}
          >
            Analytics
          </ButtonLink>
        </div>
      ),
    },
  ];

  return (
    <>
      <form
        method="get"
        action={BASE}
        className="flex flex-wrap items-end gap-3 border-b border-border p-4"
        role="search"
        aria-label="Filter campaigns"
      >
        <input type="hidden" name="view" value="campaigns" />
        <div className="w-full sm:w-44">
          <FilterLabel htmlFor="f-active">Status</FilterLabel>
          <Select
            id="f-active"
            name="active"
            defaultValue={activeRaw ?? ''}
            placeholder="Any status"
            options={[
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ]}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {active !== undefined && (
            <ButtonLink href={hrefWith(BASE, sp, { active: undefined })} variant="ghost">
              Clear
            </ButtonLink>
          )}
        </div>
      </form>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Partner campaigns"
        empty={
          <EmptyState
            title={active !== undefined ? 'No campaigns match this filter' : 'No partner campaigns yet'}
            description="A campaign is created automatically when an application is approved."
          />
        }
      />
      <Pagination prevHref={links.prev} nextHref={links.next} label="Campaign pages" />
    </>
  );
}
