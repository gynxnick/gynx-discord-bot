'use client';

import { useState, type FormEvent } from 'react';
import { useApiAction } from '@/components/community/useApiAction';
import { useSession } from '@/components/layout/SessionProvider';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Table, type Column } from '@/components/ui/Table';
import { templateErrors, type TemplateDraft } from './template-utils';

export interface TemplateRow {
  id: string;
  name: string;
  type: string;
  title: string;
  body: string;
}

const empty = (): TemplateDraft => ({ name: '', type: 'GENERAL', title: '', body: '' });

/** List / create / edit / delete announcement templates (announcements.create). */
export function TemplatesManager({
  templates,
  typeOptions,
}: {
  templates: TemplateRow[];
  typeOptions: Array<{ value: string; label: string }>;
}) {
  const { can } = useSession();
  const canManage = can('announcements.create');
  const { run, pending, fieldErrors, setFieldErrors } = useApiAction();
  const [editing, setEditing] = useState<TemplateRow | 'new' | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(empty);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);
  const typeLabel = (t: string) => typeOptions.find((o) => o.value === t)?.label ?? t;

  const open = (t: TemplateRow | 'new') => {
    setFieldErrors({});
    setEditing(t);
    setDraft(t === 'new' ? empty() : { name: t.name, type: t.type, title: t.title, body: t.body });
  };
  const set = <K extends keyof TemplateDraft>(k: K, v: TemplateDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const errs = templateErrors(draft);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    const body = {
      name: draft.name.trim(),
      type: draft.type,
      title: draft.title.trim(),
      body: draft.body.trim(),
    };
    const res =
      editing === 'new'
        ? await run('/api/marketing/templates', 'POST', body, {
            success: 'Template created',
            errorTitle: 'Could not save template',
          })
        : await run(
            `/api/marketing/templates/${encodeURIComponent((editing as TemplateRow).id)}`,
            'PATCH',
            body,
            { success: 'Template saved', errorTitle: 'Could not save template' },
          );
    if (res) setEditing(null);
  };

  const remove = async () => {
    if (!deleting) return;
    const res = await run(
      `/api/marketing/templates/${encodeURIComponent(deleting.id)}`,
      'DELETE',
      undefined,
      { success: 'Template deleted', errorTitle: 'Could not delete template' },
    );
    if (res) setDeleting(null);
  };

  const columns: Column<TemplateRow>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (t) => (
        <div className="min-w-[12rem]">
          <p className="font-medium text-fg">{t.name}</p>
          <p className="mt-0.5 truncate text-xs text-fg-muted">{t.title}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (t) => <span className="text-fg-muted">{typeLabel(t.type)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (t) =>
        canManage ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => open(t)} aria-label={`Edit template ${t.name}`}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleting(t)}
              aria-label={`Delete template ${t.name}`}
            >
              Delete
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Templates"
        description="Starting points for the editor: a template prefills the type, title and text. Default templates are recreated if their name is free."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => open('new')}>
              New template
            </Button>
          ) : undefined
        }
      />
      <Table
        columns={columns}
        rows={templates}
        rowKey={(t) => t.id}
        caption="Announcement templates"
        empty={<EmptyState title="No templates yet" description="Create one to reuse a layout." />}
      />

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New template' : 'Edit template'}
        size="lg"
        dismissible={!pending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="template-form" loading={pending} loadingLabel="Saving…">
              Save template
            </Button>
          </>
        }
      >
        <form id="template-form" onSubmit={save} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tpl-name" label="Name" required error={fieldErrors.name}>
              {(p) => (
                <Input
                  {...p}
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  maxLength={64}
                />
              )}
            </Field>
            <Field id="tpl-type" label="Type" error={fieldErrors.type}>
              {(p) => (
                <Select
                  {...p}
                  value={draft.type}
                  onChange={(e) => set('type', e.target.value)}
                  options={typeOptions}
                />
              )}
            </Field>
          </div>
          <Field id="tpl-title" label="Title" required error={fieldErrors.title}>
            {(p) => (
              <Input
                {...p}
                value={draft.title}
                onChange={(e) => set('title', e.target.value)}
                maxLength={256}
              />
            )}
          </Field>
          <Field
            id="tpl-body"
            label="Text"
            required
            help="Use [placeholders] for parts to fill in."
            error={fieldErrors.body}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={8}
                value={draft.body}
                onChange={(e) => set('body', e.target.value)}
                maxLength={4000}
              />
            )}
          </Field>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        loading={pending}
        title="Delete template?"
        description={
          deleting
            ? `"${deleting.name}" will be removed. Announcements created from it are not affected.`
            : undefined
        }
        confirmLabel="Delete template"
      />
    </Card>
  );
}
