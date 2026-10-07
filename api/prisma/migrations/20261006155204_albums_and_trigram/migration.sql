-- CreateTable
CREATE TABLE "Album" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlbumCard" (
    "albumId" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumCard_pkey" PRIMARY KEY ("albumId","cardId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Album_userId_name_key" ON "Album"("userId", "name");

-- CreateIndex
CREATE INDEX "AlbumCard_cardId_idx" ON "AlbumCard"("cardId");

-- CreateIndex
CREATE INDEX "WikiArticle_title_trgm_idx" ON "WikiArticle" USING GIN ("title" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumCard" ADD CONSTRAINT "AlbumCard_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumCard" ADD CONSTRAINT "AlbumCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
