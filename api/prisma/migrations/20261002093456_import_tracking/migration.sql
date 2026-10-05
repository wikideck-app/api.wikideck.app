-- AlterTable
ALTER TABLE "User" ADD COLUMN     "importedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "UserCard" ADD COLUMN     "imported" BOOLEAN NOT NULL DEFAULT false;
