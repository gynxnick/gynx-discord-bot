-- CreateTable
CREATE TABLE "RolePanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "groups" TEXT[],
    "hash" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePanel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RolePanel_guildId_idx" ON "RolePanel"("guildId");

-- AddForeignKey
ALTER TABLE "RolePanel" ADD CONSTRAINT "RolePanel_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

