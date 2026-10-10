-- AlterEnum
ALTER TYPE "CardSource" ADD VALUE 'KITSU';

-- CreateIndex
CREATE INDEX "Card_source_rarity_idx" ON "Card"("source", "rarity");
