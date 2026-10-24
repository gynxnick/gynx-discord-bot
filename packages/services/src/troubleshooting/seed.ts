import type { Prisma } from '@gynx/database';
import { audit } from '../core/audit';
import { requirePermission } from '../core/authz';
import type { Ctx } from '../core/context';
import { articleInputSchema } from './articles';
import { validateFlowDefinition } from './flow-definition';
import { SEED_ARTICLES, SEED_FLOWS } from './seed-content';

export { SEED_ARTICLES, SEED_FLOWS } from './seed-content';

/**
 * Install the curated default articles and flows. Idempotent: upsert by slug,
 * and existing rows are left untouched so staff edits are never overwritten.
 */
export async function seedDefaultContent(ctx: Ctx): Promise<{ articlesCreated: number; flowsCreated: number }> {
  await requirePermission(ctx, 'troubleshooting.manage', 'troubleshooting.seed');
  return ctx.db.$transaction(async (tx) => {
    const existingArticles = new Set(
      (await tx.knowledgeArticle.findMany({ where: { guildId: ctx.guildId }, select: { slug: true } })).map((a) => a.slug),
    );
    const existingFlows = new Set(
      (await tx.troubleshootingFlow.findMany({ where: { guildId: ctx.guildId }, select: { slug: true } })).map((f) => f.slug),
    );
    let articlesCreated = 0;
    for (const raw of SEED_ARTICLES) {
      const a = articleInputSchema.parse({ ...raw, published: true });
      await tx.knowledgeArticle.upsert({
        where: { guildId_slug: { guildId: ctx.guildId, slug: a.slug } },
        create: { ...a, game: a.game ?? null, url: null, guildId: ctx.guildId },
        update: {},
      });
      if (!existingArticles.has(a.slug)) articlesCreated++;
    }
    let flowsCreated = 0;
    for (const f of SEED_FLOWS) {
      const v = validateFlowDefinition(f.definition);
      if (!v.ok) throw new Error(`Seed flow ${f.slug} is invalid: ${v.errors.join('; ')}`);
      await tx.troubleshootingFlow.upsert({
        where: { guildId_slug: { guildId: ctx.guildId, slug: f.slug } },
        create: {
          guildId: ctx.guildId,
          slug: f.slug,
          title: f.title,
          game: f.game,
          description: f.description,
          definition: f.definition as unknown as Prisma.InputJsonValue,
          published: true,
        },
        update: {},
      });
      if (!existingFlows.has(f.slug)) flowsCreated++;
    }
    await audit(ctx, { action: 'troubleshooting.seed', metadata: { articlesCreated, flowsCreated } }, tx);
    return { articlesCreated, flowsCreated };
  });
}
