-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('MODERATOR', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "staffRole" "StaffRole",
ADD COLUMN     "trustOverride" TEXT;

-- CreateTable
CREATE TABLE "StaffAction" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" UUID,
    "targetName" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAction_createdAt_idx" ON "StaffAction"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "StaffAction_targetId_createdAt_idx" ON "StaffAction"("targetId", "createdAt" DESC);
