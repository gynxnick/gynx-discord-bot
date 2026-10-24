import { Alert } from '@/components/ui/Feedback';
import { PageHeader } from '@/components/ui/PageHeader';

/**
 * Explains why a section can't load (module disabled in settings, record not
 * found, …) using the service's user-safe message.
 */
export function ModuleNotice({
  title,
  message,
  inline = false,
}: {
  title: string;
  message: string;
  inline?: boolean;
}) {
  const alert = (
    <Alert tone="warning" title="This section is unavailable">
      {message}
    </Alert>
  );
  if (inline) return alert;
  return (
    <>
      <PageHeader title={title} />
      {alert}
    </>
  );
}
