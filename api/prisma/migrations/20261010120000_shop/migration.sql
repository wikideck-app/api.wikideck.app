-- CreateEnum
CREATE TYPE "ShopItemKind" AS ENUM ('WIKIPEDIA_PACKS', 'ANIME_PACKS', 'LUCK_BOOST', 'DUPLICATE_SHIELD', 'DUPLICATE_REDUCTION');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "dupShieldPacks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "dupReduceUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShopItem" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ShopItemKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "maxPerUser" INTEGER,
    "maxPerUserPerDay" INTEGER,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "availableFrom" TIMESTAMP(3),
    "availableUntil" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopPurchase" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "itemId" UUID,
    "itemName" TEXT NOT NULL,
    "kind" "ShopItemKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopItem_active_sortOrder_idx" ON "ShopItem"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "ShopPurchase_userId_itemId_idx" ON "ShopPurchase"("userId", "itemId");

-- CreateIndex
CREATE INDEX "ShopPurchase_createdAt_idx" ON "ShopPurchase"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ShopPurchase" ADD CONSTRAINT "ShopPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPurchase" ADD CONSTRAINT "ShopPurchase_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ShopItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
