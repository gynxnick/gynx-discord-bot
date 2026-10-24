import type { PermissionKey } from '@gynx/permissions';
import { Card, CardBody } from '@/components/ui/Card';
import { PermissionDenied } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';
import { requirePagePermission } from '@/server/session';

/**
 * Permission-gated page for a section whose dashboard views are not built yet.
 * States plainly that the section is unavailable here (no fabricated data).
 */
export async function SectionPlaceholder({
  title,
  description,
  anyOf,
  page,
}: {
  title: string;
  description: string;
  anyOf: readonly PermissionKey[];
  page: string;
}) {
  const gate = await requirePagePermission(anyOf, page);
  if (!gate.ok) return <PermissionDenied permission={gate.permission} />;
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardBody>
          <p className="text-sm text-fg">This section is not available in the dashboard yet.</p>
          <p className="mt-1 text-sm text-fg-muted">
            The related bot commands keep working in Discord in the meantime.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
