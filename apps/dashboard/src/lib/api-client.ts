/**
 * Browser-side JSON client for the dashboard API. Adds the session's CSRF
 * token to mutations and turns the `{ error: { code, message, issues } }`
 * envelope into an ApiError with a user-safe message.
 */
export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field → message map for form display. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of this.issues) if (!out[i.path]) out[i.path] = i.message;
    return out;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    csrfToken?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    if (!opts.csrfToken)
      throw new ApiError(0, 'CSRF', 'Missing request token. Reload the page and try again.');
    headers['x-csrf-token'] = opts.csrfToken;
  }
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the dashboard. Check your connection and try again.');
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; issues?: ApiIssue[] } } | null)?.error;
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.assign(`/login?error=expired&next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_' + res.status,
      err?.message ?? 'Request failed. Please try again.',
      err?.issues ?? [],
    );
  }
  return json as T;
}
