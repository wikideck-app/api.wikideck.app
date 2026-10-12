CREATE TABLE "ImportedCard" (
    "userId" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedCard_pkey" PRIMARY KEY ("userId","cardId")
);

CREATE INDEX "ImportedCard_cardId_idx" ON "ImportedCard"("cardId");

ALTER TABLE "ImportedCard" ADD CONSTRAINT "ImportedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportedCard" ADD CONSTRAINT "ImportedCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- les cartes déjà importées (et encore possédées) sont déjà marquées
INSERT INTO "ImportedCard" ("userId", "cardId")
SELECT "userId", "cardId" FROM "UserCard" WHERE imported = true
ON CONFLICT DO NOTHING;
