-- CreateTable
CREATE TABLE "WikiArticle" (
    "pageId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "views" INTEGER NOT NULL,
    "rarity" "Rarity" NOT NULL,

    CONSTRAINT "WikiArticle_pkey" PRIMARY KEY ("pageId")
);

-- CreateIndex
CREATE INDEX "WikiArticle_rarity_views_idx" ON "WikiArticle"("rarity", "views" DESC);

-- CreateIndex
CREATE INDEX "WikiArticle_views_idx" ON "WikiArticle"("views" DESC);

-- CreateIndex
CREATE INDEX "WikiArticle_title_idx" ON "WikiArticle"("title");

-- Recherche « contient » sur les titres (ILIKE '%…%') sans parcourir toute la table
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "WikiArticle_title_trgm_idx" ON "WikiArticle" USING gin ("title" gin_trgm_ops);
