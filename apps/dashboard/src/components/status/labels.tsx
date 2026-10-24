import { StatusBadge, type BadgeTone } from '@/components/ui/Badge';

/** Client-safe labels/tones for status enums (mirrors @gynx/services status render labels). */
export const STATE_LABEL: Record<string, string> = {
  OPERATIONAL: 'Operational',
  DEGRADED: 'Degraded',
  OUTAGE: 'Outage',
  MAINTENANCE: 'Maintenance',
  UNKNOWN: 'Unknown',
};
const STATE_TONE: Record<string, BadgeTone> = {
  OPERATIONAL: 'success',
  DEGRADED: 'warning',
  OUTAGE: 'danger',
  MAINTENANCE: 'accent',
  UNKNOWN: 'neutral',
};

export const INCIDENT_STATUS_LABEL: Record<string, string> = {
  INVESTIGATING: 'Investigating',
  IDENTIFIED: 'Identified',
  MONITORING: 'Monitoring',
  RESOLVED: 'Resolved',
};
const INCIDENT_TONE: Record<string, BadgeTone> = {
  INVESTIGATING: 'danger',
  IDENTIFIED: 'warning',
  MONITORING: 'accent',
  RESOLVED: 'success',
};

export const SEVERITY_LABEL: Record<string, string> = {
  MINOR: 'Minor',
  MAJOR: 'Major',
  CRITICAL: 'Critical',
};
const SEVERITY_TONE: Record<string, BadgeTone> = { MINOR: 'neutral', MAJOR: 'warning', CRITICAL: 'danger' };

export const MAINTENANCE_LABEL: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
const MAINTENANCE_TONE: Record<string, BadgeTone> = {
  SCHEDULED: 'accent',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const ServiceStateBadge = ({ state }: { state: string }) => (
  <StatusBadge status={state} label={STATE_LABEL[state]} tone={STATE_TONE[state]} />
);
export const IncidentStatusBadge = ({ status }: { status: string }) => (
  <StatusBadge status={status} label={INCIDENT_STATUS_LABEL[status]} tone={INCIDENT_TONE[status]} />
);
export const SeverityBadge = ({ severity }: { severity: string }) => (
  <StatusBadge status={severity} label={SEVERITY_LABEL[severity]} tone={SEVERITY_TONE[severity]} />
);
export const MaintenanceBadge = ({ status }: { status: string }) => (
  <StatusBadge status={status} label={MAINTENANCE_LABEL[status]} tone={MAINTENANCE_TONE[status]} />
);
