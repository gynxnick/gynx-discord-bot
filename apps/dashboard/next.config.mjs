import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

// Local development convenience: the monorepo keeps a single `.env` at the repo root.
// Production (Docker/standalone) receives real environment variables instead.
const rootEnv = resolve(repoRoot, '.env');
if (
  process.env.NODE_ENV !== 'production' &&
  existsSync(rootEnv) &&
  typeof process.loadEnvFile === 'function'
) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    // ignore malformed local env; loadEnv() reports missing values at request time
  }
}

const isProd = process.env.NODE_ENV === 'production';

// Standalone output copies pnpm symlinks, which Windows only allows with Developer Mode/admin.
// Production images are built on Linux (Docker); on Windows hosts opt in with DASHBOARD_STANDALONE=1.
const standalone = process.platform !== 'win32' || process.env.DASHBOARD_STANDALONE === '1';

/**
 * Static security headers. The Content-Security-Policy (with a per-request
 * nonce) is set by `src/middleware.ts`.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()',
  },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(standalone ? { output: 'standalone' } : {}),
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    '@gynx/services',
    '@gynx/shared',
    '@gynx/permissions',
    '@gynx/config',
    '@gynx/database',
  ],
  serverExternalPackages: ['@prisma/client', 'ioredis', 'pino'],
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
