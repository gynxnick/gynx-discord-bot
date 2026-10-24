import type { Metadata } from 'next';
import { security } from '@gynx/services';
import { AuditTable } from '@/components/security/AuditTable';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Form';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { firstParam, pageLinks, readCursor, type SearchParams } from '@/lib/pagination';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Audit log' };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const page = await requirePagePermission('audit.view', 'security.audit');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const sp = await searchParams;

  const filters = {
    action: firstParam(sp, 'action'),
    actorId: firstParam(sp, 'actorId'),
    result: firstParam(sp, 'result'),
    since: firstParam(sp, 'since'),
  };
  const parsed = security.auditQuerySchema.safeParse({
    ...filters,
    cursor: readCursor(sp).cursor,
    limit: 50,
  });
  const result = parsed.success ? await security.searchAuditLog(page.ctx, parsed.data) : null;
  const links = pageLinks('/security/audit', sp, result?.nextCursor ?? null);
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of sensitive actions and permission denials across the bot, worker and dashboard. Secrets are redacted before storage."
        breadcrumbs={[{ label: 'Security' }, { label: 'Audit log' }]}
      />
      <Card>
        <form
          method="get"
          role="search"
          aria-label="Filter audit events"
          className="flex flex-wrap items-end gap-3 border-b border-border p-4"
        >
          <div className="w-full sm:w-52">
            <label htmlFor="f-action" className="mb-1 block text-xs text-fg-muted">
              Action starts with
            </label>
            <Input
              id="f-action"
              name="action"
              defaultValue={filters.action ?? ''}
              placeholder="security.report."
              maxLength={64}
            />
          </div>
          <div className="w-full sm:w-52">
            <label htmlFor="f-actor" className="mb-1 block text-xs text-fg-muted">
              Actor user ID
            </label>
            <Input
              id="f-actor"
              name="actorId"
              defaultValue={filters.actorId ?? ''}
              placeholder="123456789012345678 or system"
              inputMode="numeric"
              maxLength={20}
            />
          </div>
          <div className="w-full sm:w-36">
            <label htmlFor="f-result" className="mb-1 block text-xs text-fg-muted">
              Result
            </label>
            <Select
              id="f-result"
              name="result"
              defaultValue={filters.result ?? ''}
              placeholder="Any result"
              options={[
                { value: 'SUCCESS', label: 'Success' },
                { value: 'DENIED', label: 'Denied' },
                { value: 'FAILURE', label: 'Failure' },
              ]}
            />
          </div>
          <div className="w-full sm:w-44">
            <label htmlFor="f-since" className="mb-1 block text-xs text-fg-muted">
              Since (UTC date)
            </label>
            <Input id="f-since" name="since" type="date" defaultValue={filters.since ?? ''} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {hasFilters && (
              <ButtonLink href="/security/audit" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
        {!parsed.success ? (
          <div className="p-4">
            <Alert tone="warning" title="Invalid filter">
              {parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}
            </Alert>
          </div>
        ) : (
          <>
            <AuditTable events={result?.items ?? []} timezone={page.timezone} />
            <Pagination prevHref={links.prev} nextHref={links.next} label="Audit log pages" />
          </>
        )}
      </Card>
    </>
  );
}
