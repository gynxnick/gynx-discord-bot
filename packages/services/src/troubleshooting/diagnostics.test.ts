import { describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTIC_MAX_BYTES,
  downloadAttachment,
  isAllowedAttachmentUrl,
  isAllowedContentType,
  isAllowedLogName,
  looksBinary,
  validateAttachment,
} from './diagnostics';

const CDN = 'https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/latest.log?ex=abc&is=def&hm=123';
const meta = (over: Partial<Parameters<typeof validateAttachment>[0]> = {}) => ({ url: CDN, name: 'latest.log', size: 2048, contentType: 'text/plain; charset=utf-8', ...over });

describe('attachment validation', () => {
  it('accepts .log / .txt including latest.log and crash reports', () => {
    for (const name of ['latest.log', 'debug.log', 'crash-2024-05-01_21.33.12-server.txt', 'server.TXT']) expect(isAllowedLogName(name), name).toBe(true);
    for (const name of ['latest.log.gz', 'world.zip', 'server.jar', 'evil.exe', 'notes.txt.exe', '../latest.log', 'log', '']) expect(isAllowedLogName(name), name).toBe(false);
  });

  it('accepts text/* and octet-stream content types only', () => {
    expect(isAllowedContentType('text/plain; charset=utf-8')).toBe(true);
    expect(isAllowedContentType('application/octet-stream')).toBe(true);
    expect(isAllowedContentType(undefined)).toBe(true); // Discord omits it for some text files; content is sniffed
    expect(isAllowedContentType('application/zip')).toBe(false);
    expect(isAllowedContentType('image/png')).toBe(false);
  });

  it('only allows Discord CDN URLs', () => {
    expect(isAllowedAttachmentUrl(CDN)).toBe(true);
    expect(isAllowedAttachmentUrl('https://media.discordapp.net/attachments/1/2/latest.log')).toBe(true);
    for (const url of [
      'http://cdn.discordapp.com/attachments/1/2/a.log',
      'https://cdn.discordapp.com.evil.com/attachments/1/2/a.log',
      'https://evil.com/attachments/1/2/a.log',
      'https://cdn.discordapp.com:8443/attachments/1/2/a.log',
      'https://user:pw@cdn.discordapp.com/attachments/1/2/a.log',
      'https://cdn.discordapp.com/avatars/1/2.png',
      'https://169.254.169.254/latest/meta-data',
      'not a url',
    ]) {
      expect(isAllowedAttachmentUrl(url), url).toBe(false);
    }
  });

  it('rejects wrong type, too large, empty and non-CDN uploads with clear messages', () => {
    expect(() => validateAttachment(meta())).not.toThrow();
    expect(() => validateAttachment(meta({ name: 'world.zip' }))).toThrow(/\.log or \.txt/);
    expect(() => validateAttachment(meta({ size: DIAGNOSTIC_MAX_BYTES + 1 }))).toThrow(/larger than 1 MB/);
    expect(() => validateAttachment(meta({ size: 0 }))).toThrow(/empty/);
    expect(() => validateAttachment(meta({ contentType: 'application/x-msdownload' }))).toThrow(/plain-text/);
    expect(() => validateAttachment(meta({ url: 'https://example.com/attachments/latest.log' }))).toThrow(/uploaded directly to Discord/);
  });
});

describe('binary detection', () => {
  it('flags NUL bytes and mostly non-printable content', () => {
    expect(looksBinary(Buffer.from('PK\x03\x04\x00\x00abc', 'latin1'))).toBe(true);
    expect(looksBinary(Buffer.from(Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 0x01 : 0x41))))).toBe(true);
    expect(looksBinary(Buffer.from(Array.from({ length: 100 }, () => 0xff)))).toBe(true); // invalid UTF-8
  });

  it('accepts normal UTF-8 logs, including ANSI colours and non-ASCII text', () => {
    expect(looksBinary(Buffer.from('[10:00:00] [Server thread/INFO]: \x1b[32mDone\x1b[0m — Spieler Jürgen joined\r\n'))).toBe(false);
  });
});

function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

describe('downloadAttachment', () => {
  it('downloads with redirect disabled and a timeout signal', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return streamResponse([Buffer.from('hello '), Buffer.from('log')]);
    }) as unknown as typeof fetch;
    expect((await downloadAttachment(CDN, { fetchImpl })).toString()).toBe('hello log');
  });

  it('refuses non-CDN URLs before any request is made', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(downloadAttachment('https://evil.example/attachments/x.log', { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops streaming once the size cap is exceeded (even without content-length)', async () => {
    const big = Array.from({ length: 20 }, () => new Uint8Array(100_000));
    const fetchImpl = (async () => streamResponse(big)) as unknown as typeof fetch;
    await expect(downloadAttachment(CDN, { fetchImpl })).rejects.toThrow(/larger than 1 MB/);
    const declared = (async () => streamResponse([Buffer.from('x')], { 'content-length': String(5 * 1024 * 1024) })) as unknown as typeof fetch;
    await expect(downloadAttachment(CDN, { fetchImpl: declared })).rejects.toThrow(/larger than 1 MB/);
  });

  it('maps network failures to a retryable integration error', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(downloadAttachment(CDN, { fetchImpl })).rejects.toMatchObject({ code: 'INTEGRATION' });
  });
});
