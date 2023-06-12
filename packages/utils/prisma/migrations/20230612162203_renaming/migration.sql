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
ADD COLUMN     "trader_addr" VARCHAR(42) NOT NULL;

-- CreateIndex
CREATE INDEX "estimated_earnings_tokens_liq_provider_addr_idx" ON "estimated_earnings_tokens" USING HASH ("liq_provider_addr");

-- CreateIndex
CREATE INDEX "liquidity_withdrawals_liq_provider_addr_idx" ON "liquidity_withdrawals" USING HASH ("liq_provider_addr");

-- CreateIndex
CREATE INDEX "trades_history_trader_addr_idx" ON "trades_history" USING HASH ("trader_addr");
