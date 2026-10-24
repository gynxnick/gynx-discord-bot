import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { marketing } from '@gynx/services';
import { ModuleNotice } from '@/components/community/ModuleNotice';
import { load } from '@/components/community/server/data';
import { PartnerReviewPanel } from '@/components/marketing/partners/PartnerReviewPanel';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  answerRows,
  isApplicationStatus,
  isOpenStatus,
} from '@/components/marketing/partners/partner-utils';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Partner application' };

const Mono = ({ v }: { v: string | null }) =>
  v ? <span className="font-mono text-xs">{v}</span> : <span className="text-fg-muted">—</span>;

export default async function PartnerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission('partners.review', 'marketing.partners.application');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  const { ctx, timezone, session } = page;

  const res = await load(() => marketing.getPartnerApplication(ctx, id));
  if (!res.ok) {
    if (res.code === 'NOT_FOUND') notFound();
    return <ModuleNotice title="Partner application" message={res.message} />;
  }
  const app = res.data;
  const answers = answerRows(marketing.PARTNER_QUESTIONS[app.category] ?? [], app.answers);
  const status = isApplicationStatus(app.status) ? app.status : null;
  const open = isOpenStatus(app.status);
  const otherReviewer =
    app.status === 'UNDER_REVIEW' && app.reviewerId && app.reviewerId !== session.userId
      ? app.reviewerId
      : null;

  return (
    <>
      <PageHeader
        title={`Application ${app.ref}`}
        description={marketing.PARTNER_CATEGORY_LABELS[app.category]}
        breadcrumbs={[
          { label: 'Events & marketing', href: '/marketing' },
          { label: 'Partners', href: '/marketing/partners' },
          { label: app.ref },
        ]}
        actions={
          status ? (
            <Badge tone={APPLICATION_STATUS_TONES[status]} dot>
              {APPLICATION_STATUS_LABELS[status]}
            </Badge>
          ) : (
            <Badge>{app.status}</Badge>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Answers"
              description="Shown exactly as the applicant wrote them (plain text; links are not clickable)."
            />
            <dl className="divide-y divide-border">
              {answers.map((a) => (
                <div key={a.id} className="px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">{a.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">
                    {a.value ?? (
                      <span className="text-fg-muted">
                        {a.required ? 'No answer' : 'Not answered (optional)'}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          {(app.decisionNote || app.internalNotes) && (
            <Card>
              <CardHeader title="Decision notes" />
              <CardBody className="space-y-4">
                {app.decisionNote && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Sent to applicant
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{app.decisionNote}</p>
                  </div>
                )}
                {app.internalNotes && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Internal (staff only)
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{app.internalNotes}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                className="xl:grid-cols-1"
                items={[
                  { label: 'Applicant', value: <Mono v={app.applicantId} /> },
                  { label: 'Category', value: marketing.PARTNER_CATEGORY_LABELS[app.category] },
                  { label: 'Reviewer', value: <Mono v={app.reviewerId} /> },
                  { label: 'Submitted', value: formatDateTime(app.createdAt, timezone) },
                  { label: 'Review started', value: formatDateTime(app.reviewStartedAt, timezone) },
                  { label: 'Decided', value: formatDateTime(app.reviewedAt, timezone) },
                  ...(app.status === 'APPROVED'
                    ? [
                        {
                          label: 'Partner role',
                          value: app.roleGranted
                            ? 'Granted'
                            : 'Not granted yet (queued, or role not configured)',
                        },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          {app.campaigns.length > 0 && (
            <Card>
              <CardHeader title="Campaigns" />
              <ul className="divide-y divide-border">
                {app.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <Link href={`/marketing/partners/campaigns/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                    {c.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {open && (
            <PartnerReviewPanel
              applicationId={app.id}
              applicationRef={app.ref}
              status={app.status}
              isOwn={app.applicantId === session.userId}
              otherReviewerId={otherReviewer}
              canOverride={session.permissions.has('settings.manage')}
            />
          )}
        </div>
      </div>
    </>
  );
}
