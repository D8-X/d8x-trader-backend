-- CreateTable
CREATE TABLE "token_decimals" (
    "token_address" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "pool_id" INTEGER NOT NULL,

    CONSTRAINT "token_decimals_pkey" PRIMARY KEY ("token_address")
);

-- CreateIndex
CREATE INDEX "token_decimals_token_address_idx" ON "token_decimals" USING HASH ("token_address");

-- CreateIndex
CREATE INDEX "token_decimals_pool_id_idx" ON "token_decimals"("pool_id");
