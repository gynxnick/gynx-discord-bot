import type { Metadata } from 'next';
import { engagement } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { SuggestionsBoard } from '@/components/community/SuggestionsBoard';
import { SUGGESTION_STATUSES, SUGGESTION_STATUS_LABELS } from '@/components/community/suggestion-payload';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime } from '@/lib/format';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Suggestions' };

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('suggestions.manage', 'community.suggestions');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;
  const { ctx, timezone } = page;

  const filters = {
    status: firstParam(sp, 'status'),
    q: firstParam(sp, 'q'),
    hidden: firstParam(sp, 'hidden') === '1',
  };
  const parsed = engagement.listSuggestionsSchema.safeParse({
    status: filters.status,
    q: filters.q,
    includeHidden: filters.hidden,
    cursor: readCursor(sp).cursor,
    limit: 25,
  });
  const result = parsed.success ? await load(() => engagement.listSuggestions(ctx, parsed.data)) : null;
  if (result && !result.ok) return <ModuleNotice title="Suggestions" message={result.message} />;
  const items = result?.ok ? result.data.items : [];

  // Resolve "duplicate of" references for display.
  const refById = new Map(items.map((s) => [s.id, s.ref]));
  const missing = [
    ...new Set(
      items.flatMap((s) => (s.duplicateOfId && !refById.has(s.duplicateOfId) ? [s.duplicateOfId] : [])),
    ),
  ];
  await Promise.all(
    missing.map(async (id) => {
      const r = await load(() => engagement.getSuggestion(ctx, id));
      if (r.ok) refById.set(id, r.data.ref);
    }),
  );

  const links = pageLinks('/community/suggestions', sp, result?.ok ? result.data.nextCursor : null);
  const hasFilters = Boolean(filters.status || filters.q || filters.hidden);

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="Member ideas from /suggest. Change a status to respond (the author is notified), or hide off-topic or abusive suggestions."
        breadcrumbs={[{ label: 'Community', href: '/community' }, { label: 'Suggestions' }]}
      />
      <Card className="mb-4">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 p-4"
          role="search"
          aria-label="Filter suggestions"
        >
          <div className="w-full sm:w-44">
            <label htmlFor="f-status" className="mb-1 block text-xs text-fg-muted">
              Status
            </label>
            <Select
              id="f-status"
              name="status"
              defaultValue={filters.status ?? ''}
              placeholder="Any status"
              options={SUGGESTION_STATUSES.map((s) => ({ value: s, label: SUGGESTION_STATUS_LABELS[s] }))}
            />
          </div>
          <div className="w-full sm:w-56">
            <label htmlFor="f-q" className="mb-1 block text-xs text-fg-muted">
              Reference or title
            </label>
            <Input id="f-q" name="q" defaultValue={filters.q ?? ''} placeholder="S-0042" maxLength={100} />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              name="hidden"
              value="1"
              defaultChecked={filters.hidden}
              className="h-4 w-4 accent-[#22D3EE]"
            />
            Include hidden
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {hasFilters && (
              <ButtonLink href="/community/suggestions" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
      </Card>
      {!parsed.success ? (
        <Alert tone="warning" title="Invalid filter">
          One of the filters is not valid. Clear the filters and try again.
        </Alert>
      ) : (
        <>
          <SuggestionsBoard
            filtered={hasFilters}
            rows={items.map((s) => ({
              id: s.id,
              ref: s.ref,
              title: s.title,
              body: s.body,
              authorId: s.authorId,
              status: s.status,
              staffResponse: s.staffResponse,
              duplicateOfRef: s.duplicateOfId ? (refById.get(s.duplicateOfId) ?? s.duplicateOfId) : null,
              hidden: s.hidden,
              upvotes: s.upvotes,
              downvotes: s.downvotes,
              createdAtLabel: formatDateTime(s.createdAt, timezone),
              messageLink: engagement.messageLink(ctx.guildId, s.channelId, s.messageId),
            }))}
          />
          <Pagination
            prevHref={links.prev}
            nextHref={links.next}
            label="Suggestion pages"
            className="mt-4 rounded-lg border border-border bg-surface"
          />
        </>
      )}
    </>
  );
}
