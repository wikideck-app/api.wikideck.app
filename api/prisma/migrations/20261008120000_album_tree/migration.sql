-- Sous-albums : un album peut avoir un parent (suppression en cascade)
ALTER TABLE "Album" ADD COLUMN "parentId" UUID;

-- Le nom n'est plus unique par joueur mais par parent ; NULL n'étant jamais égal à NULL en SQL,
-- les albums de premier niveau ont leur propre index partiel
DROP INDEX "Album_userId_name_key";
CREATE UNIQUE INDEX "Album_root_name_key" ON "Album"("userId", "name") WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "Album_child_name_key" ON "Album"("userId", "parentId", "name") WHERE "parentId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Album_userId_parentId_idx" ON "Album"("userId", "parentId");

-- AddForeignKey
ALTER TABLE "Album" ADD CONSTRAINT "Album_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
