begin;

-- CreateTable
CREATE TABLE if not exists "referral_broker_fees_per_trader" (
    "pool_id" INTEGER NOT NULL,
    "trader_addr" VARCHAR(42) NOT NULL,
    "quantity_cc" DECIMAL(40,0) NOT NULL,
    "fee_cc" DECIMAL(40,0) NOT NULL,
    "trade_timestamp" TIMESTAMPTZ NOT NULL,
    "broker_addr" VARCHAR(42) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_broker_fees_per_trader_pkey" PRIMARY KEY ("pool_id","trader_addr","trade_timestamp")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_broker_fees_per_trader_pool_id_idx" ON "referral_broker_fees_per_trader"("pool_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_broker_fees_per_trader_trade_timestamp_idx" ON "referral_broker_fees_per_trader"("trade_timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "referral_broker_fees_per_trader_trader_addr_idx" ON "referral_broker_fees_per_trader"("trader_addr");

end;