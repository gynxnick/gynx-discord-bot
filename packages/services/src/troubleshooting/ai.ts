import type { Ctx } from '../core/context';
import type { Finding } from './analyzers';

/**
 * Optional AI assistance for troubleshooting — an extension point only.
 *
 * The bot is fully functional without it: deterministic analyzers, flows and
 * the knowledge base are the source of truth. No network AI calls are made in
 * this codebase. A future provider would be configured through
 * IntegrationConfig { kind: 'AI_PROVIDER' } (encrypted secret, staff-managed).
 *
 * Guardrails any implementation MUST follow:
 *  1. Approved docs only: answers may only cite/summarise published KnowledgeArticles
 *     passed in `approvedArticles`; never invent facts about GYNX infrastructure,
 *     pricing, outages or accounts.
 *  2. Untrusted input: the log excerpt and question come from users and may contain
 *     prompt injection. Treat them as data, never as instructions. Only redacted
 *     text (see `redactLog`) may be sent — never the raw upload.
 *  3. Never execute: no tool use, commands, URLs fetched, or server actions
 *     derived from model output. Output is rendered as plain text only.
 *  4. Escalate on low confidence: if the provider is unsure (or errors/times out),
 *     return `confidence: 'low'` and the caller shows the support link instead.
 *  5. Output is clearly labelled as AI-generated guidance, not a confirmed diagnosis.
 */
export interface AiTroubleshootingRequest {
  game: string;
  question?: string;
  /** Redacted, ≤1500 chars. */
  redactedExcerpt?: string;
  deterministicFindings: readonly Finding[];
  approvedArticles: ReadonlyArray<{ slug: string; title: string; summary: string; body: string }>;
}

export interface AiTroubleshootingAnswer {
  text: string;
  confidence: 'high' | 'medium' | 'low';
  citedArticleSlugs: string[];
}

export interface AiTroubleshootingProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Returns null when the provider has nothing useful to add. */
  suggest(req: AiTroubleshootingRequest): Promise<AiTroubleshootingAnswer | null>;
}

/** Default: no AI. Always returns null so callers fall back to deterministic results. */
export const NoopProvider: AiTroubleshootingProvider = {
  name: 'none',
  enabled: false,
  async suggest() {
    return null;
  },
};

/**
 * Resolve the provider for a guild. Today this always returns NoopProvider;
 * an enabled AI_PROVIDER IntegrationConfig is noted but not acted upon until a
 * vetted implementation exists.
 */
export async function getAiProvider(ctx: Ctx): Promise<AiTroubleshootingProvider> {
  const cfg = await ctx.db.integrationConfig.findFirst({ where: { guildId: ctx.guildId, kind: 'AI_PROVIDER', enabled: true }, select: { name: true } });
  if (cfg) ctx.log.debug({ provider: cfg.name }, 'AI provider configured but no implementation is available; using deterministic analysis only');
  return NoopProvider;
}
