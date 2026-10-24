import { describe, expect, it } from 'vitest';
import type { Incident, MonitoredService } from '@gynx/database';
import { canTransitionIncident, severitiesAtOrBelow } from './incidents';
import {
  computeUptime,
  overallState,
  toPublicIncident,
  toPublicMaintenance,
  toPublicService,
} from './public';
import { alertEmbed, incidentEmbed, statusPageEmbed } from './render';
import { validateTarget } from './services';

const service: MonitoredService = {
  id: 'svc1',
  guildId: 'g',
  name: 'Game Panel',
  slug: 'panel',
  region: 'EU-West',
  description: 'Control panel',
  kind: 'HTTP',
  target: 'https://internal-panel.secret-host.example:8443/health',
  port: 8443,
  expectedStatus: 200,
  timeoutMs: 5000,
  degradedLatencyMs: 1000,
  failureThreshold: 3,
  recoveryThreshold: 2,
  allowPrivate: true,
  enabled: true,
  public: true,
  sortOrder: 0,
  state: 'OUTAGE',
  consecutiveFailures: 4,
  consecutiveSuccesses: 0,
  lastCheckedAt: new Date(),
  lastStateChangeAt: new Date(),
  lastAlertAt: new Date(),
  lastAlertState: 'OUTAGE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('uptime math', () => {
  it('is ok checks / total checks', () => {
    expect(computeUptime(99, 100)).toEqual({ uptimePct: 99, label: '99.00%' });
    expect(computeUptime(100, 100)).toEqual({ uptimePct: 100, label: '100.00%' });
    expect(computeUptime(0, 7)).toEqual({ uptimePct: 0, label: '0.00%' });
  });
  it('floors so a single failure never shows as 100%', () => {
    expect(computeUptime(99_999, 100_000).label).toBe('99.99%');
  });
  it('reports "no data" — never an invented 100% — when there are no checks', () => {
    expect(computeUptime(0, 0)).toEqual({ uptimePct: null, label: 'no data' });
  });
});

describe('overall state', () => {
  it('worst state wins and unknown only when nothing is known', () => {
    expect(overallState([])).toBe('NO_SERVICES');
    expect(overallState(['UNKNOWN', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(overallState(['OPERATIONAL', 'UNKNOWN'])).toBe('OPERATIONAL');
    expect(overallState(['OPERATIONAL', 'DEGRADED', 'MAINTENANCE'])).toBe('DEGRADED');
    expect(overallState(['OPERATIONAL', 'OUTAGE', 'DEGRADED'])).toBe('OUTAGE');
  });
});

describe('incident rules', () => {
  it('allows skipping forward and forbids anything after RESOLVED', () => {
    expect(canTransitionIncident('INVESTIGATING', 'MONITORING')).toBe(true);
    expect(canTransitionIncident('INVESTIGATING', 'RESOLVED')).toBe(true);
    expect(canTransitionIncident('IDENTIFIED', 'IDENTIFIED')).toBe(true);
    expect(canTransitionIncident('RESOLVED', 'INVESTIGATING')).toBe(false);
    expect(canTransitionIncident('RESOLVED', 'RESOLVED')).toBe(false);
  });
  it('maps subscriber minSeverity filters', () => {
    expect(severitiesAtOrBelow('MINOR')).toEqual(['MINOR']);
    expect(severitiesAtOrBelow('MAJOR')).toEqual(['MINOR', 'MAJOR']);
    expect(severitiesAtOrBelow('CRITICAL')).toEqual(['MINOR', 'MAJOR', 'CRITICAL']);
  });
});

describe('public projections never expose monitoring internals', () => {
  const forbidden = [
    'secret-host',
    'target',
    'allowPrivate',
    'errorClass',
    'port',
    'consecutive',
    'lastAlert',
    'createdById',
  ];
  const assertClean = (value: unknown) => {
    const json = JSON.stringify(value);
    for (const f of forbidden) expect(json, `leaked "${f}"`).not.toContain(f);
  };

  it('service projection', () => {
    const p = toPublicService(service);
    expect(p).toMatchObject({ slug: 'panel', name: 'Game Panel', state: 'OUTAGE' });
    assertClean(p);
  });

  it('incident + maintenance projections and rendered embeds', () => {
    const incident: Incident & { services: MonitoredService[] } = {
      id: 'i1',
      guildId: 'g',
      number: 1,
      ref: 'INC-0001',
      title: 'Panel down',
      description: 'We are investigating',
      severity: 'MAJOR',
      status: 'INVESTIGATING',
      regions: ['EU-West'],
      services: [service, { ...service, id: 'svc2', slug: 'hidden', name: 'Hidden internal', public: false }],
      startedAt: new Date(),
      resolvedAt: null,
      resolutionSummary: null,
      autoCreated: true,
      createdById: '123456789012345678',
      channelId: '1',
      messageId: '2',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const pi = toPublicIncident(incident);
    expect(pi.services).toEqual([{ slug: 'panel', name: 'Game Panel' }]); // non-public service hidden
    assertClean(pi);
    expect(JSON.stringify(pi)).not.toContain('Hidden internal');

    const pm = toPublicMaintenance({
      id: 'm1',
      title: 'Upgrade',
      description: 'Kernel upgrade',
      status: 'SCHEDULED',
      startsAt: new Date(),
      endsAt: new Date(),
      services: [service],
    });
    assertClean(pm);

    const page = statusPageEmbed({
      overall: 'OUTAGE',
      services: [toPublicService(service)],
      activeIncidents: [pi],
      upcomingMaintenance: [pm],
      generatedAt: new Date(),
    });
    assertClean(page);
    assertClean(incidentEmbed(pi));
    assertClean(alertEmbed(toPublicService(service), 'OPERATIONAL'));
  });
});

describe('target validation', () => {
  it('accepts http(s) URLs and host+port for TCP', () => {
    expect(
      validateTarget({
        kind: 'HTTP',
        target: 'https://status.gynx.gg/health',
        port: null,
        allowPrivate: false,
      }).target,
    ).toBe('https://status.gynx.gg/health');
    expect(
      validateTarget({ kind: 'TCP', target: 'Node1.GYNX.gg', port: 25565, allowPrivate: false }),
    ).toEqual({ target: 'node1.gynx.gg', port: 25565 });
    expect(validateTarget({ kind: 'MANUAL', target: 'ignored', port: 1, allowPrivate: false })).toEqual({
      target: null,
      port: null,
    });
  });
  it('rejects other schemes, credentials, missing ports and private literals without allowPrivate', () => {
    const bad = [
      { kind: 'HTTP' as const, target: 'ftp://x.example', port: null },
      { kind: 'HTTP' as const, target: 'file:///etc/passwd', port: null },
      { kind: 'HTTP' as const, target: 'https://user:pass@x.example', port: null },
      { kind: 'HTTP' as const, target: 'http://169.254.169.254/latest/meta-data', port: null },
      { kind: 'HTTP' as const, target: 'http://localhost:8080', port: null },
      { kind: 'STATUSPAGE' as const, target: 'not a url', port: null },
      { kind: 'TCP' as const, target: 'node.example.com', port: null },
      { kind: 'TCP' as const, target: 'node.example.com:22', port: 22 },
      { kind: 'TCP' as const, target: '10.0.0.5', port: 22 },
    ];
    for (const b of bad) expect(() => validateTarget({ ...b, allowPrivate: false }), b.target).toThrow();
    expect(() =>
      validateTarget({ kind: 'TCP', target: '10.0.0.5', port: 22, allowPrivate: true }),
    ).not.toThrow();
  });
});
