-- AlterEnum
ALTER TYPE "Rarity" ADD VALUE 'MYTHIC';

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "baseCardId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Card_baseCardId_key" ON "Card"("baseCardId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_baseCardId_fkey" FOREIGN KEY ("baseCardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

