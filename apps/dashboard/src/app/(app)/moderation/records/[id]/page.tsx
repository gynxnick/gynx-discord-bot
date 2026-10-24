import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { moderation } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import {
  ActionTypeBadge,
  ModeratorName,
  RecordStatusBadge,
  formatSeconds,
} from '@/components/moderation/labels';
import { ModeratorNoteEditor } from '@/components/moderation/ModeratorNoteEditor';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Moderation record' };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default async function ModerationRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission(
    ['moderation.audit.view', 'moderation.execute'],
    'moderation.record',
  );
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const { ctx, timezone: tz } = page;

  let action;
  try {
    action = await moderation.getAction(ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const canAudit = page.session.permissions.has('moderation.audit.view');

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{action.ref}</span>
            <ActionTypeBadge type={action.type} />
            <RecordStatusBadge status={action.status} />
          </span>
        }
        breadcrumbs={[
          { label: 'Moderation' },
          { label: 'Records', href: '/moderation' },
          { label: action.ref },
        ]}
        actions={
          canAudit ? (
            <ButtonLink href={`/moderation/warnings?user=${action.targetId}`} variant="secondary">
              Warnings for this user
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Record" />
            <CardBody className="space-y-5">
              <div>
                <h3 className="text-xs uppercase tracking-wide text-fg-muted">Reason</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{action.reason}</p>
              </div>
              <DescriptionList
                items={[
                  { label: 'Target', value: <span className="font-mono">{action.targetId}</span> },
                  { label: 'Moderator', value: <ModeratorName id={action.moderatorId} /> },
                  { label: 'Date', value: formatDateTime(action.createdAt, tz) },
                  { label: 'Duration', value: formatSeconds(action.durationSeconds) },
                  { label: 'Expires', value: formatDateTime(action.expiresAt, tz) },
                  { label: 'Member notified by DM', value: action.dmSent ? 'Yes' : 'No' },
                ]}
              />
              {action.status === 'FAILED' && action.failureReason && (
                <Alert tone="warning" title="Discord rejected this action">
                  {action.failureReason}
                </Alert>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          {canAudit ? (
            <ModeratorNoteEditor actionId={action.id} initial={action.moderatorNote} />
          ) : (
            <Card>
              <CardBody>
                <p className="text-sm text-fg-muted">
                  Moderator notes require the moderation audit permission.
                </p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardBody>
              <p className="text-sm text-fg-muted">
                Reversing an action (unbanning, removing a timeout) has to be done in Discord. The dashboard
                cannot apply Discord moderation actions.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
