import { redirect } from 'next/navigation';
import { requireSession } from '@/server/session';

export default async function SecurityIndex() {
  const { session } = await requireSession();
  redirect(
    session.permissions.has('security.reports.view') || !session.permissions.has('audit.view')
      ? '/security/reports'
      : '/security/audit',
  );
}
