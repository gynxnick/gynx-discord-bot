import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Feedback';
import { buttonClasses } from '@/components/ui/Button';
import { firstParam, type SearchParams } from '@/lib/pagination';
import { LOGIN_ERRORS, isLoginErrorCode, safeReturnTo } from '@/server/auth/oauth';
import { getSession } from '@/server/session';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

async function currentSession() {
  try {
    return await getSession();
  } catch {
    // Misconfiguration or DB outage: still render the login page.
    return null;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const error = firstParam(sp, 'error');
  const next = safeReturnTo(firstParam(sp, 'next'));
  if (!error && (await currentSession())) redirect(next);

  const loginHref = next === '/' ? '/api/auth/login' : `/api/auth/login?next=${encodeURIComponent(next)}`;
  const message = isLoginErrorCode(error) ? LOGIN_ERRORS[error] : null;
  const tone = error === 'expired' || error === 'cancelled' ? 'info' : 'danger';

  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded bg-accent text-sm font-bold text-void"
          >
            G
          </span>
          <span className="text-lg font-semibold tracking-tight text-fg">
            GYNX<span className="text-accent">.GG</span>
          </span>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold text-fg">Staff dashboard</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Access is limited to GYNX.GG staff. Sign in with the Discord account you use on the GYNX.GG
            server; your staff role decides what you can see and change.
          </p>
          {message && (
            <Alert tone={tone} className="mt-4">
              {message}
            </Alert>
          )}
          <a href={loginHref} className={buttonClasses('primary', 'lg', 'mt-6 w-full')}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
            </svg>
            Sign in with Discord
          </a>
          <p className="mt-4 text-xs text-fg-muted">
            We only request your Discord identity (the <code className="font-mono">identify</code> scope). We
            never see your password and don&apos;t store your Discord access token.
          </p>
        </div>
        <p className="mt-6 text-center text-xs text-fg-muted">
          Not staff? This area isn&apos;t for you — head back to Discord.
        </p>
      </div>
    </main>
  );
}
