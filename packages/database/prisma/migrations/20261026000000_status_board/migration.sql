-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN     "statusBoardChannelId" TEXT,
ADD COLUMN     "statusBoardHash" TEXT,
ADD COLUMN     "statusBoardMessage" TEXT,
ADD COLUMN     "statusBoardUpdatedAt" TIMESTAMP(3);

