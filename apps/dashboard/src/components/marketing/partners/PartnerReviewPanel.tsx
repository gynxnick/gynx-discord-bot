'use client';

import { useState, type FormEvent } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { decisionPayload, decisionProblems, type DecisionDraft } from './partner-utils';

export interface ReviewPanelProps {
  applicationId: string;
  applicationRef: string;
  status: string;
  /** The viewer submitted this application (the server refuses self-review). */
  isOwn: boolean;
  /** Someone other than the viewer is reviewing it. */
  otherReviewerId: string | null;
  /** settings.manage can take over another reviewer's application. */
  canOverride: boolean;
}

const empty: DecisionDraft = { decision: '', decisionNote: '', internalNotes: '', campaignName: '' };

export function PartnerReviewPanel({
  applicationId,
  applicationRef,
  status,
  isOwn,
  otherReviewerId,
  canOverride,
}: ReviewPanelProps) {
  const { run, pending, fieldErrors, setFieldErrors, error } = useApiAction();
  const [draft, setDraft] = useState<DecisionDraft>(empty);
  const [confirmReject, setConfirmReject] = useState(false);
  const set = <K extends keyof DecisionDraft>(k: K, v: DecisionDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const base = `/api/marketing/partners/applications/${encodeURIComponent(applicationId)}`;

  const startReview = () =>
    run(`${base}/review/start`, 'POST', undefined, {
      success: 'Review started',
      successDescription: `You are now reviewing ${applicationRef}.`,
      errorTitle: 'Could not start review',
    });

  const send = async () => {
    const res = await run(`${base}/decision`, 'POST', decisionPayload(draft), {
      success: draft.decision === 'APPROVED' ? 'Application approved' : 'Application rejected',
      successDescription:
        draft.decision === 'APPROVED'
          ? 'A partner campaign was created (announce rights off). The applicant is notified by DM.'
          : 'The applicant is notified by DM.',
      errorTitle: 'Could not save decision',
    });
    setConfirmReject(false);
    if (res) setDraft(empty);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problems = decisionProblems(draft);
    if (Object.keys(problems).length) {
      setFieldErrors(problems);
      return;
    }
    setFieldErrors({});
    if (draft.decision === 'REJECTED') setConfirmReject(true);
    else void send();
  };

  const blockedByOther = otherReviewerId !== null && !canOverride;

  return (
    <Card>
      <CardHeader title="Review" description="Decisions are final and are sent to the applicant." />
      <CardBody className="space-y-4">
        {isOwn && (
          <Alert tone="warning" title="This is your own application">
            You can’t review or decide your own application. Ask another partner reviewer.
          </Alert>
        )}
        {otherReviewerId && (
          <Alert tone={blockedByOther ? 'warning' : 'info'} title="Another reviewer is handling this">
            <span className="font-mono text-xs">{otherReviewerId}</span> started the review.
            {canOverride
              ? ' You can still decide because you have settings.manage.'
              : ' Only they (or someone with settings.manage) can decide it.'}
          </Alert>
        )}
        {status === 'PENDING' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => void startReview()}
              loading={pending}
              disabled={pending}
            >
              Start review
            </Button>
            <p className="text-xs text-fg-muted">
              Claims the application so other reviewers know you’re on it.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate aria-label="Decide application">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">
              Decision
              <span className="ml-0.5 text-danger" aria-hidden="true">
                *
              </span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {(['APPROVED', 'REJECTED'] as const).map((d) => (
                <label
                  key={d}
                  className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-sm hover:bg-surface-hover"
                >
                  <input
                    type="radio"
                    name="decision"
                    value={d}
                    checked={draft.decision === d}
                    onChange={() => set('decision', d)}
                    disabled={pending}
                    className="accent-[#22D3EE]"
                  />
                  {d === 'APPROVED' ? 'Approve' : 'Reject'}
                </label>
              ))}
            </div>
            {fieldErrors.decision && (
              <p className="text-xs text-danger" role="alert">
                {fieldErrors.decision}
              </p>
            )}
          </fieldset>

          <Field
            id="decision-note"
            label="Decision note"
            required
            help="Sent to the applicant. 3–1000 characters."
            error={fieldErrors.decisionNote}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                value={draft.decisionNote}
                onChange={(e) => set('decisionNote', e.target.value)}
                maxLength={1000}
              />
            )}
          </Field>
          <Field
            id="internal-notes"
            label="Internal notes"
            help="Staff only — never shown to the applicant."
            error={fieldErrors.internalNotes}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={draft.internalNotes}
                onChange={(e) => set('internalNotes', e.target.value)}
                maxLength={2000}
              />
            )}
          </Field>
          {draft.decision === 'APPROVED' && (
            <Field
              id="campaign-name"
              label="Campaign name"
              help={`Optional. Defaults to “${applicationRef} partnership”. Announce rights start disabled.`}
              error={fieldErrors.campaignName}
            >
              {(p) => (
                <Input
                  {...p}
                  value={draft.campaignName}
                  onChange={(e) => set('campaignName', e.target.value)}
                  maxLength={80}
                />
              )}
            </Field>
          )}
          {error && !Object.keys(fieldErrors).length && (
            <Alert tone="danger" title="Not saved">
              {error}
            </Alert>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              variant={draft.decision === 'REJECTED' ? 'danger' : 'primary'}
              loading={pending && !confirmReject}
              disabled={pending}
            >
              {draft.decision === 'REJECTED'
                ? 'Reject application…'
                : draft.decision === 'APPROVED'
                  ? 'Approve application'
                  : 'Submit decision'}
            </Button>
          </div>
        </form>
      </CardBody>

      <ConfirmDialog
        open={confirmReject}
        onCancel={() => setConfirmReject(false)}
        onConfirm={send}
        loading={pending}
        title={`Reject ${applicationRef}?`}
        description="The applicant is told by DM with your decision note. This cannot be undone; they would need to apply again."
        confirmLabel="Reject application"
      />
    </Card>
  );
}
