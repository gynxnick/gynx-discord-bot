import type { Metadata } from 'next';
import { games, troubleshooting } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import { ArticleManager } from '@/components/troubleshooting/ArticleManager';
import type { ArticleRow } from '@/components/troubleshooting/forms';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Knowledge base' };

type Article = Awaited<ReturnType<typeof troubleshooting.listArticles>>['items'][number];

const toRow = (a: Article): ArticleRow => ({
  id: a.id,
  slug: a.slug,
  title: a.title,
  summary: a.summary,
  body: a.body,
  game: a.game,
  tags: a.tags,
  url: a.url,
  published: a.published,
  views: a.views,
  helpfulYes: a.helpfulYes,
  helpfulNo: a.helpfulNo,
  updatedAt: a.updatedAt.toISOString(),
});

export default async function KnowledgeBasePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('troubleshooting.manage', 'troubleshooting.kb');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;

  const q = firstParam(sp, 'q')?.trim();
  const game = firstParam(sp, 'game');
  const publishedParam = firstParam(sp, 'published');
  const published = publishedParam === 'true' ? true : publishedParam === 'false' ? false : undefined;
  const { cursor } = readCursor(sp);
  const gameOptions = games.gameChoices().map((g) => ({ value: g.value, label: g.name }));

  let rows: ArticleRow[] = [];
  let nextCursor: string | null = null;
  let invalid: string | null =
    game && !troubleshooting.gameKeySchema.safeParse(game).success ? 'Unknown game filter.' : null;

  try {
    if (!invalid && q) {
      const parsed = troubleshooting.searchArticlesSchema.safeParse({
        query: q,
        game,
        cursor,
        limit: 25,
        includeDrafts: true,
      });
      if (!parsed.success) invalid = parsed.error.issues[0]?.message ?? 'Invalid search.';
      else {
        const res = await troubleshooting.searchArticles(page.ctx, parsed.data);
        rows = res.items
          .map((h) => h.article)
          .filter((a) => published === undefined || a.published === published)
          .map(toRow);
        nextCursor = res.nextCursor;
      }
    } else if (!invalid) {
      const parsed = troubleshooting.listArticlesSchema.safeParse({ game, published, cursor, limit: 25 });
      if (!parsed.success) invalid = 'One of the filters is not valid.';
      else {
        const res = await troubleshooting.listArticles(page.ctx, parsed.data);
        rows = res.items.map(toRow);
        nextCursor = res.nextCursor;
      }
    }
  } catch (e) {
    // e.g. search while the troubleshooting module is disabled — show the safe message.
    if (!isAppError(e)) throw e;
    invalid = e.message;
  }
  const links = pageLinks('/troubleshooting', sp, nextCursor);
  const filtered = Boolean(q || game || publishedParam);

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Self-help articles members find with /knowledge-search, inside troubleshooting flows and next to /diagnose results."
        breadcrumbs={[{ label: 'Troubleshooting' }, { label: 'Knowledge base' }]}
      />

      <Card>
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 border-b border-border p-4"
          role="search"
          aria-label="Filter articles"
        >
          <div className="w-full sm:w-64">
            <label htmlFor="kb-q" className="mb-1 block text-xs text-fg-muted">
              Search
            </label>
            <Input
              id="kb-q"
              name="q"
              defaultValue={q ?? ''}
              placeholder="e.g. connection timed out"
              maxLength={100}
            />
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="kb-game" className="mb-1 block text-xs text-fg-muted">
              Game
            </label>
            <Select
              id="kb-game"
              name="game"
              defaultValue={game ?? ''}
              placeholder="Any game"
              options={gameOptions}
            />
          </div>
          <div className="w-full sm:w-40">
            <label htmlFor="kb-pub" className="mb-1 block text-xs text-fg-muted">
              Status
            </label>
            <Select
              id="kb-pub"
              name="published"
              defaultValue={publishedParam ?? ''}
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
              <ButtonLink href="/troubleshooting" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
          {q && (
            <p className="w-full text-xs text-fg-muted">
              Search results are ranked by relevance and include drafts. A game filter also keeps general
              articles.
            </p>
          )}
        </form>

        {invalid ? (
          <div className="p-4">
            <Alert tone="warning" title="Cannot show articles">
              {invalid}
            </Alert>
          </div>
        ) : (
          <>
            <ArticleManager rows={rows} games={gameOptions} timezone={page.timezone} filtered={filtered} />
            <Pagination prevHref={links.prev} nextHref={links.next} label="Article pages" />
          </>
        )}
      </Card>
    </>
  );
}
