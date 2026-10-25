-- CreateEnum
CREATE TYPE "DutyEndReason" AS ENUM ('MANUAL', 'EXPIRED', 'LEFT_SERVER', 'ENDED_BY_ADMIN', 'PROFILE_REMOVED');

-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN     "dutyMaxHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "supportStatusChangedAt" TIMESTAMP(3),
ADD COLUMN     "supportStatusChannelId" TEXT,
ADD COLUMN     "supportStatusHash" TEXT,
ADD COLUMN     "supportStatusMessage" TEXT,
ADD COLUMN     "websiteUrl" TEXT,
ALTER COLUMN "enabledModules" SET DEFAULT ARRAY['status', 'community', 'moderation', 'troubleshooting', 'games', 'security', 'engagement', 'referrals', 'announcements', 'analytics', 'support']::TEXT[];

-- CreateTable
CREATE TABLE "DutyProfile" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyProfile_pkey" PRIMARY KEY ("guildId","userId")
);

-- CreateTable
CREATE TABLE "DutySession" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "DutyEndReason",
    "endedById" TEXT,

    CONSTRAINT "DutySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutySession_guildId_endedAt_idx" ON "DutySession"("guildId", "endedAt");

-- CreateIndex
CREATE INDEX "DutySession_guildId_userId_endedAt_idx" ON "DutySession"("guildId", "userId", "endedAt");

-- AddForeignKey
ALTER TABLE "DutyProfile" ADD CONSTRAINT "DutyProfile_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutySession" ADD CONSTRAINT "DutySession_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing guilds: enable the new "support" module (the column default only applies to new rows).
UPDATE "GuildConfig" SET "enabledModules" = array_append("enabledModules", 'support')
WHERE NOT ('support' = ANY("enabledModules"));
