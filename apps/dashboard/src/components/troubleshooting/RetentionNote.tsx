import { Alert } from '@/components/ui/Feedback';

export function RetentionNote({ hours }: { hours: number }) {
  return (
    <Alert tone="info" title="Raw uploads are never stored; excerpts expire after the configured retention.">
      Files sent to /diagnose are analysed in memory and discarded. Only the findings and a short, redacted
      excerpt are kept, and the excerpt is removed after {hours} hour
      {hours === 1 ? '' : 's'} (the summary is deleted 30 days later). Nothing here can be downloaded.
    </Alert>
  );
}
