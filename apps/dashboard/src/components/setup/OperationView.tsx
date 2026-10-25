'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert } from '@/components/ui/Feedback';
import { Checkbox } from '@/components/ui/Form';
import { cn } from '@/components/ui/cn';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/format';
import { FindingsList } from './FindingsList';
import {
  CHANGE_KIND_LABELS,
  OPERATION_STATUS_LABELS,
  OPERATION_STATUS_TONES,
  OPERATION_TYPE_LABELS,
  changeTarget,
  countFindings,
  groupChanges,
  isActiveStatus,
  isFinishedStatus,
  progressOf,
} from './preview-utils';
import type { ExecutionSummaryView, OperationDetailView, OperationPreviewView } from './types';

export const POLL_INTERVAL_MS = 3000;

type ConfirmResult =
  { status: 'QUEUED'; operationId: string } | { status: 'STALE'; preview: OperationPreviewView };

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warning' | 'danger' | 'success';
}) {
  return (
    <div className="rounded-md border border-border bg-surface-raised/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</p>
      <p
        className={cn(
          'text-xl font-semibold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
          !tone && 'text-fg',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ChangeList({ preview }: { preview: OperationPreviewView }) {
  const groups = groupChanges(preview.plan.changes);
  if (groups.length === 0)
    return (
      <p className="px-4 py-6 text-sm text-fg-muted">
        No changes needed: everything selected already matches the blueprint.
      </p>
    );
  return (
    <div className="divide-y divide-border">
      {groups.map((g) => (
        <details key={g.id} open className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover">
            <span className="text-sm font-medium text-fg">
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block transition-transform group-open:rotate-90"
              >
                ▸
              </span>
              {g.label} <span className="text-fg-muted">({g.changes.length})</span>
            </span>
            {g.disruptive > 0 && <Badge tone="warning">{g.disruptive} affect members</Badge>}
          </summary>
          <ul className="px-4 pb-3">
            {g.changes.map((c, i) => (
              <li
                key={`${c.kind}:${c.key}:${i}`}
                className={cn(
                  'flex flex-col gap-1 border-l-2 py-2 pl-3 sm:flex-row sm:items-start sm:gap-3',
                  c.risk === 'disruptive' ? 'border-warning bg-warning-soft/40' : 'border-border',
                )}
              >
                <div className="flex shrink-0 items-center gap-2 sm:w-56">
                  <Badge tone={c.risk === 'disruptive' ? 'warning' : 'success'}>
                    {c.risk === 'disruptive' ? 'Affects members' : 'Safe'}
                  </Badge>
                  <span className="text-xs font-medium text-fg">{CHANGE_KIND_LABELS[c.kind] ?? c.kind}</span>
                </div>
                <div className="min-w-0 text-sm">
                  <p className="break-words text-fg">{c.description}</p>
                  <p className="break-words font-mono text-[11px] text-fg-muted">{changeTarget(c)}</p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function ResultCard({ result }: { result: ExecutionSummaryView }) {
  return (
    <Card>
      <CardHeader
        title="Result"
        description={
          result.verified
            ? 'The server was checked against the plan after applying.'
            : 'Verification did not run or did not pass.'
        }
        actions={
          <StatusBadge
            status={result.status}
            tone={OPERATION_STATUS_TONES[result.status]}
            label={OPERATION_STATUS_LABELS[result.status]}
          />
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat label="Created" value={result.created} tone={result.created ? 'success' : undefined} />
          <Stat label="Adopted" value={result.adopted} />
          <Stat label="Updated" value={result.updated} />
          <Stat label="Skipped" value={result.skipped} />
          <Stat label="Failed" value={result.failed} tone={result.failed ? 'danger' : undefined} />
        </div>
        {result.failures.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-fg">Failures</h3>
            <ul className="mt-2 space-y-1.5">
              {result.failures.map((f, i) => (
                <li
                  key={`${f.key}-${i}`}
                  className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm"
                >
                  <code className="font-mono text-xs text-fg">{f.key}</code>
                  <p className="break-words text-fg-muted">{f.error}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-fg-muted">
              Completed changes are kept. Run Repair from the overview to retry what failed.
            </p>
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-fg">Verification</h3>
          <FindingsList className="mt-2" findings={result.verificationFindings} empty="No problems found." />
        </div>
      </CardBody>
    </Card>
  );
}

export function OperationView({
  initial,
  timeZone,
  stale = false,
}: {
  initial: OperationDetailView;
  timeZone: string;
  /** The previous preview was outdated when confirmed; this is the fresh one. */
  stale?: boolean;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDetail(initial), [initial]);

  const preview = detail.preview;
  const status = detail.status;
  const active = isActiveStatus(status);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const next = await api<OperationDetailView>(`/api/setup/operations/${encodeURIComponent(detail.id)}`, {
        signal,
      });
      setDetail(next);
      setPollError(null);
      return next;
    },
    [api, detail.id],
  );

  // Poll while the worker has the operation; stop once it finishes.
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const next = await refresh(ctrl.signal);
        if (isFinishedStatus(next.status)) {
          router.refresh();
          return;
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setPollError((e as Error).message);
      }
      if (!ctrl.signal.aborted) timer.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer.current = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      ctrl.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, refresh, router]);

  const fc = countFindings(preview.plan.findings);
  const blocked = preview.plan.blocked || fc.blocking > 0;
  const canConfirm = status === 'PREVIEWED' && !blocked;
  const needsConsent = preview.requiresDisruptiveConsent;
  const progress = progressOf(detail.changes, preview.plan.changes.length);

  const confirm = async () => {
    setBusy('confirm');
    setActionError(null);
    try {
      const res = await api<ConfirmResult>(`/api/setup/operations/${encodeURIComponent(detail.id)}/confirm`, {
        method: 'POST',
        body: { acceptDisruptive: needsConsent ? consent : false },
      });
      setConfirmOpen(false);
      setConsent(false);
      if (res.status === 'STALE') {
        toast.show({
          tone: 'info',
          title: 'The server changed since this preview',
          description: 'Review the fresh preview before confirming again.',
        });
        router.push(`/setup/operations/${encodeURIComponent(res.preview.operationId)}?stale=1`);
        return;
      }
      toast.success('Setup queued', 'The worker is applying the changes. Progress updates below.');
      setDetail((d) => ({ ...d, status: 'QUEUED' }));
      void refresh().catch(() => undefined);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await api(`/api/setup/operations/${encodeURIComponent(detail.id)}/cancel`, { method: 'POST' });
      setCancelOpen(false);
      toast.success('Preview cancelled', 'Nothing was changed in Discord.');
      await refresh().catch(() => undefined);
      router.refresh();
    } catch (e) {
      toast.error('Could not cancel', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {stale && status === 'PREVIEWED' && (
        <Alert tone="warning" title="This is a fresh preview">
          The server changed after the previous preview, so it was not applied. Review this updated plan
          before confirming.
        </Alert>
      )}

      <Card>
        <CardHeader
          title={`${OPERATION_TYPE_LABELS[detail.type] ?? detail.type} preview`}
          description={`Blueprint version ${preview.blueprintVersion} · started ${formatDateTime(detail.startedAt, timeZone)}`}
          actions={
            <StatusBadge
              status={status}
              tone={OPERATION_STATUS_TONES[status]}
              label={OPERATION_STATUS_LABELS[status]}
            />
          }
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Create" value={preview.summary.create} />
            <Stat label="Adopt" value={preview.summary.adopt} />
            <Stat label="Update" value={preview.summary.update} />
            <Stat label="Permissions" value={preview.summary.permissions} />
            <Stat label="Messages" value={preview.summary.messages} />
            <Stat
              label="Affect members"
              value={preview.summary.disruptive}
              tone={preview.summary.disruptive ? 'warning' : undefined}
            />
          </div>
          {preview.plan.inPlace.length > 0 && (
            <p className="text-xs text-fg-muted">
              {preview.plan.inPlace.length} resource{preview.plan.inPlace.length === 1 ? ' is' : 's are'}{' '}
              already in place and will not be touched.
            </p>
          )}

          {preview.plan.missingBotPermissions.length > 0 && (
            <Alert tone="danger" title="The bot is missing permissions">
              <p>Grant these to the bot&apos;s role in Discord, then preview again:</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {preview.plan.missingBotPermissions.map((p) => (
                  <li key={p}>
                    <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-xs">{p}</code>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {status === 'PREVIEWED' && blocked && (
            <Alert tone="danger" title="This preview cannot be applied">
              Fix the blocking findings below, then start a new preview from the overview.
            </Alert>
          )}
          {actionError && (
            <Alert tone="danger" title="Not confirmed">
              {actionError}
            </Alert>
          )}

          {status === 'PREVIEWED' && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setConfirmOpen(true)} disabled={!canConfirm}>
                Confirm and apply
              </Button>
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                Cancel preview
              </Button>
            </div>
          )}
          {(status === 'CANCELLED' || isFinishedStatus(status)) && (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/setup" variant="secondary" size="sm">
                Back to overview
              </ButtonLink>
              <ButtonLink href="/setup/history" variant="ghost" size="sm">
                History
              </ButtonLink>
            </div>
          )}
        </CardBody>
      </Card>

      {(active || (status !== 'PREVIEWED' && detail.changes.length > 0)) && (
        <Card>
          <CardHeader title="Progress" description={active ? 'Updates every few seconds.' : undefined} />
          <CardBody className="space-y-3">
            <div aria-live="polite" aria-atomic="true" className="text-sm text-fg">
              {status === 'QUEUED'
                ? 'Waiting for the worker to start…'
                : `${progress.done} of ${progress.total} changes processed (${progress.applied} applied, ${progress.skipped} skipped, ${progress.failed} failed).`}
              {isFinishedStatus(status) && ` Finished: ${OPERATION_STATUS_LABELS[status] ?? status}.`}
            </div>
            <div
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              className="h-2 overflow-hidden rounded-full bg-surface-raised"
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  progress.failed ? 'bg-warning' : 'bg-accent',
                )}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            {pollError && (
              <Alert tone="warning" title="Progress could not be refreshed">
                {pollError} Retrying automatically.
              </Alert>
            )}
            {detail.changes.some((c) => c.status === 'FAILED') && (
              <ul className="space-y-1">
                {detail.changes
                  .filter((c) => c.status === 'FAILED')
                  .map((c) => (
                    <li key={c.seq} className="text-xs">
                      <code className="font-mono text-fg">{c.key}</code>{' '}
                      <span className="text-danger">{c.error ?? 'Failed'}</span>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {detail.result && <ResultCard result={detail.result} />}

      <Card>
        <CardHeader
          title="Findings"
          description={`${fc.blocking} blocking · ${fc.warning} warnings · ${fc.info} info`}
        />
        <CardBody>
          <FindingsList findings={preview.plan.findings} empty="No findings: the plan is clear to apply." />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Planned changes (${preview.plan.changes.length})`}
          description="Changes marked “Affects members” modify something members already use."
        />
        <ChangeList preview={preview} />
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setConsent(false);
        }}
        role="alertdialog"
        size="md"
        dismissible={busy !== 'confirm'}
        title="Apply these changes to Discord?"
        description="The worker applies the plan in order, with checkpoints. Pre-existing channels, roles and messages are never deleted."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmOpen(false);
                setConsent(false);
              }}
              disabled={busy === 'confirm'}
              data-autofocus
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirm()}
              loading={busy === 'confirm'}
              disabled={needsConsent && !consent}
            >
              Confirm and apply
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <DescriptionList
            items={[
              { label: 'Changes', value: preview.plan.changes.length },
              { label: 'Affect members', value: preview.summary.disruptive },
              { label: 'Warnings', value: fc.warning },
              { label: 'Type', value: OPERATION_TYPE_LABELS[detail.type] ?? detail.type },
            ]}
          />
          <p className="text-fg-muted">
            The plan is checked against the live server again first. If anything changed, you get a fresh
            preview instead.
          </p>
          {needsConsent && (
            <Checkbox
              id="setup-consent"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              label={`I understand ${preview.summary.disruptive} change${
                preview.summary.disruptive === 1 ? '' : 's'
              } affect things members already use`}
            />
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        onConfirm={cancel}
        loading={busy === 'cancel'}
        destructive={false}
        title="Cancel this preview?"
        description="Nothing has been changed in Discord. You can start a new preview at any time."
        confirmLabel="Cancel preview"
        cancelLabel="Keep it"
      />

      <p className="text-xs text-fg-muted">
        Need to undo an applied operation? Use <Link href="/setup/history">History → Preview rollback</Link>.
      </p>
    </div>
  );
}
