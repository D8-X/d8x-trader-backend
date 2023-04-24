-- CreateEnum
CREATE TYPE "trade_side" AS ENUM ('buy', 'sell', 'liquidate_buy', 'liquidate_sell');

-- CreateTable
CREATE TABLE "trades_history" (
    "id" BIGSERIAL NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "perpetual_id" BIGINT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "side" "trade_side" NOT NULL,
    "order_flags" BIGINT NOT NULL DEFAULT 0,
    "price" DECIMAL(40,0) NOT NULL,
    "quantity" DECIMAL(40,0) NOT NULL,
    "feee" DECIMAL(40,0) NOT NULL,
    "realized_profit" DECIMAL(40,0) NOT NULL,
    "order_digest_hash" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "trade_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_rate_payments" (
    "id" BIGSERIAL NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "perpetual_id" BIGINT NOT NULL,
    "payment_amount" DECIMAL(40,0) NOT NULL,
    "payment_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tx_hash" TEXT NOT NULL,

    CONSTRAINT "funding_rate_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trades_history_wallet_address_idx" ON "trades_history" USING HASH ("wallet_address");

-- CreateIndex
CREATE INDEX "trades_history_tx_hash_idx" ON "trades_history" USING HASH ("tx_hash");

-- CreateIndex
CREATE INDEX "trades_history_trade_timestamp_idx" ON "trades_history"("trade_timestamp");

-- CreateIndex
CREATE INDEX "funding_rate_payments_tx_hash_idx" ON "funding_rate_payments" USING HASH ("tx_hash");
