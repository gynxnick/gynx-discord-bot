import { ButtonLink } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-xl font-semibold text-fg">Page not found</h1>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        The page you were looking for doesn&apos;t exist or may have moved.
      </p>
      <ButtonLink href="/" variant="secondary" className="mt-6">
        Back to overview
      </ButtonLink>
    </main>
  );
}
