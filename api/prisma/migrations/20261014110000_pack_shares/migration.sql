CREATE TABLE "PackShare" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "ownerName" TEXT,
    "cards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PackShare_userId_key_idx" ON "PackShare"("userId", "key");

CREATE INDEX "PackShare_userId_createdAt_idx" ON "PackShare"("userId", "createdAt");

ALTER TABLE "PackShare" ADD CONSTRAINT "PackShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
