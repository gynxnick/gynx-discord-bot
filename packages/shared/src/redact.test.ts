import { describe, expect, it } from 'vitest';
import { containsSecret, redactObject, redactSecrets } from './redact';

describe('redactSecrets', () => {
  it.each([
    ['discord bot token', ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GabcDE', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('.')],
    ['bearer header', 'Authorization: Bearer abc.def.ghijklmnop'],
    ['github token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB'],
    ['aws key', 'AKIAABCDEFGHIJKLMNOP'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
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
