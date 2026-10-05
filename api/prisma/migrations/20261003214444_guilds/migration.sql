-- CreateEnum
CREATE TYPE "GuildRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "WishStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScoreKind" AS ENUM ('INFLUENCE', 'AUCTION');

-- CreateTable
CREATE TABLE "Guild" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildMember" (
    "id" UUID NOT NULL,
    "guildId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "GuildRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipTotal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GuildMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildWish" (
    "id" UUID NOT NULL,
    "guildId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "status" "WishStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "giverId" UUID,

    CONSTRAINT "GuildWish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildScoreEvent" (
    "id" UUID NOT NULL,
    "guildId" UUID NOT NULL,
    "userId" UUID,
    "kind" "ScoreKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildScoreEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildWeekSettled" (
    "weekStart" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildWeekSettled_pkey" PRIMARY KEY ("weekStart")
);

-- CreateTable
CREATE TABLE "GuildWeekResult" (
    "weekStart" TIMESTAMP(3) NOT NULL,
    "guildId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "guildName" TEXT NOT NULL,

    CONSTRAINT "GuildWeekResult_pkey" PRIMARY KEY ("weekStart","guildId")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildMember_userId_key" ON "GuildMember"("userId");

-- CreateIndex
CREATE INDEX "GuildMember_guildId_idx" ON "GuildMember"("guildId");

-- CreateIndex
CREATE INDEX "GuildWish_guildId_status_idx" ON "GuildWish"("guildId", "status");

-- CreateIndex
CREATE INDEX "GuildWish_userId_status_idx" ON "GuildWish"("userId", "status");

-- CreateIndex
CREATE INDEX "GuildWish_userId_fulfilledAt_idx" ON "GuildWish"("userId", "fulfilledAt");

-- CreateIndex
CREATE INDEX "GuildScoreEvent_weekStart_guildId_idx" ON "GuildScoreEvent"("weekStart", "guildId");

-- CreateIndex
CREATE INDEX "GuildScoreEvent_guildId_userId_weekStart_idx" ON "GuildScoreEvent"("guildId", "userId", "weekStart");

-- CreateIndex
CREATE INDEX "GuildWeekResult_weekStart_rank_idx" ON "GuildWeekResult"("weekStart", "rank");

-- AddForeignKey
ALTER TABLE "GuildMember" ADD CONSTRAINT "GuildMember_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildMember" ADD CONSTRAINT "GuildMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildWish" ADD CONSTRAINT "GuildWish_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildWish" ADD CONSTRAINT "GuildWish_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildWish" ADD CONSTRAINT "GuildWish_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildWish" ADD CONSTRAINT "GuildWish_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildScoreEvent" ADD CONSTRAINT "GuildScoreEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildScoreEvent" ADD CONSTRAINT "GuildScoreEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildWeekResult" ADD CONSTRAINT "GuildWeekResult_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
