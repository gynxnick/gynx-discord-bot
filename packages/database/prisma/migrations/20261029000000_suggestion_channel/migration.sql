-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN     "suggestionThreads" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Suggestion" ADD COLUMN     "threadId" TEXT;

