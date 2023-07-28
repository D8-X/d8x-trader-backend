begin;

-- CreateTable
  -- no constraint for referral code because we could collect the data from onchain
  -- and we could encounter an unknown referral code in this case
CREATE TABLE "referral_payment" (
    "trader_addr" VARCHAR(42) NOT NULL,
    "broker_addr" VARCHAR(42) NOT NULL,
    "code" VARCHAR(200) NOT NULL,
    "pool_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- payment in token's number format, single transaction
    "trader_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "referrer_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "agency_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "broker_paid_amount_cc" DECIMAL(40,0) NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "tx_confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "referral_payment_pkey" PRIMARY KEY ("trader_addr","pool_id","timestamp")
);

-- CreateIndex
CREATE INDEX "referral_payment_timestamp_idx" ON "referral_payment"("timestamp");

-- CreateIndex
CREATE INDEX "referral_payment_pool_id_idx" ON "referral_payment"("pool_id");

-- CreateIndex
CREATE INDEX "referral_payment_trader_addr_idx" ON "referral_payment"("trader_addr");

end;