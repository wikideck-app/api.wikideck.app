CREATE TABLE "CardAlias" (
    "pageId" INTEGER NOT NULL,
    "cardId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAlias_pkey" PRIMARY KEY ("pageId")
);

CREATE INDEX "CardAlias_cardId_idx" ON "CardAlias"("cardId");

ALTER TABLE "CardAlias" ADD CONSTRAINT "CardAlias_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
