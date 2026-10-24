import type { Metadata } from 'next';
import { marketing } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { campaignOptions, trackedLinkUrl } from '@/components/marketing/links/link-utils';
import { LinksManager, type LinkRowView } from '@/components/marketing/links/LinksManager';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Form';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime, formatNumber } from '@/lib/format';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Tracked links' };

export default async function TrackedLinksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission(
    ['announcements.create', 'referrals.manage', 'partners.review'],
    'marketing.links',
  );
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone, session } = page;
  const has = (k: Parameters<typeof session.permissions.has>[0]) => session.permissions.has(k);
  // The link API declares announcements.create (apiRoute takes one key), so only those staff can create/toggle here.
  const canManage = has('announcements.create');

  const campaign = firstParam(sp, 'campaign')?.trim().slice(0, 64) || undefined;
  const list = await load(() =>
    marketing.listTrackedLinks(ctx, { campaign, cursor: readCursor(sp).cursor, limit: 50 }),
  );
  if (!list.ok) return <ModuleNotice title="Tracked links" message={list.message} />;

  // Names for linked records (best effort: recent ones; others show a generic label).
  const announcements =
    has('announcements.create') || has('announcements.publish')
      ? await load(() => marketing.listAnnouncements(ctx, { limit: 100 }))
      : null;
  const partnerCampaigns = has('partners.review')
    ? await load(() => marketing.listPartnerCampaigns(ctx, { limit: 100 }))
    : null;
  const allForCampaigns = campaign ? await load(() => marketing.listTrackedLinks(ctx, { limit: 100 })) : list;

  const annTitle = new Map((announcements?.ok ? announcements.data.items : []).map((a) => [a.id, a.title]));
  const partnerName = new Map(
    (partnerCampaigns?.ok ? partnerCampaigns.data.items : []).map((c) => [c.id, c.name]),
  );

  const rows: LinkRowView[] = list.data.items.map((l) => ({
    id: l.id,
    url: trackedLinkUrl(ctx.dashboardUrl, l.slug),
    targetUrl: l.targetUrl,
    campaign: l.campaign,
    announcement: l.announcementId
      ? { id: l.announcementId, title: annTitle.get(l.announcementId) ?? 'Linked announcement' }
      : null,
    partnerCampaign: l.partnerCampaignId
      ? (partnerName.get(l.partnerCampaignId) ?? 'Partner campaign')
      : null,
    clicks: l.clicks,
    active: l.active,
    createdLabel: formatDateTime(l.createdAt, timezone),
  }));
  const campaigns = campaignOptions(
    (allForCampaigns.ok ? allForCampaigns.data.items : []).map((l) => l.campaign),
  );
  const links = pageLinks('/marketing/links', sp, list.data.nextCursor);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);

  return (
    <>
      <PageHeader
        title="Tracked links"
        description="Short redirect links that count clicks for announcements, partner posts and campaigns."
        breadcrumbs={[{ label: 'Events & marketing', href: '/marketing' }, { label: 'Tracked links' }]}
      />

      <Alert tone="info" title="Privacy" className="mb-6">
        Only a click counter is stored for each link. No IP addresses, user agents, referrers or other visitor
        data are recorded.
      </Alert>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Links (this page)"
          value={formatNumber(rows.length)}
          hint={`${rows.filter((r) => r.active).length} active`}
        />
        <StatCard label="Clicks (this page)" value={formatNumber(clicks)} />
        <StatCard
          label="Campaigns"
          value={formatNumber(campaigns.length)}
          hint="Among the latest 100 links"
        />
      </div>

      {!canManage && (
        <Alert tone="warning" className="mb-6">
          You can view tracked links. Creating or deactivating links from the dashboard currently needs the
          announcements create permission.
        </Alert>
      )}

      <div className="space-y-4">
        <Card>
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 p-4"
            role="search"
            aria-label="Filter tracked links"
          >
            <div className="w-full sm:w-64">
              <label htmlFor="f-campaign" className="mb-1 block text-xs text-fg-muted">
                Campaign
              </label>
              <Input
                id="f-campaign"
                name="campaign"
                defaultValue={campaign ?? ''}
                placeholder="Exact campaign name"
                maxLength={64}
                list="f-campaigns"
              />
              <datalist id="f-campaigns">
                {campaigns.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              {campaign && (
                <ButtonLink href="/marketing/links" variant="ghost">
                  Clear
                </ButtonLink>
              )}
            </div>
          </form>
        </Card>
        <LinksManager
          links={rows}
          announcements={(announcements?.ok ? announcements.data.items : []).map((a) => ({
            id: a.id,
            title: a.title,
          }))}
          campaigns={campaigns}
          canManage={canManage}
          filtered={Boolean(campaign)}
        />
        <Pagination
          prevHref={links.prev}
          nextHref={links.next}
          label="Tracked link pages"
          className="rounded-lg border border-border bg-surface"
        />
      </div>
    </>
  );
}
