import { describe, expect, it } from 'vitest';
import { containsSecret, redactObject, redactSecrets } from './redact';

// Fake credentials are assembled at runtime so no token-shaped literal exists in the
// source (secret scanners, including GitHub push protection, would flag it).
const join = (...parts: string[]) => parts.join('');
const FAKE = {
  discord: [
    Buffer.from('123456789012345678').toString('base64'),
    'GabcDE',
    'abcdefghijklmnopqrstuvwxyz0123456789',
  ].join('.'),
  github: join('gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789AB'),
  aws: join('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
  privateKey: join('-----BEGIN RSA ', 'PRIVATE KEY-----\nMIIEow\n-----END RSA ', 'PRIVATE KEY-----'),
  jwt: [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from('{"sub":"1234567890"}').toString('base64url'),
    'not-a-real-signature-0123456789',
  ].join('.'),
};

describe('redactSecrets', () => {
  it.each([
    ['discord bot token', FAKE.discord],
    ['bearer header', 'Authorization: Bearer abc.def.ghijklmnop'],
    ['github token', FAKE.github],
    ['aws key', FAKE.aws],
    ['private key', FAKE.privateKey],
    ['jwt', FAKE.jwt],
  ])('removes %s', (_name, secret) => {
    const out = redactSecrets(`before ${secret} after`);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });

  it('redacts key=value credentials such as Minecraft rcon.password', () => {
    const out = redactSecrets('rcon.password=hunter22\nserver-port=25565\ndb_password: "s3cret!"');
    expect(out).toContain('rcon.password=[REDACTED]');
    expect(out).toContain('server-port=25565');
    expect(out).not.toContain('s3cret!');
  });

  it('strips URL credentials, webhooks, emails and IPs', () => {
    const out = redactSecrets(
      'mysql://root:pa55@10.0.0.4/db https://discord.com/api/webhooks/123/abcDEF me@example.com',
    );
    expect(out).not.toContain('pa55');
    expect(out).not.toContain('abcDEF');
    expect(out).not.toContain('me@example.com');
    expect(out).not.toContain('10.0.0.4');
  });

  it('leaves ordinary text alone', () => {
    const text = 'My server crashes when I install the Create mod on 1.20.1';
    expect(redactSecrets(text)).toBe(text);
    expect(containsSecret(text)).toBe(false);
  });

  it('redacts sensitive keys recursively in objects', () => {
    const out = redactObject({
      user: 'a',
      accessToken: 'xyz',
      nested: { password: 'p', note: 'token=abcdef123' },
    });
    expect(out).toEqual({
      user: 'a',
      accessToken: '[REDACTED]',
      nested: { password: '[REDACTED]', note: 'token=[REDACTED]' },
    });
  });
});
