'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { activeChildHref, isActivePath, type NavIcon, type NavSection } from '@/lib/nav';
import { useSession } from './SessionProvider';

const ICONS: Record<NavIcon, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z',
  status: 'M3 12h4l3-8 4 16 3-8h4',
  community:
    'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1m20 0v-1a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moderation: 'M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3Z',
  security:
    'M16.5 10.5V7a4.5 4.5 0 1 0-9 0v3.5M6 10.5h12a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5V12A1.5 1.5 0 0 1 6 10.5Z',
  troubleshooting:
    'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z',
  events: 'M8 3v3m8-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  analytics: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
};

function NavGlyph({ icon }: { icon: NavIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[icon]} />
    </svg>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 text-fg no-underline hover:no-underline">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded bg-accent text-xs font-bold text-void"
      >
        G
      </span>
      <span className="text-sm font-semibold tracking-tight">
        GYNX<span className="text-accent">.GG</span> <span className="font-normal text-fg-muted">Staff</span>
      </span>
    </Link>
  );
}

function NavList({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-0.5">
      {sections.map((s) => {
        const sectionActive = s.children
          ? s.children.some((c) => isActivePath(pathname, c.href))
          : isActivePath(pathname, s.href);
        const activeChild = s.children ? activeChildHref(pathname, s.children) : null;
        return (
          <li key={s.label}>
            <Link
              href={s.href}
              onClick={onNavigate}
              aria-current={!s.children && sectionActive ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-2.5 rounded px-3 py-2 text-sm no-underline transition-colors hover:no-underline',
                sectionActive
                  ? 'bg-surface-raised text-fg'
                  : 'text-fg-muted hover:bg-surface-raised hover:text-fg',
              )}
            >
              {sectionActive && (
                <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded bg-purple" />
              )}
              <NavGlyph icon={s.icon} />
              {s.label}
            </Link>
            {s.children && sectionActive && (
              <ul className="mb-1 ml-9 mt-0.5 space-y-0.5 border-l border-border pl-2">
                {s.children.map((c) => {
                  const active = c.href === activeChild;
                  return (
                    <li key={c.href}>
                      <Link
                        href={c.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'block rounded px-2 py-1.5 text-xs no-underline hover:no-underline',
                          active ? 'text-fg' : 'text-fg-muted hover:text-fg',
                        )}
                      >
                        {c.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function UserMenu() {
  const session = useSession();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    try {
      await session.api('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch (e) {
      toast.error('Sign-out failed', (e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {session.avatarUrl ? (
          <img src={session.avatarUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-full" />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-full bg-surface-raised text-xs text-fg-muted"
          >
            {session.username.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-[12rem] truncate text-sm text-fg sm:inline">{session.username}</span>
      </div>
      <Button variant="ghost" size="sm" onClick={logout} loading={busy} loadingLabel="Signing out…">
        Sign out
      </Button>
    </div>
  );
}

/** Authenticated application frame: sidebar (collapsible on mobile) + top bar. */
export function AppShell({
  sections,
  guildName,
  children,
}: {
  sections: NavSection[];
  guildName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    drawerRef.current?.querySelector<HTMLElement>('a')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="flex h-14 items-center border-b border-border px-4">
            <Brand />
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
            <NavList sections={sections} pathname={pathname} />
          </nav>
          <p className="truncate border-t border-border px-4 py-3 text-xs text-fg-muted" title={guildName}>
            {guildName}
          </p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            ref={drawerRef}
            id="mobile-nav"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface"
          >
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <Brand />
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
              <NavList sections={sections} pathname={pathname} onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-void/95 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-2">
            <button
              ref={toggleRef}
              type="button"
              className="rounded p-2 text-fg-muted hover:bg-surface-raised hover:text-fg lg:hidden"
              aria-label={open ? 'Close navigation' : 'Open navigation'}
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((v) => !v)}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <span className="lg:hidden">
              <Brand />
            </span>
          </div>
          <UserMenu />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
