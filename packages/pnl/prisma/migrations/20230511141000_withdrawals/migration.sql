-- CreateTable
CREATE TABLE "liquidity_withdrawals" (
    "id" BIGSERIAL NOT NULL,
    "user_wallet" TEXT NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "amount" DECIMAL(40,0) NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "is_removal" BOOLEAN NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidity_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_pool_id_idx" ON "liquidity_withdrawals" USING HASH ("pool_id");

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_user_wallet_idx" ON "liquidity_withdrawals" USING HASH ("user_wallet");

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_timestamp_idx" ON "liquidity_withdrawals"("timestamp");
