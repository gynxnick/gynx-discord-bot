-- AlterTable
ALTER TABLE "AutomodConfig" ADD COLUMN     "warningExpiryDays" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "GiveawayDraw" ADD COLUMN     "announcedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "decisionNotifiedAt" TIMESTAMP(3);

