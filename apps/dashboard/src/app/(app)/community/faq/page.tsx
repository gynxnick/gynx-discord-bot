import type { Metadata } from 'next';
import { community } from '@gynx/services';
import { FaqCategoriesCard, FaqEntriesTable, type FaqEntryRow } from '@/components/community/FaqManager';
import { matchesQuery } from '@/components/community/form-utils';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader, StatCard } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime, formatNumber } from '@/lib/format';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'FAQ' };

export default async function FaqPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('community.manage', 'community.faq');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;

  const q = firstParam(sp, 'q');
  const categoryId = firstParam(sp, 'category');
  const publishedRaw = firstParam(sp, 'published');
  const published = publishedRaw === 'true' ? true : publishedRaw === 'false' ? false : undefined;

  const cats = await load(() => community.listFaqCategories(ctx));
  if (!cats.ok) return <ModuleNotice title="FAQ" message={cats.message} />;

  // Search narrows the current page of up to 100 entries (newest updates first).
  const entries = await load(() =>
    community.listFaqEntries(ctx, { categoryId, published, cursor: readCursor(sp).cursor, limit: 100 }),
  );
  const mostViewed = await load(() => community.mostViewedFaq(ctx, 5));
  const all = entries.ok ? entries.data.items : [];
  const rows: FaqEntryRow[] = all
    .filter((e) => matchesQuery(q, e.question, e.answer, e.keywords))
    .map((e) => ({
      id: e.id,
      categoryId: e.categoryId,
      question: e.question,
      answer: e.answer,
      keywords: e.keywords,
      links: community.parseLinks(e.links),
      published: e.published,
      views: e.views,
      helpfulYes: e.helpfulYes,
      helpfulNo: e.helpfulNo,
      updatedAtLabel: formatDateTime(e.updatedAt, timezone),
    }));
  const links = pageLinks('/community/faq', sp, entries.ok ? entries.data.nextCursor : null);
  const filtered = Boolean(q || categoryId || publishedRaw);
  const totalViews = all.reduce((s, e) => s + e.views, 0);
  const yes = all.reduce((s, e) => s + e.helpfulYes, 0);
  const no = all.reduce((s, e) => s + e.helpfulNo, 0);

  return (
    <>
      <PageHeader
        title="FAQ"
        description="Answers members find with /faq. Only published entries are visible to members; search ranks keyword matches first."
        breadcrumbs={[{ label: 'Community', href: '/community' }, { label: 'FAQ' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Entries (this page)"
          value={formatNumber(all.length)}
          hint={`${all.filter((e) => e.published).length} published`}
        />
        <StatCard label="Categories" value={formatNumber(cats.data.length)} />
        <StatCard label="Views (this page)" value={formatNumber(totalViews)} />
        <StatCard
          label="Helpful votes"
          value={`${formatNumber(yes)} / ${formatNumber(no)}`}
          hint="yes / no"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <form
              method="get"
              className="flex flex-wrap items-end gap-3 p-4"
              role="search"
              aria-label="Filter FAQ entries"
            >
              <div className="w-full sm:w-56">
                <label htmlFor="f-q" className="mb-1 block text-xs text-fg-muted">
                  Search
                </label>
                <Input
                  id="f-q"
                  name="q"
                  defaultValue={q ?? ''}
                  placeholder="Question, answer or keyword"
                  maxLength={100}
                />
              </div>
              <div className="w-full sm:w-48">
                <label htmlFor="f-cat" className="mb-1 block text-xs text-fg-muted">
                  Category
                </label>
                <Select
                  id="f-cat"
                  name="category"
                  defaultValue={categoryId ?? ''}
                  placeholder="Any category"
                  options={cats.data.map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <div className="w-full sm:w-40">
                <label htmlFor="f-pub" className="mb-1 block text-xs text-fg-muted">
                  Status
                </label>
                <Select
                  id="f-pub"
                  name="published"
                  defaultValue={publishedRaw ?? ''}
                  placeholder="Any status"
                  options={[
                    { value: 'true', label: 'Published' },
                    { value: 'false', label: 'Draft' },
                  ]}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="secondary">
                  Apply
                </Button>
                {filtered && (
                  <ButtonLink href="/community/faq" variant="ghost">
                    Clear
                  </ButtonLink>
                )}
              </div>
            </form>
          </Card>
          {!entries.ok ? (
            <ModuleNotice title="Entries" message={entries.message} inline />
          ) : (
            <>
              <FaqEntriesTable
                entries={rows}
                categories={cats.data.map((c) => ({
                  id: c.id,
                  name: c.name,
                  slug: c.slug,
                  sortOrder: c.sortOrder,
                  publishedCount: c.publishedCount,
                }))}
                filtered={filtered}
              />
              <Pagination
                prevHref={links.prev}
                nextHref={links.next}
                label="FAQ pages"
                className="rounded-lg border border-border bg-surface"
              />
            </>
          )}
        </div>
        <div className="space-y-6">
          <FaqCategoriesCard
            categories={cats.data.map((c) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
              sortOrder: c.sortOrder,
              publishedCount: c.publishedCount,
            }))}
          />
          <Card>
            <CardHeader title="Most viewed" description="Published entries only." />
            {!mostViewed.ok || mostViewed.data.length === 0 ? (
              <EmptyState title="No views yet" />
            ) : (
              <ol className="divide-y divide-border">
                {mostViewed.data.map((e, i) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="mr-2 text-fg-muted">{i + 1}.</span>
                      {e.question}
                    </span>
                    <span className="shrink-0 tabular-nums text-fg-muted">{formatNumber(e.views)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
