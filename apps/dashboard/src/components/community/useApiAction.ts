'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useSession } from '@/components/layout/SessionProvider';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api-client';

type Method = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ActionOptions {
  /** Success toast title (omit for no toast). */
  success?: string;
  successDescription?: string;
  /** Error toast title. */
  errorTitle?: string;
  /** Refresh server components after success (default true). */
  refresh?: boolean;
}

/**
 * Mutation helper for client forms: calls the dashboard API with CSRF, maps
 * validation issues to field errors, shows toasts and refreshes the page data.
 * Returns the parsed response, or null when the call failed.
 */
export function useApiAction() {
  const { api } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T = unknown>(
      path: string,
      method: Method,
      body?: unknown,
      opts: ActionOptions = {},
    ): Promise<T | null> => {
      setPending(true);
      setError(null);
      setFieldErrors({});
      try {
        const res = await api<T>(path, { method, body });
        if (opts.success) toast.success(opts.success, opts.successDescription);
        if (opts.refresh !== false) router.refresh();
        return res;
      } catch (e) {
        const msg = (e as Error).message;
        if (e instanceof ApiError && e.issues.length) setFieldErrors(e.fieldErrors());
        setError(msg);
        toast.error(opts.errorTitle ?? 'Something went wrong', msg);
        return null;
      } finally {
        setPending(false);
      }
    },
    [api, router, toast],
  );

  const clearErrors = useCallback(() => {
    setFieldErrors({});
    setError(null);
  }, []);

  return { run, pending, fieldErrors, error, clearErrors, setFieldErrors };
}
