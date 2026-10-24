import { describe, expect, it } from 'vitest';
import { emptyServiceForm, serviceToForm, servicePayload, slugify, type ServiceLike } from './service-form';

const existing: ServiceLike = {
  name: 'Game API',
  slug: 'game-api',
  region: 'EU',
  description: null,
  kind: 'HTTP',
  target: 'https://api.example.com/health',
  port: null,
  expectedStatus: 200,
  timeoutMs: 5000,
  degradedLatencyMs: null,
  failureThreshold: null,
  recoveryThreshold: null,
  allowPrivate: false,
  enabled: true,
  public: true,
  sortOrder: 0,
};

describe('service form', () => {
  it('slugifies names', () => {
    expect(slugify('  EU Game Node #1! ')).toBe('eu-game-node-1');
  });

  it('builds a full create payload and validates required fields', () => {
    const form = {
      ...emptyServiceForm(),
      name: 'Panel',
      slug: 'panel',
      target: 'https://panel.example.com',
      expectedStatus: '204',
    };
    const { payload, errors } = servicePayload(form);
    expect(errors).toEqual({});
    expect(payload).toMatchObject({
      name: 'Panel',
      slug: 'panel',
      kind: 'HTTP',
      target: 'https://panel.example.com',
      expectedStatus: 204,
      port: null,
      timeoutMs: 5000,
      region: null,
    });

    const tcp = servicePayload({
      ...emptyServiceForm(),
      name: 'DB',
      slug: 'db',
      kind: 'TCP',
      target: 'db.example.com',
    });
    expect(tcp.errors.port).toBeDefined();
    expect(servicePayload({ ...emptyServiceForm(), timeoutMs: '1.5' }).errors).toMatchObject({
      name: expect.any(String),
      slug: expect.any(String),
      target: expect.any(String),
      timeoutMs: 'Enter a whole number.',
    });
  });

  it('MANUAL services never send a target', () => {
    const { payload, errors } = servicePayload({
      ...emptyServiceForm(),
      name: 'Billing',
      slug: 'billing',
      kind: 'MANUAL',
      target: 'https://ignored',
    });
    expect(errors).toEqual({});
    expect(payload.target).toBeNull();
  });

  it('sends only changed fields on update', () => {
    const form = serviceToForm(existing);
    expect(servicePayload(form, existing).payload).toEqual({});
    form.region = '';
    form.failureThreshold = '5';
    form.allowPrivate = true;
    expect(servicePayload(form, existing).payload).toEqual({
      region: null,
      failureThreshold: 5,
      allowPrivate: true,
    });
  });
});
