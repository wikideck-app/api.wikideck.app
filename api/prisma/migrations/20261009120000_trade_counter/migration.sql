-- AlterEnum
ALTER TYPE "TradeStatus" ADD VALUE 'COUNTERED';

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN "counterOfId" UUID;
