/*
  Warnings:

  - You are about to drop the column `wallet_address` on the `estimated_earnings_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `wallet_address` on the `funding_rate_payments` table. All the data in the column will be lost.
  - You are about to drop the column `user_wallet` on the `liquidity_withdrawals` table. All the data in the column will be lost.
  - You are about to drop the column `wallet_address` on the `trades_history` table. All the data in the column will be lost.
  - Added the required column `liq_provider_addr` to the `estimated_earnings_tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `trader_addr` to the `funding_rate_payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `liq_provider_addr` to the `liquidity_withdrawals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `trader_addr` to the `trades_history` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "estimated_earnings_tokens_wallet_address_idx";

-- DropIndex
DROP INDEX "liquidity_withdrawals_user_wallet_idx";

-- DropIndex
DROP INDEX "trades_history_wallet_address_idx";

-- AlterTable
ALTER TABLE "estimated_earnings_tokens" DROP COLUMN "wallet_address",
ADD COLUMN     "liq_provider_addr" VARCHAR(42) NOT NULL;

-- AlterTable
ALTER TABLE "funding_rate_payments" DROP COLUMN "wallet_address",
ADD COLUMN     "trader_addr" VARCHAR(42) NOT NULL;

-- AlterTable
ALTER TABLE "liquidity_withdrawals" DROP COLUMN "user_wallet",
ADD COLUMN     "liq_provider_addr" VARCHAR(42) NOT NULL;

-- AlterTable
ALTER TABLE "trades_history" DROP COLUMN "wallet_address",
ADD COLUMN     "broker_addr" VARCHAR(42) NOT NULL DEFAULT '',
ADD COLUMN     "quantity_cc" DECIMAL(40,0),
ADD COLUMN     "trader_addr" VARCHAR(42) NOT NULL;

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

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_liq_provider_addr_idx" ON "estimated_earnings_tokens" USING HASH ("liq_provider_addr");

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_liq_provider_addr_idx" ON "liquidity_withdrawals" USING HASH ("liq_provider_addr");

-- CreateIndex
CREATE INDEX "trades_history_trader_addr_idx" ON "trades_history" USING HASH ("trader_addr");

-- AddForeignKey
ALTER TABLE "referral_code_usage" ADD CONSTRAINT "referral_code_usage_code_fkey" FOREIGN KEY ("code") REFERENCES "referral_code"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_payment" ADD CONSTRAINT "referral_payment_code_fkey" FOREIGN KEY ("code") REFERENCES "referral_code"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
