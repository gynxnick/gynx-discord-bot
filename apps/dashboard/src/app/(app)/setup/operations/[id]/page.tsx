import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setup } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import { toJsonSafe } from '@/components/setup/json-safe';
import { OperationView } from '@/components/setup/OperationView';
import { OPERATION_TYPE_LABELS } from '@/components/setup/preview-utils';
import { ButtonLink } from '@/components/ui/Button';
import { ErrorState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { firstParam, type SearchParams } from '@/lib/pagination';
import { getLogger } from '@/server/deps';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Setup operation' };
export const dynamic = 'force-dynamic';

const OP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function SetupOperationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const page = await requirePagePermission('setup.manage', 'setup.operation');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!OP_ID_RE.test(id)) notFound();

  let detail: setup.OperationDetail;
  try {
    detail = toJsonSafe(await setup.getOperation(page.ctx, id));
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') notFound();
    getLogger().error({ err }, 'setup operation load failed');
    return (
      <>
        <PageHeader
          title="Setup operation"
          breadcrumbs={[{ label: 'Server setup', href: '/setup' }, { label: 'Operation' }]}
        />
        <ErrorState
          title="This operation could not be loaded"
          description="The setup service did not respond. Try again in a moment."
          action={
            <ButtonLink href={`/setup/operations/${encodeURIComponent(id)}`} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </>
    );
  }

  const label = OPERATION_TYPE_LABELS[detail.type] ?? detail.type;
  return (
    <>
      <PageHeader
        title={detail.status === 'PREVIEWED' ? `Preview: ${label}` : label}
        description="Review exactly what will change in Discord before confirming. Nothing is applied until you confirm."
        breadcrumbs={[
          { label: 'Server setup', href: '/setup' },
          { label: 'History', href: '/setup/history' },
          { label: label },
        ]}
      />
      <OperationView initial={detail} timeZone={page.timezone} stale={firstParam(sp, 'stale') === '1'} />
    </>
  );
}
