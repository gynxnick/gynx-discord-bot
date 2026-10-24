import { describe, expect, it } from 'vitest';
import { COMMAND_POLICIES } from '@gynx/permissions';
import { buildCommandPayload } from '../framework/commands-json';
import { modules } from '.';

const commands = modules.flatMap((m) => m.commands ?? []);

describe('command registry', () => {
  it('implements exactly the commands defined in COMMAND_POLICIES', () => {
    const implemented = commands.map((c) => c.data.name).sort();
    expect(implemented).toEqual(Object.keys(COMMAND_POLICIES).sort());
  });

  it('has unique command names and component prefixes', () => {
    const names = commands.map((c) => c.data.name);
    expect(new Set(names).size).toBe(names.length);
    const prefixes = modules.flatMap((m) => (m.components ?? []).map((h) => h.prefix));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('produces payloads within Discord registration limits', () => {
    const payload = buildCommandPayload(commands);
    expect(payload.length).toBeLessThanOrEqual(100);
    for (const c of payload) {
      expect(c.name, c.name).toMatch(/^[-_a-z0-9]{1,32}$/);
      expect(c.description.length, c.name).toBeGreaterThan(0);
      expect(c.description.length, c.name).toBeLessThanOrEqual(100);
      expect((c.options ?? []).length, c.name).toBeLessThanOrEqual(25);
      expect(c.contexts).toEqual([0]); // guild only
      expect(JSON.stringify(c).length, c.name).toBeLessThan(8000);
    }
  });

  it('hides every staff command from regular members by default', () => {
    const payload = buildCommandPayload(commands);
    for (const c of payload) {
      const policy = COMMAND_POLICIES[c.name]!;
      if (policy.discordDefault) expect(c.default_member_permissions, c.name).not.toBeNull();
    }
  });
});
