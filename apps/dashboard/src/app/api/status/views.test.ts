import { describe, expect, it } from 'vitest';
import type { MonitoredService } from '@gynx/database';
import { fromLocalInput, toLocalInput, toServiceView } from './views';

describe('status views', () => {
  const svc = {
    id: 's1',
    guildId: 'g',
    name: 'API',
    slug: 'api',
    region: 'EU',
    description: null,
    kind: 'HTTP',
    target: 'https://10.0.0.5/health',
    port: null,
    expectedStatus: 200,
    timeoutMs: 5000,
    degradedLatencyMs: null,
    failureThreshold: null,
    recoveryThreshold: null,
    allowPrivate: true,
    enabled: true,
    public: true,
    sortOrder: 0,
    state: 'OPERATIONAL',
    consecutiveFailures: 0,
    consecutiveSuccesses: 3,
    lastCheckedAt: new Date('2026-01-01T00:00:00Z'),
    lastStateChangeAt: null,
    lastAlertAt: null,
    lastAlertState: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as MonitoredService;

  it('hides the internal target without status.manage', () => {
    const hidden = toServiceView(svc, false);
    expect(hidden.target).toBeNull();
    expect(hidden.targetHidden).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain('10.0.0.5');
    expect(toServiceView(svc, true).target).toBe('https://10.0.0.5/health');
  });

  it('converts guild-local datetime input to UTC and back', () => {
    const d = fromLocalInput('2026-07-01T09:30', 'Europe/London');
    expect(d?.toISOString()).toBe('2026-07-01T08:30:00.000Z');
    expect(toLocalInput(d!, 'Europe/London')).toBe('2026-07-01T09:30');
    expect(fromLocalInput('2026-01-15 09:30', 'UTC')?.toISOString()).toBe('2026-01-15T09:30:00.000Z');
    expect(fromLocalInput('2026-02-31T10:00', 'UTC')).toBeNull();
    expect(fromLocalInput('tomorrow', 'UTC')).toBeNull();
  });
});
