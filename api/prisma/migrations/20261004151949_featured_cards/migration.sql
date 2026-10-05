-- AlterTable
ALTER TABLE "User" ADD COLUMN     "featuredCardIds" UUID[] DEFAULT ARRAY[]::UUID[];
