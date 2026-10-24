'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api-client';

export interface ClientSession {
  userId: string;
  username: string;
  avatarUrl: string | null;
  csrfToken: string;
  permissions: string[];
}

interface SessionApi extends ClientSession {
  can: (permission: string) => boolean;
  /** apiFetch with this session's CSRF token attached. */
  api: <T = unknown>(
    path: string,
    opts?: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal },
  ) => Promise<T>;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ session, children }: { session: ClientSession; children: ReactNode }) {
  const api = useCallback<SessionApi['api']>(
    (path, opts = {}) => apiFetch(path, { ...opts, csrfToken: session.csrfToken }),
    [session.csrfToken],
  );
  const value = useMemo<SessionApi>(() => {
    const set = new Set(session.permissions);
    return { ...session, can: (p) => set.has(p), api };
  }, [session, api]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
