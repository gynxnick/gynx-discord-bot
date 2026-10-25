-- CreateEnum
CREATE TYPE "SetupStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PARTIAL', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "SetupOperationType" AS ENUM ('START', 'REPAIR', 'UPDATE', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "SetupOperationStatus" AS ENUM ('PREVIEWED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SetupResourceType" AS ENUM ('ROLE', 'CATEGORY', 'TEXT_CHANNEL', 'VOICE_CHANNEL', 'MESSAGE');

-- CreateEnum
CREATE TYPE "SetupOwnership" AS ENUM ('CREATED', 'ADOPTED');

-- CreateEnum
CREATE TYPE "SetupChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'SKIPPED', 'FAILED', 'ROLLED_BACK');

-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN     "dutyPanelChannelId" TEXT,
ADD COLUMN     "dutyPanelMessage" TEXT,
ADD COLUMN     "setupLogChannelId" TEXT;

-- CreateTable
CREATE TABLE "GuildSetup" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "blueprintVersion" INTEGER NOT NULL,
    "status" "SetupStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupOperation" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "initiatedByUserId" TEXT NOT NULL,
    "operationType" "SetupOperationType" NOT NULL,
    "status" "SetupOperationStatus" NOT NULL DEFAULT 'PREVIEWED',
    "blueprintVersion" INTEGER NOT NULL,
    "selection" TEXT[],
    "targetOperationId" TEXT,
    "preview" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "result" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SetupOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupResource" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "setupOperationId" TEXT NOT NULL,
    "resourceType" "SetupResourceType" NOT NULL,
    "blueprintKey" TEXT NOT NULL,
    "discordResourceId" TEXT NOT NULL,
    "channelId" TEXT,
    "ownership" "SetupOwnership" NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "blueprintVersion" INTEGER NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupChange" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "blueprintKey" TEXT NOT NULL,
    "discordResourceId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "status" "SetupChangeStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildSetup_guildId_key" ON "GuildSetup"("guildId");

-- CreateIndex
CREATE INDEX "SetupOperation_guildId_startedAt_idx" ON "SetupOperation"("guildId", "startedAt");

-- CreateIndex
CREATE INDEX "SetupOperation_guildId_status_idx" ON "SetupOperation"("guildId", "status");

-- CreateIndex
CREATE INDEX "SetupResource_guildId_resourceType_idx" ON "SetupResource"("guildId", "resourceType");

-- CreateIndex
CREATE INDEX "SetupResource_guildId_discordResourceId_idx" ON "SetupResource"("guildId", "discordResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SetupResource_guildId_blueprintKey_key" ON "SetupResource"("guildId", "blueprintKey");

-- CreateIndex
CREATE INDEX "SetupChange_operationId_status_idx" ON "SetupChange"("operationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SetupChange_operationId_seq_key" ON "SetupChange"("operationId", "seq");

-- AddForeignKey
ALTER TABLE "GuildSetup" ADD CONSTRAINT "GuildSetup_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupOperation" ADD CONSTRAINT "SetupOperation_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupResource" ADD CONSTRAINT "SetupResource_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupChange" ADD CONSTRAINT "SetupChange_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "SetupOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

