import type { Metadata } from 'next';
import Link from 'next/link';
import { moderation } from '@gynx/services';
import { AppealsQueue, type AppealRow } from '@/components/moderation/AppealsQueue';
import { APPEAL_STATUS_LABEL } from '@/components/moderation/labels';
import { Card } from '@/components/ui/Card';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { cn } from '@/components/ui/cn';
import { firstParam, hrefWith, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Appeals' };

const FILTERS = ['PENDING', 'ACCEPTED', 'DENIED', 'ALL'] as const;

export default async function AppealsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission(
    ['moderation.execute', 'moderation.ban', 'moderation.audit.view'],
    'moderation.appeals',
  );
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { ctx, session, timezone: tz } = page;
  const sp = await searchParams;
  const raw = firstParam(sp, 'status');
  const filter = (FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as (typeof FILTERS)[number])
    : 'PENDING';

  const parsed = moderation.listAppealsSchema.safeParse({
    status: filter === 'ALL' ? undefined : filter,
    userId: firstParam(sp, 'user'),
    cursor: readCursor(sp).cursor,
    limit: 25,
  });
  const result = parsed.success ? await moderation.listAppeals(ctx, parsed.data) : null;
  const links = pageLinks('/moderation/appeals', sp, result?.nextCursor ?? null);

  const rows: AppealRow[] = (result?.items ?? []).map((a) => ({
    id: a.id,
    userId: a.userId,
    statement: a.statement,
    status: a.status,
    reviewerId: a.reviewerId,
    reviewNote: a.reviewNote,
    createdAt: a.createdAt.toISOString(),
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    actionId: a.actionId,
    action: a.action ? { ref: a.action.ref, type: a.action.type, reason: a.action.reason } : null,
  }));

  return (
    <>
      <PageHeader
        title="Appeals"
        description="Member appeals against moderation actions. Accepting a warning appeal revokes the warning; accepted timeouts and bans must be reversed in Discord manually."
        breadcrumbs={[{ label: 'Moderation', href: '/moderation' }, { label: 'Appeals' }]}
      />
      <Card>
        <nav
          aria-label="Appeal status filter"
          className="flex flex-wrap gap-1 border-b border-border px-4 py-2"
        >
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={hrefWith('/moderation/appeals', sp, { status: f === 'PENDING' ? undefined : f })}
              aria-current={filter === f ? 'page' : undefined}
              className={cn(
                'rounded px-2.5 py-1 text-sm no-underline hover:no-underline',
                filter === f ? 'bg-surface-raised text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {f === 'ALL' ? 'All' : APPEAL_STATUS_LABEL[f]}
            </Link>
          ))}
        </nav>
        {!result ? (
          <div className="p-4">
            <Alert tone="warning" title="Invalid filter">
              The user filter must be a Discord ID.
            </Alert>
          </div>
        ) : (
          <>
            <AppealsQueue
              rows={rows}
              timezone={tz}
              canExecute={session.permissions.has('moderation.execute')}
              canBan={session.permissions.has('moderation.ban')}
              myUserId={session.userId}
              hasFilters={filter !== 'PENDING' || Boolean(firstParam(sp, 'user'))}
            />
            <Pagination prevHref={links.prev} nextHref={links.next} label="Appeal pages" />
          </>
        )}
      </Card>
    </>
  );
}
