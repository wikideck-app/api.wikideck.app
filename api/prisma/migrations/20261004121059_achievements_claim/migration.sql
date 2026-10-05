-- AlterTable
ALTER TABLE "UserAchievement" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- Les succès déjà débloqués l'ont été avec versement automatique : ils comptent comme récupérés
UPDATE "UserAchievement" SET "claimedAt" = "unlockedAt" WHERE "claimedAt" IS NULL;
