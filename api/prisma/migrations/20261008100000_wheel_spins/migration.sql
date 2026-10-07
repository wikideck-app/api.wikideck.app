-- CreateTable
CREATE TABLE "WheelSpin" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WheelSpin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WheelSpin_createdAt_idx" ON "WheelSpin"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "WheelSpin_userId_createdAt_idx" ON "WheelSpin"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "WheelSpin" ADD CONSTRAINT "WheelSpin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

