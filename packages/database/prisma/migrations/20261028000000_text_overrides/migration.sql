-- CreateTable
CREATE TABLE "TextOverride" (
    "guildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextOverride_pkey" PRIMARY KEY ("guildId","key")
);

-- AddForeignKey
ALTER TABLE "TextOverride" ADD CONSTRAINT "TextOverride_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

