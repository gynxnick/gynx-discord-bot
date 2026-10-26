-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN     "updatesChannelId" TEXT,
ADD COLUMN     "updatesStaffChannelId" TEXT,
ALTER COLUMN "enabledModules" SET DEFAULT ARRAY['status', 'community', 'moderation', 'troubleshooting', 'games', 'security', 'engagement', 'referrals', 'announcements', 'analytics', 'support', 'updates']::TEXT[];

-- CreateTable
CREATE TABLE "UpdateFeedRepo" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "branch" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "publicEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateFeedRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateFeedEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "staffMessageId" TEXT,
    "publicMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateFeedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpdateFeedRepo_guildId_fullName_key" ON "UpdateFeedRepo"("guildId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateFeedEvent_deliveryId_key" ON "UpdateFeedEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "UpdateFeedEvent_guildId_createdAt_idx" ON "UpdateFeedEvent"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "UpdateFeedEvent_repoId_idx" ON "UpdateFeedEvent"("repoId");

-- AddForeignKey
ALTER TABLE "UpdateFeedRepo" ADD CONSTRAINT "UpdateFeedRepo_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateFeedEvent" ADD CONSTRAINT "UpdateFeedEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateFeedEvent" ADD CONSTRAINT "UpdateFeedEvent_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "UpdateFeedRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Existing guilds: enable the new "updates" module (the column default only applies to new rows).
UPDATE "GuildConfig" SET "enabledModules" = array_append("enabledModules", 'updates')
WHERE NOT ('updates' = ANY("enabledModules"));
