import { dashboardEnvSchema, loadEnv, type DashboardEnv } from '@gynx/config';

let cached: DashboardEnv | undefined;

/**
 * Lazily validated dashboard environment. Never evaluated at import time so
 * `next build` (which imports route modules) succeeds without secrets present.
 */
export function getEnv(): DashboardEnv {
  if (!cached) cached = loadEnv(dashboardEnvSchema);
  return cached;
}

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Canonical origin of the dashboard (e.g. https://dash.gynx.gg). */
export function dashboardOrigin(): string {
  return new URL(getEnv().DASHBOARD_URL).origin;
}

/** Reset for tests. */
export function __resetEnvForTests(): void {
  cached = undefined;
}
