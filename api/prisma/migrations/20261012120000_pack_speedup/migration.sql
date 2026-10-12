-- AlterEnum
ALTER TYPE "ShopItemKind" ADD VALUE 'PACK_SPEEDUP';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "packSpeedUntil" TIMESTAMP(3);
