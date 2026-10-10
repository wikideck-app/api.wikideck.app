-- CreateTable
CREATE TABLE "QuestClaim" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "questId" TEXT NOT NULL,
    "reward" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestClaim_userId_questId_key" ON "QuestClaim"("userId", "questId");

-- AddForeignKey
ALTER TABLE "QuestClaim" ADD CONSTRAINT "QuestClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
