-- CreateEnum
DROP TYPE IF EXISTS "trade_side";
CREATE TYPE "trade_side" AS ENUM ('buy', 'sell', 'liquidate_buy', 'liquidate_sell');

-- CreateEnum
DROP TYPE IF EXISTS "estimated_earnings_event_type";
CREATE TYPE "estimated_earnings_event_type" AS ENUM ('liquidity_added', 'liquidity_removed', 'share_token_p2p_transfer');

-- CreateTable
CREATE TABLE "trades_history" (
    "id" BIGSERIAL NOT NULL,
    "trader_addr" VARCHAR(42) NOT NULL,
    "perpetual_id" INTEGER NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "side" "trade_side" NOT NULL,
    "order_flags" BIGINT NOT NULL DEFAULT 0,
    "price" DECIMAL(40,0) NOT NULL,
    "quantity" DECIMAL(40,0) NOT NULL,
    "quantity_cc" DECIMAL(40,0) DEFAULT 0, -- 0 for liquidation events
    "fee" DECIMAL(40,0) NOT NULL,
    "broker_fee_tbps" INTEGER NOT NULL,
    "broker_addr" VARCHAR(42) NOT NULL DEFAULT '',
    "realized_profit" DECIMAL(40,0) NOT NULL,
    "order_digest_hash" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "trade_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_rate_payments" (
    "id" BIGSERIAL NOT NULL,
    "trader_addr" VARCHAR(42) NOT NULL,
    "perpetual_id" INTEGER NOT NULL,
    "payment_amount" DECIMAL(40,0) NOT NULL,
    "payment_timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tx_hash" TEXT NOT NULL,

    CONSTRAINT "funding_rate_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimated_earnings_tokens" (
    "id" BIGSERIAL NOT NULL,
    "liq_provider_addr" VARCHAR(42) NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "token_amount" DECIMAL(40,0) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" "estimated_earnings_event_type" NOT NULL,

    CONSTRAINT "estimated_earnings_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_info" (
    "id" BIGSERIAL NOT NULL,
    "pool_token_price" DOUBLE PRECISION NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidity_withdrawals" (
    "id" BIGSERIAL NOT NULL,
    "liq_provider_addr" VARCHAR(42) NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "amount" DECIMAL(40,0) NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "is_removal" BOOLEAN NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidity_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "margin_token_info" (
    "pool_id" INTEGER NOT NULL,
    "token_addr" VARCHAR(42) NOT NULL,
    "token_name" VARCHAR(20) NOT NULL,
    "token_decimals" INTEGER NOT NULL,

    CONSTRAINT "margin_token_info_pkey" PRIMARY KEY ("pool_id")
);

-- CreateTable
CREATE TABLE "referral_code" (
    "code" VARCHAR(200) NOT NULL,
    "referrer_addr" VARCHAR(42) NOT NULL,
    "agency_addr" VARCHAR(42),
    "broker_addr" VARCHAR(42) NOT NULL,
    "broker_payout_addr" VARCHAR(42) NOT NULL,
    "created_on" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry" TIMESTAMPTZ NOT NULL DEFAULT '2042-04-24 04:42:42 +02:00',
    "trader_rebate_perc" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "referrer_rebate_perc" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "agency_rebate_perc" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "referral_code_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "referral_code_usage" (
    "trader_addr" VARCHAR(200) NOT NULL,
    "code" VARCHAR(200) NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_code_usage_pkey" PRIMARY KEY ("trader_addr")
);

-- CreateTable
CREATE TABLE "referral_payment" (
    "trader_addr" VARCHAR(42) NOT NULL,
    "broker_addr" VARCHAR(42) NOT NULL,
    "code" VARCHAR(200) NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trader_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "broker_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "agency_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "referrer_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "tx_hash" TEXT NOT NULL,

    CONSTRAINT "referral_payment_pkey" PRIMARY KEY ("trader_addr","pool_id","timestamp")
);

-- CreateIndex
CREATE INDEX "trades_history_trader_addr_idx" ON "trades_history" USING HASH ("trader_addr");

-- CreateIndex
CREATE INDEX "trades_history_tx_hash_idx" ON "trades_history" USING HASH ("tx_hash");

-- CreateIndex
CREATE INDEX "trades_history_trade_timestamp_idx" ON "trades_history"("trade_timestamp");

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

-- CreateIndex
CREATE INDEX "referral_code_referrer_addr_idx" ON "referral_code" USING HASH ("referrer_addr");

-- CreateIndex
CREATE INDEX "referral_code_agency_addr_idx" ON "referral_code" USING HASH ("agency_addr");

-- CreateIndex
CREATE INDEX "referral_code_broker_addr_idx" ON "referral_code" USING HASH ("broker_addr");

-- CreateIndex
CREATE INDEX "referral_payment_timestamp_idx" ON "referral_payment"("timestamp");

-- CreateIndex
CREATE INDEX "referral_payment_pool_id_idx" ON "referral_payment"("pool_id");

-- CreateIndex
CREATE INDEX "referral_payment_trader_addr_idx" ON "referral_payment"("trader_addr");

-- AddForeignKey
ALTER TABLE "referral_code_usage" ADD CONSTRAINT "referral_code_usage_code_fkey" FOREIGN KEY ("code") REFERENCES "referral_code"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_payment" ADD CONSTRAINT "referral_payment_code_fkey" FOREIGN KEY ("code") REFERENCES "referral_code"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
