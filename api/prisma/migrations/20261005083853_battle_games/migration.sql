-- CreateTable
CREATE TABLE "BattleGame" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startArticle" TEXT NOT NULL,
    "targetArticle" TEXT NOT NULL,
    "path" JSONB NOT NULL,
    "clicks" INTEGER NOT NULL,
    "timeSeconds" DOUBLE PRECISION NOT NULL,
    "won" BOOLEAN NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BattleGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BattleGame_userId_playedAt_idx" ON "BattleGame"("userId", "playedAt" DESC);

-- AddForeignKey
ALTER TABLE "BattleGame" ADD CONSTRAINT "BattleGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
