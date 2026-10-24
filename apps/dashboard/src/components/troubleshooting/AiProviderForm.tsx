'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Alert } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { aiFormFrom, aiPayload, validateAiForm, type AiFormState, type IntegrationRow } from './forms';

export function AiProviderList({ rows, timezone }: { rows: IntegrationRow[]; timezone: string }) {
  const [adding, setAdding] = useState(rows.length === 0);
  return (
    <div className="space-y-6">
      {rows.map((r) => (
        <AiProviderForm key={r.id} row={r} timezone={timezone} />
      ))}
      {adding ? (
        <AiProviderForm
          row={null}
          timezone={timezone}
          onCancel={rows.length ? () => setAdding(false) : undefined}
          onSaved={() => setAdding(false)}
        />
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add another provider
        </Button>
      )}
    </div>
  );
}

function AiProviderForm({
  row,
  timezone,
  onCancel,
  onSaved,
}: {
  row: IntegrationRow | null;
  timezone: string;
  onCancel?: () => void;
  onSaved?: () => void;
}) {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState<AiFormState>(() => aiFormFrom(row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const idp = row ? `ai-${row.id}` : 'ai-new';
  const set = <K extends keyof AiFormState>(k: K, v: AiFormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local = validateAiForm(form);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      await api('/api/integrations', { method: 'POST', body: aiPayload(form) });
      toast.success(
        'AI provider settings saved',
        form.secretAction === 'remove' ? 'The stored key was removed.' : undefined,
      );
      // Never keep the typed key in memory after saving.
      setForm((f) => ({
        ...f,
        secret: '',
        secretAction:
          f.secretAction === 'remove'
            ? 'replace'
            : f.secretAction === 'replace' && f.secret !== ''
              ? 'keep'
              : f.secretAction,
      }));
      onSaved?.();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        const fe = err.fieldErrors();
        setErrors({
          name: fe.name ?? '',
          model: fe['settings.model'] ?? '',
          baseUrl: fe['settings.baseUrl'] ?? '',
          maxTokens: fe['settings.maxTokens'] ?? '',
          secret: fe.secret ?? '',
        });
      }
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!row) return;
    setDeleting(true);
    try {
      await api(`/api/integrations/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      toast.success('AI provider removed', row.name);
      setConfirmDelete(false);
      router.refresh();
    } catch (err) {
      toast.error('Could not remove provider', (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const hasStoredKey = row?.hasSecret ?? false;

  return (
    <Card>
      <CardHeader
        title={row ? <span className="font-mono">{row.name}</span> : 'New AI provider'}
        description={
          row
            ? `Last updated ${formatDateTime(row.updatedAt, timezone)}`
            : 'Records configuration for a future provider adapter.'
        }
        actions={
          row ? (
            row.enabled ? (
              <Badge tone="accent" dot>
                Enabled
              </Badge>
            ) : (
              <Badge dot>Disabled</Badge>
            )
          ) : undefined
        }
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate autoComplete="off">
          {formError && (
            <Alert tone="danger" title="Could not save">
              {formError}
            </Alert>
          )}
          <Switch
            id={`${idp}-enabled`}
            checked={form.enabled}
            onChange={(v) => set('enabled', v)}
            label="Enabled"
            description="When disabled the configuration is kept but never used."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={`${idp}-name`}
              label="Provider name"
              required
              help={
                row
                  ? 'The name identifies this configuration and cannot be changed.'
                  : 'Lowercase id, e.g. "openai" or "self-hosted".'
              }
              error={errors.name || null}
            >
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  value={form.name}
                  maxLength={64}
                  disabled={Boolean(row)}
                  onChange={(e) => set('name', e.target.value)}
                />
              )}
            </Field>
            <Field id={`${idp}-model`} label="Model" help="Optional model id." error={errors.model || null}>
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  value={form.model}
                  maxLength={100}
                  onChange={(e) => set('model', e.target.value)}
                />
              )}
            </Field>
            <Field
              id={`${idp}-base`}
              label="Base URL"
              help="Optional; https:// only."
              error={errors.baseUrl || null}
            >
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  inputMode="url"
                  value={form.baseUrl}
                  maxLength={500}
                  placeholder="https://"
                  onChange={(e) => set('baseUrl', e.target.value)}
                />
              )}
            </Field>
            <Field
              id={`${idp}-max`}
              label="Max tokens"
              help="Optional; 1–32000."
              error={errors.maxTokens || null}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={form.maxTokens}
                  maxLength={5}
                  onChange={(e) => set('maxTokens', e.target.value.replace(/[^\d]/g, ''))}
                />
              )}
            </Field>
          </div>

          <fieldset className="space-y-2 rounded border border-border p-3">
            <legend className="px-1 text-sm font-medium text-fg">API key</legend>
            <p className="text-xs text-fg-muted">
              Write-only: the key is encrypted at rest and is never shown again, not even to administrators.
            </p>
            {hasStoredKey && form.secretAction === 'keep' && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="success" dot>
                  A key is stored
                </Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setForm((f) => ({ ...f, secretAction: 'replace', secret: '' }))}
                >
                  Replace
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => setForm((f) => ({ ...f, secretAction: 'remove', secret: '' }))}
                >
                  Remove
                </Button>
              </div>
            )}
            {hasStoredKey && form.secretAction === 'remove' && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">The stored key will be removed when you save</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm((f) => ({ ...f, secretAction: 'keep' }))}
                >
                  Undo
                </Button>
              </div>
            )}
            {form.secretAction === 'replace' && (
              <div className="flex flex-wrap items-end gap-2">
                <Field
                  id={`${idp}-secret`}
                  label={hasStoredKey ? 'New API key' : 'API key'}
                  className="min-w-[16rem] flex-1"
                  help={hasStoredKey ? 'Leave empty to keep the stored key.' : 'Optional.'}
                  error={errors.secret || null}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={form.secret}
                      maxLength={4096}
                      onChange={(e) => set('secret', e.target.value)}
                    />
                  )}
                </Field>
                {hasStoredKey && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setForm((f) => ({ ...f, secretAction: 'keep', secret: '' }))}
                  >
                    Keep stored key
                  </Button>
                )}
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap justify-end gap-2">
            {row && (
              <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmDelete(true)}>
                Delete configuration
              </Button>
            )}
            {onCancel && (
              <Button variant="secondary" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={saving} loadingLabel="Saving…">
              Save
            </Button>
          </div>
        </form>
      </CardBody>
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        loading={deleting}
        title="Delete AI provider configuration?"
        confirmLabel="Delete"
        description={
          row
            ? `The “${row.name}” settings and its stored key are deleted permanently. The bot keeps working with deterministic troubleshooting only.`
            : undefined
        }
      />
    </Card>
  );
}
