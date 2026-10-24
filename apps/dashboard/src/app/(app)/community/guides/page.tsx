import type { Metadata } from 'next';
import { community } from '@gynx/services';
import { GuidesManager } from '@/components/community/GuidesManager';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime, formatNumber } from '@/lib/format';
import { pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Guides' };

export default async function GuidesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('community.manage', 'community.guides');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;

  const list = await load(() => community.listAllGuides(ctx, { cursor: readCursor(sp).cursor, limit: 50 }));
  if (!list.ok) return <ModuleNotice title="Guides" message={list.message} />;
  const facets = await load(() => community.guideFacets(ctx));
  const items = list.data.items;
  const links = pageLinks('/community/guides', sp, list.data.nextCursor);
  // Suggest existing categories/games (drafts included) for consistent naming.
  const categories = [
    ...new Set([...(facets.ok ? facets.data.categories : []), ...items.map((g) => g.category)]),
  ].sort();
  const games = [
    ...new Set([...(facets.ok ? facets.data.games : []), ...items.flatMap((g) => (g.game ? [g.game] : []))]),
  ].sort();

  return (
    <>
      <PageHeader
        title="Guides"
        description="Links to setup guides and tutorials that members browse with /guides."
        breadcrumbs={[{ label: 'Community', href: '/community' }, { label: 'Guides' }]}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Guides (this page)"
          value={formatNumber(items.length)}
          hint={`${items.filter((g) => g.published).length} published`}
        />
        <StatCard label="Views (this page)" value={formatNumber(items.reduce((s, g) => s + g.views, 0))} />
        <StatCard
          label="Helpful votes"
          value={`${formatNumber(items.reduce((s, g) => s + g.helpfulYes, 0))} / ${formatNumber(items.reduce((s, g) => s + g.helpfulNo, 0))}`}
          hint="yes / no"
        />
      </div>
      <GuidesManager
        rows={items.map((g) => ({
          id: g.id,
          title: g.title,
          slug: g.slug,
          category: g.category,
          game: g.game,
          summary: g.summary,
          url: g.url,
          published: g.published,
          views: g.views,
          helpfulYes: g.helpfulYes,
          helpfulNo: g.helpfulNo,
          updatedAtLabel: formatDateTime(g.updatedAt, timezone),
        }))}
        categories={categories}
        games={games}
      />
      <Pagination
        prevHref={links.prev}
        nextHref={links.next}
        label="Guide pages"
        className="mt-4 rounded-lg border border-border bg-surface"
      />
    </>
  );
}
