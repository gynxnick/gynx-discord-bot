import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { SessionProvider } from '@/components/layout/SessionProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { avatarUrl } from '@/lib/discord';
import { visibleNav } from '@/lib/nav';
import { getDeps } from '@/server/deps';
import { requireSession } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { session } = await requireSession();
  const guild = await getDeps().db.guild.findUnique({
    where: { id: session.guildId },
    select: { name: true },
  });
  const sections = visibleNav(session.permissions);
  return (
    <SessionProvider
      session={{
        userId: session.userId,
        username: session.username,
        avatarUrl: avatarUrl(session.userId, session.avatar),
        csrfToken: session.csrfToken,
        permissions: [...session.permissions],
      }}
    >
      <ToastProvider>
        <AppShell sections={sections} guildName={guild?.name ?? 'GYNX.GG'}>
          {children}
        </AppShell>
      </ToastProvider>
    </SessionProvider>
  );
}
