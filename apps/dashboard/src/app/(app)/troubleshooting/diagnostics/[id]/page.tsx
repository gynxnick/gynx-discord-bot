import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { games, getGuildConfig, troubleshooting } from '@gynx/services';
import { isAppError } from '@gynx/shared';
import { excerptVisible, formatBytes, parseFindings } from '@/components/troubleshooting/diagnostics';
import { RetentionNote } from '@/components/troubleshooting/RetentionNote';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { EmptyState, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/format';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'Diagnosis' };

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export default async function DiagnosisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const page = await requirePagePermission('troubleshooting.manage', 'troubleshooting.diagnostic');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();

  let rec;
  try {
    rec = await troubleshooting.getDiagnostic(page.ctx, id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const cfg = await getGuildConfig(page.ctx.db, page.ctx.guildId);
  const tz = page.timezone;
  const findings = parseFindings(rec.findings);
  const now = new Date();
  const showExcerpt = excerptVisible(rec, now);
  const evidenceVisible = !rec.purgedAt && rec.expiresAt > now;

  return (
    <>
      <PageHeader
        title={<span className="break-all font-mono">{rec.fileName}</span>}
        description={`${games.findGame(rec.game)?.name ?? rec.game} · ${formatBytes(rec.fileSize)}`}
        breadcrumbs={[
          { label: 'Troubleshooting', href: '/troubleshooting' },
          { label: 'Diagnostics', href: '/troubleshooting/diagnostics' },
          { label: 'Diagnosis' },
        ]}
      />
      <RetentionNote hours={cfg.diagnosticRetentionHours} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Findings"
              description="Likely causes from deterministic checks — not a confirmed diagnosis."
            />
            {findings.length === 0 ? (
              <EmptyState
                title="No known problems detected"
                description="The analysers did not recognise a known error pattern in this file."
              />
            ) : (
              <ol className="divide-y divide-border">
                {findings.map((f, i) => (
                  <li key={`${f.id}-${i}`} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-fg">{f.title}</h3>
                      <Badge tone={f.confidence === 'likely' ? 'accent' : 'neutral'}>
                        {f.confidence === 'likely' ? 'Likely' : 'Possible'}
                      </Badge>
                      {f.articleSlug && (
                        <span className="font-mono text-xs text-fg-muted">Article: {f.articleSlug}</span>
                      )}
                    </div>
                    {f.explanation && (
                      <p className="whitespace-pre-wrap break-words text-sm text-fg">{f.explanation}</p>
                    )}
                    {f.evidence && evidenceVisible ? (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-fg-muted">Evidence (redacted)</p>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded border border-border bg-surface-raised p-2 font-mono text-xs text-fg">
                          {f.evidence}
                        </pre>
                      </div>
                    ) : !evidenceVisible ? (
                      <p className="text-xs text-fg-muted">Evidence removed by retention.</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Redacted excerpt"
              description="Credentials and IP addresses were removed before anything was stored."
            />
            <CardBody>
              {showExcerpt ? (
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-surface-raised p-3 font-mono text-xs text-fg">
                  {rec.redactedExcerpt}
                </pre>
              ) : (
                <p className="text-sm text-fg-muted">
                  {rec.purgedAt
                    ? `The excerpt was purged on ${formatDateTime(rec.purgedAt, tz)}.`
                    : rec.redactedExcerpt
                      ? 'The excerpt has expired and will be purged shortly.'
                      : 'No excerpt was stored for this file.'}
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Record" />
          <CardBody>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                { label: 'Uploaded by', value: <span className="font-mono">{rec.userId}</span> },
                { label: 'Created', value: formatDateTime(rec.createdAt, tz) },
                { label: 'Excerpt expires', value: formatDateTime(rec.expiresAt, tz) },
                { label: 'Purged', value: rec.purgedAt ? formatDateTime(rec.purgedAt, tz) : 'Not yet' },
                {
                  label: 'Escalated',
                  value: rec.escalated ? 'Yes — the member pressed “Still stuck”' : 'No',
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
