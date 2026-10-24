import { z } from 'zod';
import type { Db, DiagnosticRecord, Prisma } from '@gynx/database';
import {
  AppError,
  cursorArgs,
  forbidden,
  notFound,
  paginationSchema,
  toPage,
  validation,
  type Page,
} from '@gynx/shared';
import { audit } from '../core/audit';
import { can, requirePermission, requireRate } from '../core/authz';
import { getGuildConfig, requireModule } from '../core/config';
import type { Ctx } from '../core/context';
import { readBodyCapped } from '../games/http';
import { diagnoseText, type Finding } from './analyzers';
import { gameKeySchema, supportUrlOf } from './common';

/**
 * /diagnose pipeline:
 *   validate metadata → download from Discord CDN (timeout + streaming size cap)
 *   → reject binary → redact credentials & IPs → deterministic analyzers
 *   → store findings + ≤1500-char redacted excerpt with an expiry.
 * The raw file only ever exists in memory for the duration of the request; it is
 * never written to disk, the database, logs or audit metadata.
 */

export const DIAGNOSTIC_MAX_BYTES = 1024 * 1024;
export const DIAGNOSTIC_DOWNLOAD_TIMEOUT_MS = 10_000;
/** Findings summaries (without evidence) are kept this long after the excerpt expires. */
export const DIAGNOSTIC_SUMMARY_GRACE_MS = 30 * 86_400_000;

export const UPLOAD_WARNING =
  'Logs may contain sensitive data; we automatically redact credentials and IPs; never upload files containing passwords.';

const ALLOWED_CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

export interface AttachmentMeta {
  url: string;
  name: string;
  size: number;
  contentType?: string | null;
}

export function isAllowedAttachmentUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    ALLOWED_CDN_HOSTS.has(u.hostname.toLowerCase()) &&
    u.port === '' &&
    u.username === '' &&
    u.password === '' &&
    /^\/(?:ephemeral-)?attachments\//.test(u.pathname)
  );
}

/** .txt / .log only (covers latest.log, debug.log and crash-reports/crash-*.txt). */
export function isAllowedLogName(name: string): boolean {
  return name.length > 0 && name.length <= 128 && /^[^/\\]+\.(?:txt|log)$/i.test(name);
}

/**
 * Discord omits content_type for some text files; a missing type is accepted
 * because the content itself is sniffed for binary data afterwards.
 */
export function isAllowedContentType(ct: string | null | undefined): boolean {
  if (!ct) return true;
  const base = ct.split(';')[0]!.trim().toLowerCase();
  return base.startsWith('text/') || base === 'application/octet-stream';
}

/** Throws VALIDATION with a user-facing reason. */
export function validateAttachment(meta: AttachmentMeta): void {
  if (!isAllowedLogName(meta.name))
    throw validation(
      'Only .log or .txt files can be analysed (for example latest.log or crash-reports/crash-….txt).',
    );
  if (!Number.isFinite(meta.size) || meta.size <= 0) throw validation('That file is empty.');
  if (meta.size > DIAGNOSTIC_MAX_BYTES)
    throw validation(
      'That file is larger than 1 MB. Upload just the relevant log (e.g. latest.log) or a crash report.',
    );
  if (!isAllowedContentType(meta.contentType))
    throw validation('That file does not look like a plain-text log.');
  if (!isAllowedAttachmentUrl(meta.url))
    throw validation('Attachments must be uploaded directly to Discord.');
}

/** NUL bytes or > 10% non-printable characters → binary. */
export function looksBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  if (buf.includes(0)) return true;
  let bad = 0;
  for (const b of buf) {
    if (b === 9 || b === 10 || b === 13 || b === 27) continue; // tab, LF, CR, ESC (ANSI colours)
    if (b < 32 || b === 127) bad++;
  }
  const text = buf.toString('utf8');
  for (const ch of text) if (ch === '�') bad++;
  return bad / buf.length > 0.1;
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Download from the Discord CDN only, with a timeout and a streaming size cap. Never touches disk. */
export async function downloadAttachment(url: string, opts: DownloadOptions = {}): Promise<Buffer> {
  if (!isAllowedAttachmentUrl(url)) throw validation('Attachments must be uploaded directly to Discord.');
  const maxBytes = opts.maxBytes ?? DIAGNOSTIC_MAX_BYTES;
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? DIAGNOSTIC_DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('INTEGRATION', 'Could not download the file from Discord. Please try again.');
  }
  if (!res.ok)
    throw new AppError('INTEGRATION', 'Could not download the file from Discord. Please try again.');
  let body: Buffer | null;
  try {
    body = await readBodyCapped(res, maxBytes);
  } catch {
    throw new AppError('INTEGRATION', 'Downloading the file took too long. Please try again.');
  }
  if (!body) throw validation('That file is larger than 1 MB.');
  return body;
}

/** Strip anything control-ish from a user-provided file name before storing it. */
const safeFileName = (n: string) => n.replace(/[^\w.() -]/g, '_').slice(0, 100);

export const runDiagnosisSchema = z.object({
  attachment: z.object({
    url: z.string().max(2000),
    name: z.string().max(256),
    size: z.number().int(),
    contentType: z.string().max(200).nullish(),
  }),
  game: gameKeySchema.optional(),
});

export interface DiagnosisOutcome {
  recordId: string;
  game: string;
  findings: Finding[];
  supportUrl: string | null;
  expiresAt: Date;
}

export async function runDiagnosis(
  ctx: Ctx,
  raw: z.input<typeof runDiagnosisSchema>,
  opts: DownloadOptions = {},
): Promise<DiagnosisOutcome> {
  const cfg = await requireModule(ctx, 'troubleshooting');
  const input = runDiagnosisSchema.parse(raw);
  validateAttachment(input.attachment);
  await requireRate(ctx, 'troubleshooting.diagnose', 3, 300);

  const buf = await downloadAttachment(input.attachment.url, opts);
  if (buf.length === 0) throw validation('That file is empty.');
  if (looksBinary(buf))
    throw validation(
      'That file looks binary, not a text log. Please upload a .log or .txt file saved as UTF-8.',
    );

  // Redaction happens inside diagnoseText before any analysis; `buf` is dropped after this call.
  const result = diagnoseText(buf.toString('utf8'), input.game ?? null);
  const expiresAt = new Date(ctx.now().getTime() + cfg.diagnosticRetentionHours * 3_600_000);

  const record = await ctx.db.$transaction(async (tx) => {
    const rec = await tx.diagnosticRecord.create({
      data: {
        guildId: ctx.guildId,
        userId: ctx.actor.userId,
        game: result.game,
        fileName: safeFileName(input.attachment.name),
        fileSize: buf.length,
        findings: result.findings as unknown as Prisma.InputJsonValue,
        redactedExcerpt: result.excerpt || null,
        expiresAt,
      },
    });
    // Metadata: ids only — never content or evidence.
    await audit(
      ctx,
      {
        action: 'troubleshooting.diagnose',
        targetType: 'DiagnosticRecord',
        targetId: rec.id,
        metadata: { game: result.game, size: buf.length, findings: result.findings.map((f) => f.id) },
      },
      tx,
    );
    return rec;
  });
  return {
    recordId: record.id,
    game: result.game,
    findings: result.findings,
    supportUrl: supportUrlOf(cfg),
    expiresAt,
  };
}

/** Owner (or staff) access to a stored diagnosis. */
export async function getDiagnostic(ctx: Ctx, id: string): Promise<DiagnosticRecord> {
  await requireModule(ctx, 'troubleshooting');
  const r = await ctx.db.diagnosticRecord.findFirst({
    where: { id: z.string().min(1).max(40).parse(id), guildId: ctx.guildId },
  });
  if (!r) throw notFound('Diagnosis');
  if (r.userId !== ctx.actor.userId && !can(ctx, 'troubleshooting.manage')) throw forbidden();
  return r;
}

export async function listDiagnostics(
  ctx: Ctx,
  raw: z.input<typeof paginationSchema> = {},
): Promise<Page<DiagnosticRecord>> {
  await requirePermission(ctx, 'troubleshooting.manage');
  const p = paginationSchema.parse(raw);
  const rows = await ctx.db.diagnosticRecord.findMany({
    where: { guildId: ctx.guildId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...cursorArgs(p),
  });
  return toPage(rows, p.limit);
}

/** "This helped" / "Still stuck" on a diagnosis. Only the uploader can respond. */
export async function diagnosticFeedback(
  ctx: Ctx,
  id: string,
  helped: boolean,
): Promise<{ supportUrl: string | null }> {
  const r = await getDiagnostic(ctx, id);
  if (r.userId !== ctx.actor.userId) throw forbidden('Only the member who uploaded this file can respond.');
  if (!helped && !r.escalated)
    await ctx.db.diagnosticRecord.update({ where: { id: r.id }, data: { escalated: true } });
  return { supportUrl: supportUrlOf(await getGuildConfig(ctx.db, ctx.guildId)) };
}

const stripEvidence = (findings: unknown): Prisma.InputJsonValue =>
  (Array.isArray(findings) ? findings : []).map((f) => {
    const { evidence: _e, ...rest } = (f ?? {}) as Record<string, unknown>;
    return rest;
  }) as Prisma.InputJsonValue;

/**
 * Retention (worker):
 *  1. expiresAt passed → drop the redacted excerpt and evidence, set purgedAt (summary kept).
 *  2. expiresAt + 30 days passed → delete the record entirely.
 */
export async function purgeExpiredDiagnostics(
  db: Db,
  guildId: string,
  now: Date,
): Promise<{ purged: number; deleted: number }> {
  const deleted = await db.diagnosticRecord.deleteMany({
    where: { guildId, expiresAt: { lt: new Date(now.getTime() - DIAGNOSTIC_SUMMARY_GRACE_MS) } },
  });
  const due = await db.diagnosticRecord.findMany({
    where: { guildId, purgedAt: null, expiresAt: { lte: now } },
    select: { id: true, findings: true },
    take: 500,
  });
  for (const r of due) {
    await db.diagnosticRecord.updateMany({
      where: { id: r.id, purgedAt: null },
      data: { redactedExcerpt: null, findings: stripEvidence(r.findings), purgedAt: now },
    });
  }
  return { purged: due.length, deleted: deleted.count };
}
