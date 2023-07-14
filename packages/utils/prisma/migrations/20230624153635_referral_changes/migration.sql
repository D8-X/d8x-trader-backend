/*
  Warnings:

  - The primary key for the `estimated_earnings_tokens` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `estimated_earnings_tokens` table. All the data in the column will be lost.
  - The primary key for the `funding_rate_payments` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `funding_rate_payments` table. All the data in the column will be lost.
  - The primary key for the `liquidity_withdrawals` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `liquidity_withdrawals` table. All the data in the column will be lost.
  - The primary key for the `price_info` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `price_info` table. All the data in the column will be lost.
  - The primary key for the `referral_code_usage` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `trader_addr` on the `referral_code_usage` table. The data in that column could be lost. The data in that column will be cast from `VarChar(200)` to `VarChar(42)`.
  - The primary key for the `trades_history` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `trades_history` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "referral_payment" DROP CONSTRAINT "referral_payment_code_fkey";

-- AlterTable
ALTER TABLE "estimated_earnings_tokens" DROP CONSTRAINT "estimated_earnings_tokens_pkey",
DROP COLUMN "id",
ADD COLUMN     "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,
ADD CONSTRAINT "estimated_earnings_tokens_pkey" PRIMARY KEY ("pool_id", "tx_hash");

-- AlterTable
ALTER TABLE "funding_rate_payments" DROP CONSTRAINT "funding_rate_payments_pkey",
DROP COLUMN "id",
ADD COLUMN     "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,
ADD CONSTRAINT "funding_rate_payments_pkey" PRIMARY KEY ("trader_addr", "tx_hash");

-- AlterTable
ALTER TABLE "liquidity_withdrawals" DROP CONSTRAINT "liquidity_withdrawals_pkey",
DROP COLUMN "id",
ADD COLUMN     "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,
ADD CONSTRAINT "liquidity_withdrawals_pkey" PRIMARY KEY ("liq_provider_addr", "tx_hash");

-- AlterTable
ALTER TABLE "price_info" DROP CONSTRAINT "price_info_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "price_info_pkey" PRIMARY KEY ("pool_id", "timestamp");

-- AlterTable
ALTER TABLE "referral_code_usage" DROP CONSTRAINT "referral_code_usage_pkey",
ALTER COLUMN "trader_addr" SET DATA TYPE VARCHAR(42),
ADD CONSTRAINT "referral_code_usage_pkey" PRIMARY KEY ("trader_addr");

-- AlterTable
ALTER TABLE "referral_payment" ADD COLUMN     "tx_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "trades_history" DROP CONSTRAINT "trades_history_pkey",
DROP COLUMN "id",
ADD COLUMN     "is_collected_by_event" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "quantity_cc" DROP DEFAULT,
ADD CONSTRAINT "trades_history_pkey" PRIMARY KEY ("order_digest_hash");

-- CreateTable
CREATE TABLE "referral_setting_cut" (
    "is_agency_cut" BOOLEAN NOT NULL,
    "cut_perc" DECIMAL(5,2) NOT NULL,
    "holding_amount_dec_n" DECIMAL(77,0),
    "token_addr" VARCHAR(42) NOT NULL,

    CONSTRAINT "referral_setting_cut_pkey" PRIMARY KEY ("is_agency_cut","cut_perc")
);

-- CreateTable
CREATE TABLE "referral_token_holdings" (
    "referrer_addr" VARCHAR(42) NOT NULL,
    "holding_amount_dec_n" DECIMAL(77,0) NOT NULL,
    "token_addr" VARCHAR(42) NOT NULL,
    "last_updated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_token_holdings_pkey" PRIMARY KEY ("referrer_addr")
);

-- CreateIndex
CREATE INDEX "referral_setting_cut_cut_perc_idx" ON "referral_setting_cut"("cut_perc");

-- CreateIndex
CREATE INDEX "referral_setting_cut_holding_amount_dec_n_idx" ON "referral_setting_cut"("holding_amount_dec_n");

-- CreateIndex
CREATE INDEX "funding_rate_payments_perpetual_id_idx" ON "funding_rate_payments"("perpetual_id");

-- CreateIndex
CREATE INDEX "funding_rate_payments_trader_addr_idx" ON "funding_rate_payments" USING HASH ("trader_addr");
