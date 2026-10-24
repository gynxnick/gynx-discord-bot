import type { Metadata } from 'next';
import { listIntegrations } from '@gynx/services';
import { AiProviderList } from '@/components/troubleshooting/AiProviderForm';
import { AI_KIND, type IntegrationRow } from '@/components/troubleshooting/forms';
import { Alert, PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

export const metadata: Metadata = { title: 'AI provider' };

export default async function AiProviderPage() {
  const page = await requirePagePermission('settings.manage', 'troubleshooting.ai');
  if (!page.ok) return <PermissionDenied permission={page.permission} />;

  const items = await listIntegrations(page.ctx, AI_KIND);
  // Explicit allow-list of fields: the service view never includes the secret, and neither does this.
  const rows: IntegrationRow[] = items.map((i) => ({
    id: i.id,
    kind: i.kind,
    name: i.name,
    enabled: i.enabled,
    settings:
      i.settings && typeof i.settings === 'object' && !Array.isArray(i.settings)
        ? (i.settings as Record<string, unknown>)
        : {},
    hasSecret: i.hasSecret,
    updatedAt: i.updatedAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="AI provider"
        description="Optional AI assistance for troubleshooting. Entirely optional — leave this empty to run without AI."
        breadcrumbs={[{ label: 'Troubleshooting', href: '/troubleshooting' }, { label: 'AI provider' }]}
      />
      <div className="space-y-4">
        <Alert tone="info" title="The bot works fully without an AI provider.">
          When enabled, AI suggestions must only use approved knowledge-base content, are labelled as likely
          causes, never request credentials, and always offer human support.
        </Alert>
        <Alert tone="warning" title="No AI provider adapter ships in this release">
          The current release uses a built-in no-op provider: no AI requests are made, whatever is configured
          here. Enabling a provider only records its configuration for a future, vetted provider adapter.
          /diagnose, flows and the knowledge base keep using deterministic analysis.
        </Alert>
        <AiProviderList rows={rows} timezone={page.timezone} />
      </div>
    </>
  );
}
