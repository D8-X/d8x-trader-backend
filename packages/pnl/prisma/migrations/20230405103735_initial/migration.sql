-- CreateEnum
CREATE TYPE "trade_side" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "trade_type" AS ENUM ('market', 'limit', 'market_stop', 'limit_stop', 'liquidation');

-- CreateTable
CREATE TABLE "trades_history" (
    "id" BIGSERIAL NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "perpetual_id" BIGINT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "side" "trade_side" NOT NULL,
    "type" "trade_type" NOT NULL,
    "price" BIGINT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "feee" BIGINT NOT NULL,
    "realized_profit" BIGINT NOT NULL,
    "order_digest_hash" TEXT NOT NULL,
    "trade_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_rate_payments" (
    "id" BIGSERIAL NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "perpetual_id" BIGINT NOT NULL,
    "payment_amount" BIGINT NOT NULL,
    "payment_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_rate_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trades_history_wallet_address_idx" ON "trades_history" USING HASH ("wallet_address");

-- CreateIndex
CREATE INDEX "trades_history_order_digest_hash_idx" ON "trades_history" USING HASH ("order_digest_hash");
