import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'GYNX.GG Staff Dashboard', template: '%s · GYNX.GG Staff' },
  description: 'Staff administration for the GYNX.GG Discord community.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0B0B0F', colorScheme: 'dark' };

// Every response carries a per-request CSP nonce, so nothing may be statically prerendered.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading headers opts into dynamic rendering so Next applies the CSP nonce to its scripts.
  await headers();
  return (
    <html lang="en" className="bg-void">
      <body>
        <a
          href="#main"
          className="sr-only-focusable fixed left-2 top-2 z-50 rounded bg-surface-raised px-3 py-2 text-fg"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
