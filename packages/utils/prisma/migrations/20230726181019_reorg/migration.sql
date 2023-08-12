-- CreateEnum
CREATE TYPE "trade_side" AS ENUM ('buy', 'sell', 'liquidate_buy', 'liquidate_sell');

-- CreateEnum
CREATE TYPE "estimated_earnings_event_type" AS ENUM ('liquidity_added', 'liquidity_removed', 'share_token_p2p_transfer');

-- CreateTable
CREATE TABLE "trades_history" (
    "trader_addr" VARCHAR(42) NOT NULL,
    "perpetual_id" INTEGER NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "side" "trade_side" NOT NULL,
    "order_flags" BIGINT NOT NULL DEFAULT 0,
    "price" DECIMAL(40,0) NOT NULL,
    "quantity" DECIMAL(40,0) NOT NULL,
    "quantity_cc" DECIMAL(40,0),
    "fee" DECIMAL(40,0) NOT NULL,
    "broker_fee_tbps" INTEGER NOT NULL,
    "broker_addr" VARCHAR(42) NOT NULL DEFAULT '',
    "realized_profit" DECIMAL(40,0) NOT NULL,
    "order_digest_hash" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "trade_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "trades_history_pkey" PRIMARY KEY ("order_digest_hash")
);

-- CreateTable
CREATE TABLE "funding_rate_payments" (
    "trader_addr" VARCHAR(42) NOT NULL,
    "perpetual_id" INTEGER NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "payment_amount" DECIMAL(40,0) NOT NULL,
    "payment_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "funding_rate_payments_pkey" PRIMARY KEY ("trader_addr","tx_hash")
);

-- CreateTable
CREATE TABLE "estimated_earnings_tokens" (
    "liq_provider_addr" VARCHAR(42) NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "token_amount" DECIMAL(40,0) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" "estimated_earnings_event_type" NOT NULL,
    "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "estimated_earnings_tokens_pkey" PRIMARY KEY ("pool_id","tx_hash")
);

-- CreateTable
CREATE TABLE "price_info" (
    "pool_token_price" DOUBLE PRECISION NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_info_pkey" PRIMARY KEY ("pool_id","timestamp")
);

-- CreateTable
CREATE TABLE "liquidity_withdrawals" (
    "liq_provider_addr" VARCHAR(42) NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "amount" DECIMAL(40,0) NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "is_removal" BOOLEAN NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "liquidity_withdrawals_pkey" PRIMARY KEY ("liq_provider_addr","tx_hash")
);

-- CreateTable
CREATE TABLE "margin_token_info" (
    "pool_id" INTEGER NOT NULL,
    "token_addr" VARCHAR(42) NOT NULL,
    "token_name" VARCHAR(20) NOT NULL,
    "token_decimals" INTEGER NOT NULL,

    CONSTRAINT "margin_token_info_pkey" PRIMARY KEY ("pool_id")
);

-- CreateIndex
CREATE INDEX "trades_history_trader_addr_idx" ON "trades_history" USING HASH ("trader_addr");

-- CreateIndex
CREATE INDEX "trades_history_tx_hash_idx" ON "trades_history" USING HASH ("tx_hash");

-- CreateIndex
CREATE INDEX "trades_history_trade_timestamp_idx" ON "trades_history"("trade_timestamp");

-- CreateIndex
CREATE INDEX "funding_rate_payments_perpetual_id_idx" ON "funding_rate_payments"("perpetual_id");

-- CreateIndex
CREATE INDEX "funding_rate_payments_trader_addr_idx" ON "funding_rate_payments" USING HASH ("trader_addr");

-- CreateIndex
CREATE INDEX "funding_rate_payments_tx_hash_idx" ON "funding_rate_payments" USING HASH ("tx_hash");

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_tx_hash_idx" ON "estimated_earnings_tokens" USING HASH ("tx_hash");

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_liq_provider_addr_idx" ON "estimated_earnings_tokens" USING HASH ("liq_provider_addr");

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_pool_id_idx" ON "estimated_earnings_tokens" USING HASH ("pool_id");

-- CreateIndex
CREATE INDEX "price_info_pool_id_idx" ON "price_info" USING HASH ("pool_id");

-- CreateIndex
CREATE INDEX "price_info_timestamp_idx" ON "price_info"("timestamp");

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_pool_id_idx" ON "liquidity_withdrawals" USING HASH ("pool_id");

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_liq_provider_addr_idx" ON "liquidity_withdrawals" USING HASH ("liq_provider_addr");

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_timestamp_idx" ON "liquidity_withdrawals"("timestamp");
